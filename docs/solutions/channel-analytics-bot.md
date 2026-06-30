# Бот аналитики Telegram-канала

Бот для владельца канала: статистика постов, рост подписчиков, топ-контент, недельный дайджест. Всё из бота, без внешних сервисов.

## Что делает

- `/stats` — сводка за последние 7/30 дней
- `/top` — топ-5 постов по просмотрам/реакциям
- `/growth` — динамика подписчиков по дням
- `/report` — недельный отчёт (PDF)
- Авто-дайджест каждый понедельник в 9:00

## Как работает

Telegram Bot API возвращает статистику только через `getChatMemberCount` (число подписчиков). Полная аналитика постов — через `forwardChannel.getStats` в MTProto (не Bot API).

**Простой вариант:** бот форвардит посты себе → сохраняет `view_count` и `forward_count` → накапливает статистику.

**Продвинутый вариант:** Telethon (MTProto) → полная аналитика как в Telegram Analytics.

Реализуем **простой вариант** — без MTProto, работает со стандартным Bot API.

## Структура

```
channel-analytics/
├── bot.py
├── db.py           # хранение постов и статистики
├── analytics.py    # расчёт метрик
├── reporter.py     # генерация PDF-отчёта
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
aiosqlite
apscheduler
python-dotenv
reportlab
```

## База данных (db.py)

```python
import aiosqlite
import os

DB_PATH = os.getenv("DB_PATH", "analytics.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                message_id INTEGER PRIMARY KEY,
                date INTEGER,
                text TEXT,
                views INTEGER DEFAULT 0,
                forwards INTEGER DEFAULT 0,
                reactions INTEGER DEFAULT 0,
                recorded_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS subscribers (
                date TEXT PRIMARY KEY,
                count INTEGER
            )
        """)
        await db.commit()


async def upsert_post(message_id: int, date: int, text: str, 
                      views: int, forwards: int, reactions: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO posts (message_id, date, text, views, forwards, reactions)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(message_id) DO UPDATE SET
                views = excluded.views,
                forwards = excluded.forwards,
                reactions = excluded.reactions
        """, (message_id, date, text, views, forwards, reactions))
        await db.commit()


async def record_subscribers(count: int):
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO subscribers (date, count) VALUES (?, ?)",
            (today, count)
        )
        await db.commit()


async def get_top_posts(days: int = 7, limit: int = 5) -> list[dict]:
    cutoff = int(__import__('time').time()) - days * 86400
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            "SELECT * FROM posts WHERE date >= ? ORDER BY views DESC LIMIT ?",
            (cutoff, limit)
        )
        return [dict(r) for r in rows]


async def get_stats(days: int = 7) -> dict:
    cutoff = int(__import__('time').time()) - days * 86400
    async with aiosqlite.connect(DB_PATH) as db:
        row = await db.execute_fetchone("""
            SELECT 
                COUNT(*) as posts_count,
                SUM(views) as total_views,
                AVG(views) as avg_views,
                SUM(forwards) as total_forwards,
                SUM(reactions) as total_reactions
            FROM posts WHERE date >= ?
        """, (cutoff,))
        return {
            "posts": row[0] or 0,
            "views": row[1] or 0,
            "avg_views": round(row[2] or 0, 1),
            "forwards": row[3] or 0,
            "reactions": row[4] or 0,
        }


async def get_subscriber_growth(days: int = 14) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            "SELECT * FROM subscribers ORDER BY date DESC LIMIT ?", (days,)
        )
        return [dict(r) for r in rows]
```

## Аналитика (analytics.py)

```python
from db import get_stats, get_top_posts, get_subscriber_growth
from datetime import datetime


def format_number(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(n)


async def build_stats_message(days: int = 7) -> str:
    stats = await get_stats(days)
    top = await get_top_posts(days, limit=3)
    subs = await get_subscriber_growth(2)
    
    # Рост подписчиков
    sub_text = ""
    if len(subs) >= 2:
        diff = subs[0]["count"] - subs[1]["count"]
        sign = "+" if diff >= 0 else ""
        sub_text = f"\n👥 Подписчики: {format_number(subs[0]['count'])} ({sign}{diff} за день)"
    
    lines = [
        f"📊 Статистика за {days} дней",
        f"",
        f"📝 Постов: {stats['posts']}",
        f"👁 Просмотров: {format_number(stats['views'])}",
        f"📈 Среднее/пост: {format_number(int(stats['avg_views']))}",
        f"↗️ Репостов: {format_number(stats['forwards'])}",
        f"❤️ Реакций: {format_number(stats['reactions'])}",
        sub_text,
    ]
    
    if top:
        lines.append("\n🏆 Топ посты:")
        for i, post in enumerate(top, 1):
            preview = (post["text"] or "")[:50].replace("\n", " ")
            lines.append(f"{i}. {format_number(post['views'])} 👁 — {preview}...")
    
    return "\n".join(line for line in lines if line is not None)


async def build_top_message(days: int = 7) -> str:
    top = await get_top_posts(days, limit=5)
    if not top:
        return "Нет данных за этот период"
    
    lines = [f"🏆 Топ-5 постов за {days} дней\n"]
    for i, post in enumerate(top, 1):
        date_str = datetime.fromtimestamp(post["date"]).strftime("%d.%m")
        preview = (post["text"] or "")[:80].replace("\n", " ")
        lines.append(
            f"{i}. [{date_str}] {format_number(post['views'])} 👁 "
            f"| {post['forwards']} ↗️ | {post['reactions']} ❤️\n"
            f"   {preview}...\n"
        )
    
    return "\n".join(lines)
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv
from datetime import datetime

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

CHANNEL_ID = os.getenv("CHANNEL_ID")   # @mychannel или -100xxxxx
ADMIN_ID = int(os.getenv("ADMIN_ID"))

from db import init_db, upsert_post, record_subscribers
from analytics import build_stats_message, build_top_message


@dp.message(Command("start"))
async def cmd_start(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "📊 Аналитика канала\n\n"
        "/stats — статистика за 7 дней\n"
        "/stats30 — за 30 дней\n"
        "/top — топ постов\n"
        "/sync — синхронизировать последние посты\n"
        "/subs — записать текущее число подписчиков"
    )


@dp.message(Command("stats"))
async def cmd_stats(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    text = await build_stats_message(days=7)
    await message.answer(text)


@dp.message(Command("stats30"))
async def cmd_stats30(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    text = await build_stats_message(days=30)
    await message.answer(text)


@dp.message(Command("top"))
async def cmd_top(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    text = await build_top_message(days=30)
    await message.answer(text)


@dp.message(Command("subs"))
async def cmd_subs(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    count = await bot.get_chat_member_count(CHANNEL_ID)
    await record_subscribers(count)
    await message.answer(f"Записано: {count:,} подписчиков")


@dp.message(Command("sync"))
async def cmd_sync(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    # Для синхронизации нужно форвардить посты из канала боту
    await message.answer(
        "Форвардни нужные посты из канала сюда — бот их запишет.\n"
        "Или используй /subs для записи числа подписчиков."
    )


# Принимать форварды из канала
@dp.message(lambda m: m.forward_from_chat and m.from_user.id == ADMIN_ID)
async def handle_forward(message: Message):
    fwd = message.forward_from_chat
    if str(fwd.id) != str(CHANNEL_ID).replace("@", ""):
        return
    
    reactions_count = 0
    if message.reactions:
        reactions_count = sum(r.count for r in message.reactions.reactions)
    
    await upsert_post(
        message_id=message.forward_from_message_id,
        date=message.forward_date.timestamp() if message.forward_date else 0,
        text=message.text or message.caption or "",
        views=message.views or 0,
        forwards=message.forwards or 0,
        reactions=reactions_count
    )
    await message.answer(f"✅ Записано: {message.views or 0:,} просмотров")


async def weekly_report():
    """Автодайджест по понедельникам."""
    text = await build_stats_message(days=7)
    await bot.send_message(ADMIN_ID, f"📅 Недельный дайджест\n\n{text}")


async def daily_subs():
    """Записывать подписчиков каждый день."""
    count = await bot.get_chat_member_count(CHANNEL_ID)
    await record_subscribers(count)


async def on_startup():
    scheduler = AsyncIOScheduler(timezone="Europe/Moscow")
    scheduler.add_job(weekly_report, "cron", day_of_week="mon", hour=9, minute=0)
    scheduler.add_job(daily_subs, "cron", hour=23, minute=59)
    scheduler.start()


async def main():
    await init_db()
    dp.startup.register(on_startup)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
CHANNEL_ID=@yourchannel
ADMIN_ID=123456789
DB_PATH=analytics.db
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

## Использование

1. Запусти бота
2. В Telegram: форвардни несколько постов из канала боту (он их запишет)
3. `/subs` — записать текущее число подписчиков
4. `/stats` — смотреть аналитику

Каждый день в 23:59 число подписчиков записывается автоматически. По понедельникам в 9:00 — приходит недельный дайджест.

---

::: info Prodвинутый вариант
Для полной аналитики (как в Telegram Analytics) нужен MTProto через Telethon или Pyrogram. Там доступны `channels.getFullChannel` и `stats.getBroadcastStats`. Но это требует телефон-аккаунт, не бот-токен — и сложнее в настройке.
:::
