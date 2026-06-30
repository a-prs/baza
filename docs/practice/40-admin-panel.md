# Telegram-панель администратора

Веб-интерфейс для управления ботом делать долго. Проще сделать admin-раздел прямо в Telegram: команды только для тебя, статистика, управление пользователями и рассылки.

## Базовая защита

Всё строится на проверке `user_id`:

```python
import os

ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x}

def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS

# В .env:
# ADMIN_IDS=123456789,987654321
```

В хэндлерах:

```python
from aiogram.filters import BaseFilter
from aiogram.types import Message

class AdminFilter(BaseFilter):
    async def __call__(self, message: Message) -> bool:
        return is_admin(message.from_user.id)

# Использование:
@dp.message(Command("admin"), AdminFilter())
async def cmd_admin(message: Message):
    await message.answer("Добро пожаловать в панель!")
```

## Главное меню администратора

```python
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder

def admin_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    buttons = [
        ("📊 Статистика", "admin:stats"),
        ("👥 Пользователи", "admin:users"),
        ("📢 Рассылка", "admin:broadcast"),
        ("🚫 Бан/разбан", "admin:ban"),
        ("⚙️ Настройки", "admin:settings"),
        ("📋 Логи", "admin:logs"),
    ]
    for text, data in buttons:
        builder.button(text=text, callback_data=data)
    builder.adjust(2)
    return builder.as_markup()


@dp.message(Command("admin"), AdminFilter())
async def cmd_admin(message: Message):
    await message.answer("🔧 Панель управления", reply_markup=admin_keyboard())
```

## Статистика

```python
import sqlite3
from datetime import datetime, timedelta

def get_stats() -> dict:
    conn = sqlite3.connect("bot.db")
    
    total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    
    week_ago = (datetime.now() - timedelta(days=7)).isoformat()
    new_week = conn.execute(
        "SELECT COUNT(*) FROM users WHERE created_at >= ?", (week_ago,)
    ).fetchone()[0]
    
    day_ago = (datetime.now() - timedelta(days=1)).isoformat()
    active_today = conn.execute(
        "SELECT COUNT(*) FROM users WHERE last_active >= ?", (day_ago,)
    ).fetchone()[0]
    
    conn.close()
    return {
        "total": total_users,
        "new_week": new_week,
        "active_today": active_today,
    }

@dp.callback_query(F.data == "admin:stats")
async def show_stats(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    
    s = get_stats()
    text = (
        "📊 **Статистика бота**\n\n"
        f"Всего пользователей: {s['total']}\n"
        f"Новых за неделю: {s['new_week']}\n"
        f"Активных сегодня: {s['active_today']}\n\n"
        f"_Обновлено: {datetime.now().strftime('%d.%m.%Y %H:%M')}_"
    )
    
    back_kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="← Назад", callback_data="admin:menu")
    ]])
    await callback.message.edit_text(text, reply_markup=back_kb, parse_mode="Markdown")
    await callback.answer()
```

## Просмотр пользователей

```python
def get_users(page: int = 1, page_size: int = 5) -> tuple[list, int]:
    conn = sqlite3.connect("bot.db")
    total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    offset = (page - 1) * page_size
    rows = conn.execute(
        "SELECT id, telegram_id, username, created_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?",
        (page_size, offset)
    ).fetchall()
    conn.close()
    total_pages = (total + page_size - 1) // page_size
    return [dict(r) for r in rows], total_pages


def users_keyboard(page: int, total: int) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if page > 1:
        builder.button(text="←", callback_data=f"admin:users:{page - 1}")
    builder.button(text=f"{page}/{total}", callback_data="noop")
    if page < total:
        builder.button(text="→", callback_data=f"admin:users:{page + 1}")
    builder.adjust(3)
    builder.row(InlineKeyboardButton(text="← Меню", callback_data="admin:menu"))
    return builder.as_markup()


@dp.callback_query(F.data.startswith("admin:users"))
async def show_users(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    
    parts = callback.data.split(":")
    page = int(parts[2]) if len(parts) > 2 else 1
    
    users, total_pages = get_users(page)
    
    lines = [f"👥 **Пользователи** (стр. {page}/{total_pages})\n"]
    for u in users:
        name = f"@{u['username']}" if u.get("username") else f"ID:{u['telegram_id']}"
        lines.append(f"• {name} — {u['created_at'][:10]}")
    
    await callback.message.edit_text(
        "\n".join(lines),
        reply_markup=users_keyboard(page, total_pages),
        parse_mode="Markdown"
    )
    await callback.answer()
```

## Рассылка

```python
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

class BroadcastStates(StatesGroup):
    waiting_message = State()
    confirming = State()


@dp.callback_query(F.data == "admin:broadcast")
async def start_broadcast(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    
    await state.set_state(BroadcastStates.waiting_message)
    await callback.message.edit_text(
        "📢 **Рассылка**\n\nПришли текст сообщения для всех пользователей.\n\n"
        "Можно использовать **жирный**, _курсив_, `код`.\n\n"
        "/cancel — отмена"
    )
    await callback.answer()


@dp.message(BroadcastStates.waiting_message, AdminFilter())
async def preview_broadcast(message: Message, state: FSMContext):
    await state.update_data(broadcast_text=message.text)
    await state.set_state(BroadcastStates.confirming)
    
    confirm_kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Разослать всем", callback_data="broadcast:confirm"),
        InlineKeyboardButton(text="❌ Отмена", callback_data="broadcast:cancel"),
    ]])
    
    # Получить кол-во получателей
    conn = sqlite3.connect("bot.db")
    count = conn.execute("SELECT COUNT(*) FROM users WHERE is_banned = 0").fetchone()[0]
    conn.close()
    
    await message.answer(
        f"**Предпросмотр ({count} получателей):**\n\n{message.text}",
        reply_markup=confirm_kb,
        parse_mode="Markdown"
    )


@dp.callback_query(F.data == "broadcast:confirm")
async def do_broadcast(callback: CallbackQuery, state: FSMContext, bot: Bot):
    if not is_admin(callback.from_user.id):
        return
    
    data = await state.get_data()
    text = data.get("broadcast_text", "")
    await state.clear()
    
    conn = sqlite3.connect("bot.db")
    users = conn.execute(
        "SELECT telegram_id FROM users WHERE is_banned = 0"
    ).fetchall()
    conn.close()
    
    await callback.message.edit_text("Рассылка запущена... ⏳")
    
    sent, failed = 0, 0
    for (user_id,) in users:
        try:
            await bot.send_message(user_id, text, parse_mode="Markdown")
            sent += 1
        except Exception:
            failed += 1
        await asyncio.sleep(0.05)  # 20 msg/sec лимит Telegram
    
    await callback.message.answer(
        f"✅ Рассылка завершена\nОтправлено: {sent}\nОшибок: {failed}"
    )
    await callback.answer()
```

## Бан/разбан пользователя

```python
class BanStates(StatesGroup):
    waiting_user_id = State()


@dp.callback_query(F.data == "admin:ban")
async def start_ban(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(BanStates.waiting_user_id)
    await callback.message.edit_text(
        "🚫 Введи Telegram ID пользователя для бана/разбана:"
    )
    await callback.answer()


@dp.message(BanStates.waiting_user_id, AdminFilter())
async def handle_ban(message: Message, state: FSMContext, bot: Bot):
    await state.clear()
    
    try:
        target_id = int(message.text.strip())
    except ValueError:
        await message.answer("Неверный ID. Должно быть число.")
        return
    
    conn = sqlite3.connect("bot.db")
    user = conn.execute(
        "SELECT is_banned FROM users WHERE telegram_id = ?", (target_id,)
    ).fetchone()
    
    if not user:
        await message.answer(f"Пользователь {target_id} не найден.")
        conn.close()
        return
    
    new_status = 0 if user[0] else 1  # переключить
    conn.execute(
        "UPDATE users SET is_banned = ? WHERE telegram_id = ?",
        (new_status, target_id)
    )
    conn.commit()
    conn.close()
    
    action = "забанен" if new_status else "разбанен"
    await message.answer(f"Пользователь {target_id} {action}.")
    
    # Уведомить пользователя
    try:
        if new_status:
            await bot.send_message(target_id, "Ваш аккаунт заблокирован.")
        else:
            await bot.send_message(target_id, "Ваш аккаунт разблокирован.")
    except Exception:
        pass
```

## Проверка бана в middleware

```python
class BanCheckMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data: dict):
        from_user = data.get("event_from_user")
        if from_user:
            conn = sqlite3.connect("bot.db")
            row = conn.execute(
                "SELECT is_banned FROM users WHERE telegram_id = ?",
                (from_user.id,)
            ).fetchone()
            conn.close()
            if row and row[0]:
                return  # молча игнорировать забаненных
        return await handler(event, data)
```

---

::: warning Безопасность
Никогда не проверяй только `username` — его можно поменять. Проверка всегда по `user_id`. Логируй все admin-действия: кто, что, когда.
:::
