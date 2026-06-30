# Бот с базой в Airtable

Airtable — это Google Sheets с API. Удобно: нетехнический контент-менеджер ведёт базу в понятном интерфейсе, а бот читает её и публикует. Без Notion, без кода на стороне клиента.

## Что делает

- Читает записи из Airtable с фильтром по статусу
- Публикует в Telegram-канал по расписанию
- Обновляет статус записи на «Опубликовано»
- Поддерживает текст, изображение, подпись

## Структура базы Airtable

Таблица `Posts`:
- `Title` (Single line text) — заголовок
- `Content` (Long text) — текст поста
- `Image` (Attachment) — изображение (необязательно)
- `Status` (Single select) — Черновик / Готово / Опубликовано
- `Scheduled At` (Date) — когда публиковать (необязательно)
- `Published At` (Date) — заполняется ботом

## Структура проекта

```
airtable-bot/
├── bot.py
├── airtable.py    # клиент Airtable API
├── publisher.py   # логика публикации
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
aiohttp
python-dotenv
apscheduler
```

## Airtable клиент (airtable.py)

```python
import aiohttp
import os
from datetime import datetime
from typing import Optional

AIRTABLE_TOKEN = os.getenv("AIRTABLE_TOKEN")
BASE_ID = os.getenv("AIRTABLE_BASE_ID")
TABLE_NAME = os.getenv("AIRTABLE_TABLE", "Posts")

BASE_URL = f"https://api.airtable.com/v0/{BASE_ID}/{TABLE_NAME}"
HEADERS = {
    "Authorization": f"Bearer {AIRTABLE_TOKEN}",
    "Content-Type": "application/json"
}


async def get_ready_posts() -> list[dict]:
    """Получить записи со статусом 'Готово'."""
    params = {
        "filterByFormula": "{Status} = 'Готово'",
        "sort[0][field]": "Scheduled At",
        "sort[0][direction]": "asc",
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.get(BASE_URL, headers=HEADERS, params=params) as resp:
            resp.raise_for_status()
            data = await resp.json()
    
    return data.get("records", [])


async def mark_published(record_id: str):
    """Обновить статус записи на 'Опубликовано'."""
    url = f"{BASE_URL}/{record_id}"
    payload = {
        "fields": {
            "Status": "Опубликовано",
            "Published At": datetime.now().strftime("%Y-%m-%dT%H:%M:%S.000Z")
        }
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.patch(url, headers=HEADERS, json=payload) as resp:
            resp.raise_for_status()


async def create_post(content: str, title: str = "") -> dict:
    """Создать новую запись."""
    payload = {
        "fields": {
            "Title": title or content[:50] + "...",
            "Content": content,
            "Status": "Черновик"
        }
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(BASE_URL, headers=HEADERS, json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()


def extract_post_data(record: dict) -> dict:
    """Извлечь нужные поля из записи Airtable."""
    fields = record["fields"]
    
    image_url = None
    attachments = fields.get("Image", [])
    if attachments:
        image_url = attachments[0].get("url")
    
    return {
        "id": record["id"],
        "title": fields.get("Title", ""),
        "content": fields.get("Content", ""),
        "image_url": image_url,
        "scheduled_at": fields.get("Scheduled At"),
    }
```

## Логика публикации (publisher.py)

```python
import aiohttp
from aiogram import Bot
from aiogram.types import URLInputFile
import logging
import os

from airtable import get_ready_posts, mark_published, extract_post_data

logger = logging.getLogger(__name__)

CHANNEL_ID = os.getenv("CHANNEL_ID")


async def publish_pending(bot: Bot):
    """Опубликовать все готовые посты."""
    records = await get_ready_posts()
    
    if not records:
        logger.info("Нет постов для публикации")
        return
    
    published = 0
    for record in records:
        post = extract_post_data(record)
        try:
            await publish_post(bot, post)
            await mark_published(post["id"])
            published += 1
            logger.info(f"Опубликовано: {post['title'][:50]}")
        except Exception as e:
            logger.error(f"Ошибка публикации {post['id']}: {e}")
    
    logger.info(f"Опубликовано {published}/{len(records)} постов")
    return published


async def publish_post(bot: Bot, post: dict):
    """Опубликовать один пост в канал."""
    text = post["content"]
    if post["title"]:
        text = f"**{post['title']}**\n\n{text}"
    
    if post["image_url"]:
        # Скачать изображение из Airtable (ссылки временные)
        async with aiohttp.ClientSession() as session:
            async with session.get(post["image_url"]) as resp:
                img_data = await resp.read()
        
        from aiogram.types import BufferedInputFile
        photo = BufferedInputFile(img_data, filename="image.jpg")
        
        await bot.send_photo(
            chat_id=CHANNEL_ID,
            photo=photo,
            caption=text[:1024],  # лимит подписи 1024
            parse_mode="Markdown"
        )
    else:
        await bot.send_message(
            chat_id=CHANNEL_ID,
            text=text,
            parse_mode="Markdown"
        )
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

ADMIN_ID = int(os.getenv("ADMIN_ID"))

from airtable import get_ready_posts, create_post, extract_post_data
from publisher import publish_pending


@dp.message(Command("start"))
async def cmd_start(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "Бот для публикации из Airtable.\n\n"
        "/check — показать посты готовые к публикации\n"
        "/publish — опубликовать сейчас\n"
        "/add <текст> — добавить черновик в Airtable"
    )


@dp.message(Command("check"))
async def cmd_check(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    records = await get_ready_posts()
    if not records:
        await message.answer("Нет постов со статусом 'Готово'")
        return
    
    lines = []
    for i, record in enumerate(records, 1):
        post = extract_post_data(record)
        preview = post["content"][:80].replace("\n", " ")
        has_image = "🖼" if post["image_url"] else "📝"
        scheduled = f" [{post['scheduled_at']}]" if post["scheduled_at"] else ""
        lines.append(f"{i}. {has_image} {post['title'] or preview}{scheduled}")
    
    await message.answer(f"Готово к публикации ({len(records)}):\n\n" + "\n".join(lines))


@dp.message(Command("publish"))
async def cmd_publish(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    status = await message.answer("Публикую...")
    count = await publish_pending(bot)
    await status.edit_text(f"Опубликовано {count} постов")


@dp.message(Command("add"))
async def cmd_add(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    content = message.text.removeprefix("/add").strip()
    if not content:
        await message.answer("Напиши текст: /add Текст поста")
        return
    
    record = await create_post(content)
    record_id = record["id"]
    await message.answer(
        f"Черновик создан в Airtable.\n"
        f"ID: {record_id}\n\n"
        f"Поставь статус 'Готово' в Airtable когда захочешь опубликовать."
    )


async def scheduled_publish():
    """Запускается по расписанию — публикует готовые посты."""
    logger.info("Scheduled publish run")
    await publish_pending(bot)


async def on_startup():
    scheduler = AsyncIOScheduler(timezone="Europe/Moscow")
    scheduler.add_job(
        scheduled_publish,
        "cron",
        hour="9,12,18",  # 9:00, 12:00, 18:00 МСК
        minute=0
    )
    scheduler.start()
    logger.info("Scheduler started")


async def main():
    dp.startup.register(on_startup)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_bot_token
AIRTABLE_TOKEN=your_pat_token
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE=Posts
CHANNEL_ID=@your_channel
ADMIN_ID=123456789
```

## Получить токен Airtable

1. airtable.com → Account → Developer Hub
2. Personal access tokens → Create token
3. Scopes: `data.records:read`, `data.records:write`
4. Access: выбрать свою базу

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

---

::: tip Workflow для контент-менеджера
1. Пишет пост в Airtable (Черновик)
2. Указывает дату публикации в поле `Scheduled At`
3. Ставит статус «Готово»
4. Бот сам публикует по расписанию и ставит «Опубликовано»

Никакого доступа к боту — только Airtable.
:::
