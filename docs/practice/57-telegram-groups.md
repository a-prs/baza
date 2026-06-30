# Работа с Telegram-группами и суперруппами

Бот в группе ведёт себя иначе чем в личке: видит только сообщения где упомянут, может быть администратором, управлять правами и пинами. Разбираем паттерны для чат-ботов и модераторов.

## Базовые отличия группы от лички

```python
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message
from aiogram.filters import Command

bot = Bot(token=TOKEN)
dp = Dispatcher()


@dp.message(Command("help"))
async def cmd_help(message: Message):
    # message.chat.type: "private" / "group" / "supergroup" / "channel"
    if message.chat.type == "private":
        await message.answer("Это личный чат")
    else:
        # В группе бот видит команды только если они адресованы ему
        # /help@mybotname — всегда работает
        # /help — работает если бот единственный или включён режим команд
        await message.answer(f"Это {message.chat.type}: {message.chat.title}")
```

## Включить получение всех сообщений группы

По умолчанию бот видит только команды (`/cmd`) и сообщения где упомянут (`@bot`). Для полного мониторинга нужно:

```python
# В BotFather: Bot Settings → Group Privacy → Disable
# Или программно через API (требует прав):
await bot.set_my_commands([...])  # не влияет на privacy

# Проверить настройку:
me = await bot.get_me()
print(me.can_join_groups, me.can_read_all_group_messages)
```

После отключения Group Privacy бот получает каждое сообщение в группе.

## Ограничить обработку конкретной группой

```python
ALLOWED_GROUP_ID = -1001234567890  # суперруппа


def from_allowed_group(message: Message) -> bool:
    return message.chat.id == ALLOWED_GROUP_ID


@dp.message(Command("ping"), from_allowed_group)
async def cmd_ping(message: Message):
    await message.answer("pong")


# Или через фильтр в декораторе:
@dp.message(Command("status"), F.chat.id == ALLOWED_GROUP_ID)
async def cmd_status(message: Message):
    await message.answer("OK")
```

## Проверка прав бота

```python
from aiogram.types import ChatPermissions


async def check_bot_permissions(chat_id: int) -> dict:
    """Проверить что может бот в этом чате."""
    member = await bot.get_chat_member(chat_id, (await bot.get_me()).id)
    
    return {
        "can_delete_messages": getattr(member, "can_delete_messages", False),
        "can_restrict_members": getattr(member, "can_restrict_members", False),
        "can_pin_messages": getattr(member, "can_pin_messages", False),
        "is_admin": member.status in ("administrator", "creator"),
    }
```

## Управление правами участников

```python
from aiogram.types import ChatPermissions
from datetime import datetime, timedelta


# Замутить пользователя (ограничить права)
async def mute_user(chat_id: int, user_id: int, minutes: int = 60):
    until = datetime.now() + timedelta(minutes=minutes)
    
    await bot.restrict_chat_member(
        chat_id=chat_id,
        user_id=user_id,
        permissions=ChatPermissions(
            can_send_messages=False,
            can_send_media_messages=False,
            can_send_polls=False,
            can_add_web_page_previews=False,
        ),
        until_date=until
    )


# Размутить
async def unmute_user(chat_id: int, user_id: int):
    await bot.restrict_chat_member(
        chat_id=chat_id,
        user_id=user_id,
        permissions=ChatPermissions(
            can_send_messages=True,
            can_send_media_messages=True,
            can_send_polls=True,
            can_add_web_page_previews=True,
        )
    )


# Кикнуть
async def kick_user(chat_id: int, user_id: int):
    await bot.ban_chat_member(chat_id, user_id)
    # Сразу разбанить чтобы мог зайти снова (просто кик)
    await bot.unban_chat_member(chat_id, user_id)


# Забанить навсегда
async def ban_user(chat_id: int, user_id: int):
    await bot.ban_chat_member(chat_id, user_id)
```

## Закреплённые сообщения

```python
# Закрепить сообщение
async def pin_message(chat_id: int, message_id: int):
    await bot.pin_chat_message(
        chat_id=chat_id,
        message_id=message_id,
        disable_notification=True  # без уведомления
    )


# Открепить конкретное
await bot.unpin_chat_message(chat_id=chat_id, message_id=message_id)

# Открепить все
await bot.unpin_all_chat_messages(chat_id=chat_id)


# Паттерн: обновляемый статус-пин
class PinManager:
    """Держать одно закреплённое сообщение со статусом."""
    
    def __init__(self, chat_id: int):
        self.chat_id = chat_id
        self.pinned_id: int | None = None
    
    async def update_status(self, text: str):
        if self.pinned_id:
            try:
                await bot.edit_message_text(
                    chat_id=self.chat_id,
                    message_id=self.pinned_id,
                    text=text
                )
                return
            except Exception:
                pass  # сообщение удалено — создать заново
        
        msg = await bot.send_message(self.chat_id, text)
        self.pinned_id = msg.message_id
        await bot.pin_chat_message(self.chat_id, msg.message_id, disable_notification=True)
```

## Реакция на новых участников

```python
from aiogram.types import ChatMemberUpdated
from aiogram.filters import ChatMemberUpdatedFilter, MEMBER, NOT_MEMBER


@dp.chat_member(ChatMemberUpdatedFilter(member_status_changed=MEMBER))
async def on_new_member(event: ChatMemberUpdated):
    user = event.new_chat_member.user
    
    # Приветствие
    welcome = await event.answer(
        f"Привет, {user.mention_html()}! "
        f"Добро пожаловать в {event.chat.title} 👋",
        parse_mode="HTML"
    )
    
    # Удалить системное сообщение «X вступил в группу»
    # (требует права delete_messages)
    # В aiogram нет прямого доступа к system message_id здесь
    # Нужно слушать message с content_type=CHAT_MEMBERS_ADDED
    pass


@dp.message(F.content_type == "new_chat_members")
async def on_join_message(message: Message):
    """Поймать системное сообщение о вступлении."""
    for new_member in message.new_chat_members:
        if not new_member.is_bot:
            await message.reply(
                f"Добро пожаловать, {new_member.mention_html()}!",
                parse_mode="HTML"
            )
    
    # Удалить само системное сообщение
    try:
        await message.delete()
    except Exception:
        pass


@dp.chat_member(ChatMemberUpdatedFilter(member_status_changed=NOT_MEMBER))
async def on_left_member(event: ChatMemberUpdated):
    user = event.new_chat_member.user
    print(f"Ушёл: {user.full_name}")
```

## Анти-спам: удаление и мут

```python
import re
from collections import defaultdict
from datetime import datetime, timedelta

# Счётчик сообщений пользователя
message_counts: dict[int, list] = defaultdict(list)
SPAM_LIMIT = 5  # сообщений
SPAM_WINDOW = 10  # за N секунд


def is_spam(user_id: int) -> bool:
    now = datetime.now()
    window_start = now - timedelta(seconds=SPAM_WINDOW)
    
    # Очистить старые метки
    message_counts[user_id] = [
        ts for ts in message_counts[user_id]
        if ts > window_start
    ]
    
    message_counts[user_id].append(now)
    
    return len(message_counts[user_id]) > SPAM_LIMIT


LINK_PATTERN = re.compile(r"(https?://|t\.me/|@\w+)", re.IGNORECASE)


@dp.message(F.chat.type.in_({"group", "supergroup"}))
async def anti_spam(message: Message):
    user_id = message.from_user.id
    
    # Проверить спам по скорости
    if is_spam(user_id):
        await message.delete()
        await mute_user(message.chat.id, user_id, minutes=5)
        
        warning = await message.answer(
            f"⚠️ {message.from_user.mention_html()} замучен на 5 мин за флуд",
            parse_mode="HTML"
        )
        # Удалить предупреждение через 10 сек
        import asyncio
        asyncio.create_task(
            asyncio.sleep(10).then(warning.delete())
        )
        return
    
    # Удалить ссылки от новых участников
    if message.text and LINK_PATTERN.search(message.text):
        member = await bot.get_chat_member(message.chat.id, user_id)
        # Только для обычных участников (не админов)
        if member.status == "member":
            await message.delete()
```

## Топики (Forum supergroup)

```python
# Суперруппа с включёнными топиками (threads)
# Каждый топик = отдельный thread_id

@dp.message(F.message_thread_id == 123)  # конкретный топик
async def handle_dev_topic(message: Message):
    """Обработать только сообщения в топике Dev."""
    await message.answer("Привет в топике Dev!", message_thread_id=message.message_thread_id)


# Создать топик
topic = await bot.create_forum_topic(
    chat_id=SUPERGROUP_ID,
    name="Новый топик",
    icon_color=0x6FB9F0  # синий
)

# Закрыть/открыть топик
await bot.close_forum_topic(SUPERGROUP_ID, topic.message_thread_id)
await bot.reopen_forum_topic(SUPERGROUP_ID, topic.message_thread_id)
```

## Получить список участников (только для небольших групп)

```python
# Для больших групп (>200) Telegram не отдаёт полный список
# Работает только для групп/суперрупп до ~200 человек

async def get_admins(chat_id: int) -> list:
    admins = await bot.get_chat_administrators(chat_id)
    return [
        {"id": a.user.id, "name": a.user.full_name, "status": a.status}
        for a in admins
    ]


# Количество участников
count = await bot.get_chat_member_count(chat_id)
```

---

::: tip Тестирование в группах
Создай отдельную тестовую группу и добавь бота туда. Никогда не тестируй функции кика/мута в рабочей группе — ошибка в коде может удалить реальных пользователей.
:::
