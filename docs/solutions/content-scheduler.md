# Планировщик контента с AI

Бот генерирует контент-план на неделю: выбирает темы, формирует посты через Claude и складывает в очередь. В нужное время — публикует в канал без твоего участия.

## Что умеет

- Получить тему/нишу от пользователя
- Сгенерировать план на 7 дней (1-2 поста в день)
- Показать план для проверки и редактирования
- Добавить одобренные посты в очередь
- Публиковать по расписанию автоматически

## Структура

```
content-scheduler/
├── bot.py
├── generator.py   # генерация контента через Claude
├── scheduler.py   # планировщик публикаций
├── db.py          # хранение очереди
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
anthropic
apscheduler
python-dotenv
aiosqlite
```

## База данных (db.py)

```python
import aiosqlite
import os
from datetime import datetime

DB_PATH = os.getenv("DB_PATH", "content.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                scheduled_at TIMESTAMP,
                published_at TIMESTAMP,
                status TEXT DEFAULT 'draft',
                channel_id TEXT NOT NULL
            )
        """)
        await db.commit()


async def add_post(text: str, scheduled_at: datetime, channel_id: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO posts (text, scheduled_at, channel_id) VALUES (?, ?, ?)",
            (text, scheduled_at.isoformat(), channel_id)
        )
        await db.commit()
        return cursor.lastrowid


async def get_pending_posts(before: datetime) -> list[dict]:
    """Получить посты готовые к публикации"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            """SELECT * FROM posts 
               WHERE status = 'draft' AND scheduled_at <= ?
               ORDER BY scheduled_at ASC""",
            (before.isoformat(),)
        )
        return [dict(r) for r in rows]


async def mark_published(post_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE posts SET status = 'published', published_at = datetime('now') WHERE id = ?",
            (post_id,)
        )
        await db.commit()


async def get_queue(channel_id: str) -> list[dict]:
    """Показать очередь постов"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            """SELECT id, text, scheduled_at, status FROM posts
               WHERE channel_id = ? AND status = 'draft'
               ORDER BY scheduled_at ASC LIMIT 20""",
            (channel_id,)
        )
        return [dict(r) for r in rows]
```

## Генератор контента (generator.py)

```python
import json
import os
from anthropic import AsyncAnthropic
from datetime import datetime, timedelta

client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


async def generate_content_plan(topic: str, days: int = 7, posts_per_day: int = 1) -> list[dict]:
    """Сгенерировать контент-план. Вернуть список постов с расписанием."""
    
    total = days * posts_per_day
    
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        messages=[{
            "role": "user",
            "content": f"""Создай контент-план из {total} постов для Telegram-канала на тему: {topic}

Требования к каждому посту:
- Длина: 150-300 слов
- Стиль: экспертный но доступный, без воды
- Начинать с цепляющего первого предложения
- В конце — вопрос или призыв к обсуждению
- НЕ использовать хэштеги
- Разные форматы: советы, кейс, список, история, факт

Верни СТРОГО JSON без markdown-обёртки:
{{
  "posts": [
    {{
      "title": "краткое название для навигации",
      "text": "полный текст поста",
      "day": 1,
      "slot": 1
    }}
  ]
}}

{total} постов, дни 1-{days}, слоты 1-{posts_per_day}."""
        }]
    )
    
    raw = response.content[0].text.strip()
    data = json.loads(raw)
    
    # Добавить временны́е метки
    now = datetime.now()
    post_times = [9, 18]  # часы публикации
    
    posts = []
    for post in data["posts"]:
        day_offset = post["day"] - 1
        slot = post["slot"] - 1
        hour = post_times[slot % len(post_times)]
        scheduled = (now + timedelta(days=day_offset)).replace(
            hour=hour, minute=0, second=0, microsecond=0
        )
        posts.append({
            "title": post["title"],
            "text": post["text"],
            "scheduled_at": scheduled,
        })
    
    return posts
```

## Планировщик публикаций (scheduler.py)

```python
import asyncio
import logging
from datetime import datetime, timezone
from aiogram import Bot
from db import get_pending_posts, mark_published

logger = logging.getLogger(__name__)


async def publish_pending(bot: Bot):
    """Проверить и опубликовать готовые посты"""
    now = datetime.now()
    posts = await get_pending_posts(before=now)
    
    for post in posts:
        try:
            await bot.send_message(post["channel_id"], post["text"])
            await mark_published(post["id"])
            logger.info(f"Опубликован пост #{post['id']}")
            await asyncio.sleep(3)  # пауза между постами
        except Exception as e:
            logger.error(f"Ошибка публикации #{post['id']}: {e}")
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from datetime import datetime
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

CHANNEL_ID = os.getenv("CHANNEL_ID")
ADMIN_ID = int(os.getenv("ADMIN_ID"))

from db import init_db, add_post, get_queue
from generator import generate_content_plan
from scheduler import publish_pending


class GenerateStates(StatesGroup):
    waiting_topic = State()
    reviewing = State()


# --- Генерация плана ---

@dp.message(Command("generate"))
async def cmd_generate(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return
    await state.set_state(GenerateStates.waiting_topic)
    await message.answer(
        "Напиши тему для контент-плана на 7 дней.\n\n"
        "Например: «Python для начинающих», «Маркетинг в соцсетях», «Рецепты без мяса»"
    )


@dp.message(GenerateStates.waiting_topic)
async def handle_topic(message: Message, state: FSMContext):
    topic = message.text
    await state.update_data(topic=topic)
    
    status = await message.answer(f"Генерирую план на тему «{topic}»... ⏳")
    
    try:
        posts = await generate_content_plan(topic, days=7, posts_per_day=1)
        await state.update_data(posts=[(p["text"], p["scheduled_at"]) for p in posts])
        await state.set_state(GenerateStates.reviewing)
        
        # Показать план
        await status.delete()
        preview = f"Готов план: {len(posts)} постов\n\n"
        for i, post in enumerate(posts[:3], 1):
            preview += f"**{i}. {post['title']}**\n{post['text'][:100]}...\n\n"
        if len(posts) > 3:
            preview += f"_...и ещё {len(posts) - 3} постов_"
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="✅ Принять весь план", callback_data="accept_plan"),
            InlineKeyboardButton(text="❌ Отклонить", callback_data="reject_plan"),
        ]])
        
        await message.answer(preview, reply_markup=keyboard, parse_mode="Markdown")
    
    except Exception as e:
        await status.edit_text(f"Ошибка генерации: {e}")
        await state.clear()


@dp.callback_query(F.data == "accept_plan", GenerateStates.reviewing)
async def accept_plan(callback: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    posts = data.get("posts", [])
    
    added = 0
    for text, scheduled_at in posts:
        await add_post(text, scheduled_at, CHANNEL_ID)
        added += 1
    
    await state.clear()
    await callback.message.edit_text(f"✅ Добавлено {added} постов в очередь!")
    await callback.answer()


@dp.callback_query(F.data == "reject_plan", GenerateStates.reviewing)
async def reject_plan(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text("Отклонено. Попробуй снова /generate")
    await callback.answer()


# --- Просмотр очереди ---

@dp.message(Command("queue"))
async def cmd_queue(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    posts = await get_queue(CHANNEL_ID)
    if not posts:
        await message.answer("Очередь пуста. Сгенерируй план: /generate")
        return
    
    lines = [f"📅 Очередь постов ({len(posts)} шт.):\n"]
    for p in posts[:10]:
        dt = datetime.fromisoformat(p["scheduled_at"])
        lines.append(f"• {dt.strftime('%d.%m %H:%M')} — {p['text'][:60]}...")
    
    await message.answer("\n".join(lines))


# --- Запуск ---

async def main():
    await init_db()
    
    # Каждые 15 минут проверять очередь
    scheduler.add_job(
        publish_pending,
        "interval",
        minutes=15,
        args=[bot],
        id="publish_posts"
    )
    scheduler.start()
    
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
ANTHROPIC_API_KEY=your_key
CHANNEL_ID=-100123456789
ADMIN_ID=123456789
DB_PATH=content.db
```

## Запуск и деплой

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

Systemd-сервис — как в других решениях. После деплоя: пиши /generate, выбирай тему, принимай план — посты пойдут сами.

---

::: tip Работа с планом
После генерации посмотри несколько постов командой /queue. Если какой-то не нравится — удали из БД напрямую: `sqlite3 content.db "DELETE FROM posts WHERE id=3"`. Или добавь команду /delete в бота.
:::
