# Notion → Telegram: автопостинг из базы

Ведёшь контент-план в Notion, а публиковать хочешь автоматически? Этот бот каждый час проверяет базу Notion — если статус «Готово к публикации», берёт текст и постит в Telegram-канал.

## Что понадобится

- Notion-интеграция (API-ключ)
- База Notion с полями: Title, Status, Body, Publish At
- Telegram-бот и ID канала

## Настройка Notion

1. Зайди на [notion.so/my-integrations](https://www.notion.so/my-integrations) → «New integration»
2. Дай название, выбери workspace → получи **Internal Integration Secret**
3. Открой свою базу в Notion → `...` (три точки) → «Connect to» → выбери свою интеграцию
4. Скопируй **Database ID** из URL: `notion.so/workspace/<database-id>?v=...`

Структура базы Notion:
| Поле | Тип | Назначение |
|------|-----|------------|
| Title | Title | Название/заголовок поста |
| Status | Select | «Черновик» / «Готово» / «Опубликовано» |
| Body | Text | Текст поста |
| Publish At | Date | Дата публикации (опционально) |

## Структура проекта

```
notion-bot/
├── notion_client.py   # работа с Notion API
├── bot.py             # Telegram-бот + планировщик
├── .env
└── requirements.txt
```

## requirements.txt

```
notion-client
aiogram==3.13
apscheduler
python-dotenv
```

## Клиент Notion (notion_client.py)

```python
from notion_client import Client
import os
from datetime import datetime

notion = Client(auth=os.getenv("NOTION_TOKEN"))
DATABASE_ID = os.getenv("NOTION_DATABASE_ID")

READY_STATUS = "Готово"       # значение статуса для публикации
DONE_STATUS = "Опубликовано"  # значение после публикации


def get_ready_posts() -> list[dict]:
    """Получить посты готовые к публикации"""
    response = notion.databases.query(
        database_id=DATABASE_ID,
        filter={
            "property": "Status",
            "select": {"equals": READY_STATUS}
        }
    )
    
    posts = []
    for page in response["results"]:
        props = page["properties"]
        
        # Извлечь заголовок
        title_parts = props.get("Title", {}).get("title", [])
        title = "".join(p["plain_text"] for p in title_parts)
        
        # Извлечь тело поста
        body_parts = props.get("Body", {}).get("rich_text", [])
        body = "".join(p["plain_text"] for p in body_parts)
        
        # Дата публикации (если указана)
        publish_at_prop = props.get("Publish At", {}).get("date")
        publish_at = None
        if publish_at_prop and publish_at_prop.get("start"):
            publish_at = datetime.fromisoformat(publish_at_prop["start"])
        
        posts.append({
            "id": page["id"],
            "title": title,
            "body": body,
            "publish_at": publish_at,
        })
    
    return posts


def mark_as_published(page_id: str):
    """Пометить пост как опубликованный"""
    notion.pages.update(
        page_id=page_id,
        properties={
            "Status": {"select": {"name": DONE_STATUS}}
        }
    )
```

## Бот с планировщиком (bot.py)

```python
import asyncio
import os
import logging
from datetime import datetime, timezone
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher
from aiogram.types import Message
from aiogram.filters import Command
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

CHANNEL_ID = os.getenv("CHANNEL_ID")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

from notion_client_wrapper import get_ready_posts, mark_as_published


def format_post(title: str, body: str) -> str:
    """Форматировать пост для Telegram"""
    if title:
        return f"**{title}**\n\n{body}"
    return body


async def publish_ready_posts():
    """Главная задача: проверить Notion и опубликовать готовые посты"""
    logger.info("Проверяю Notion на новые посты...")
    
    try:
        posts = get_ready_posts()
    except Exception as e:
        logger.error(f"Ошибка при получении постов из Notion: {e}")
        return
    
    if not posts:
        logger.info("Новых постов нет.")
        return
    
    published_count = 0
    
    for post in posts:
        # Проверить дату публикации
        if post["publish_at"]:
            now = datetime.now(timezone.utc)
            if post["publish_at"] > now:
                logger.info(f"Пост '{post['title']}' запланирован на {post['publish_at']}, пропускаю")
                continue
        
        text = format_post(post["title"], post["body"])
        
        if not text.strip():
            logger.warning(f"Пост {post['id']} пустой, пропускаю")
            continue
        
        try:
            await bot.send_message(
                CHANNEL_ID,
                text,
                parse_mode="Markdown"
            )
            mark_as_published(post["id"])
            published_count += 1
            logger.info(f"Опубликовал: {post['title']}")
            
            # Пауза между постами чтобы не спамить
            await asyncio.sleep(2)
        
        except Exception as e:
            logger.error(f"Ошибка публикации '{post['title']}': {e}")
    
    if published_count > 0 and ADMIN_ID:
        await bot.send_message(ADMIN_ID, f"✅ Опубликовано постов: {published_count}")


# Команды для ручного управления

@dp.message(Command("check"))
async def cmd_check(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer("Проверяю Notion...")
    await publish_ready_posts()


@dp.message(Command("status"))
async def cmd_status(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    posts = get_ready_posts()
    if posts:
        lines = [f"• {p['title'] or 'Без заголовка'}" for p in posts]
        await message.answer("Готово к публикации:\n" + "\n".join(lines))
    else:
        await message.answer("Нет постов готовых к публикации.")


async def main():
    # Каждый час проверять Notion
    scheduler.add_job(
        publish_ready_posts,
        "interval",
        hours=1,
        id="publish_posts"
    )
    scheduler.start()
    
    logger.info("Бот запущен. Проверка Notion каждый час.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CHANNEL_ID=-100123456789
ADMIN_ID=123456789
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

## Деплой (systemd)

```ini
[Unit]
Description=Notion Publisher Bot
After=network.target

[Service]
User=office
WorkingDirectory=/home/office/notion-bot
ExecStart=/home/office/notion-bot/.venv/bin/python bot.py
Restart=always
EnvironmentFile=/home/office/notion-bot/.env

[Install]
WantedBy=multi-user.target
```

## Дополнения

**Изображения из Notion:**
Если у записи есть обложка (Cover) — можно отправить её вместе с постом. Извлекается из `page["cover"]["external"]["url"]` или `page["cover"]["file"]["url"]`.

**Несколько статусов:**
Можно настроить разные каналы для разных статусов: «Готово в канал A» и «Готово в канал B».

**Промпт для расширения:**
```
Добавь в notion-bot поддержку изображений.
При наличии поля "Image" (URL файла или внешней ссылки) — 
отправлять пост как send_photo с caption вместо send_message.
```

---

::: tip Рабочий процесс
Пишешь пост в Notion → меняешь статус на «Готово» → бот публикует в течение часа → статус меняется на «Опубликовано». Всё в одном месте, ничего не теряется.
:::
