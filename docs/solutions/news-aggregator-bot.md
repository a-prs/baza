# Новостной агрегатор с AI-фильтром

Бот собирает новости из нескольких RSS-лент, фильтрует нерелевантные через Claude, группирует по темам и публикует дайджест по расписанию. Можно настроить под любую нишу.

## Что делает

1. Раз в час парсит список RSS-источников
2. Claude оценивает каждую новость: релевантна ли теме канала (0-10)
3. Новости с оценкой ≥7 кладёт в очередь
4. В 09:00 и 19:00 публикует дайджест дня с краткими саммари
5. Дедуплицирует — не публикует одно и то же дважды

## Структура

```
news-bot/
├── bot.py
├── fetcher.py    # RSS и AI-оценка
├── db.py
├── scheduler.py
├── sources.yaml
├── .env
└── requirements.txt
```

## sources.yaml

```yaml
channel_id: "@your_channel_or_chat_id"
topic: "AI, нейросети, автоматизация бизнеса"

# Порог релевантности (0-10)
min_score: 7

sources:
  - name: "Хабр / ИИ"
    url: "https://habr.com/ru/rss/hub/artificial_intelligence/all/"
  - name: "TechCrunch AI"
    url: "https://techcrunch.com/category/artificial-intelligence/feed/"
  - name: "The Verge AI"
    url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"
  - name: "VentureBeat AI"
    url: "https://venturebeat.com/category/ai/feed/"
```

## fetcher.py

```python
import feedparser
import aiohttp
import asyncio
import yaml
import json
import os
from anthropic import AsyncAnthropic

with open("sources.yaml") as f:
    CONFIG = yaml.safe_load(f)

claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


async def fetch_feed(session: aiohttp.ClientSession, source: dict) -> list[dict]:
    """Загрузить и распарсить RSS-ленту."""
    try:
        async with session.get(source["url"], timeout=aiohttp.ClientTimeout(total=10)) as resp:
            text = await resp.text()
    except Exception as e:
        print(f"Feed error {source['name']}: {e}")
        return []
    
    feed = feedparser.parse(text)
    
    items = []
    for entry in feed.entries[:20]:  # не более 20 свежих
        items.append({
            "title": entry.get("title", ""),
            "url": entry.get("link", ""),
            "summary": entry.get("summary", "")[:500],  # обрезать
            "published": entry.get("published", ""),
            "source": source["name"],
        })
    
    return items


async def score_items(items: list[dict]) -> list[dict]:
    """Оценить релевантность пачки новостей одним запросом."""
    if not items:
        return []
    
    items_text = "\n".join(
        f"{i + 1}. [{item['source']}] {item['title']}: {item['summary'][:150]}"
        for i, item in enumerate(items)
    )
    
    topic = CONFIG["topic"]
    
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        messages=[{
            "role": "user",
            "content": f"""Оцени релевантность каждой новости для тематики: "{topic}"

Новости:
{items_text}

Для каждой новости верни JSON-строку: {{"i": номер, "score": 0-10, "summary_ru": "краткое саммари на русском (1-2 предл.)"}}
score: 10 = идеально релевантно, 0 = совсем не по теме
Только JSON-массив, без пояснений:"""
        }]
    )
    
    try:
        scored = json.loads(response.content[0].text.strip())
    except json.JSONDecodeError:
        # Парсить построчно если JSON сломан
        import re
        scored = []
        for line in response.content[0].text.split("\n"):
            m = re.search(r'\{.*\}', line)
            if m:
                try:
                    scored.append(json.loads(m.group()))
                except Exception:
                    pass
    
    # Мёрж оценок с оригинальными данными
    result = []
    for s in scored:
        idx = s.get("i", 0) - 1
        if 0 <= idx < len(items):
            item = items[idx].copy()
            item["score"] = s.get("score", 0)
            item["summary_ru"] = s.get("summary_ru", item["title"])
            result.append(item)
    
    return result


async def fetch_all_sources() -> list[dict]:
    """Собрать новости со всех источников и оценить."""
    async with aiohttp.ClientSession() as session:
        all_items = []
        
        for source in CONFIG["sources"]:
            items = await fetch_feed(session, source)
            all_items.extend(items)
            await asyncio.sleep(0.5)  # не спамить
    
    # Оценить пачками по 15
    batch_size = 15
    scored_items = []
    
    for i in range(0, len(all_items), batch_size):
        batch = all_items[i:i + batch_size]
        scored = await score_items(batch)
        scored_items.extend(scored)
    
    return scored_items
```

## db.py

```python
import aiosqlite
import hashlib
import os

DB_PATH = os.getenv("DB_PATH", "news.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS news (
                id TEXT PRIMARY KEY,  -- hash URL
                title TEXT,
                url TEXT,
                source TEXT,
                score REAL,
                summary_ru TEXT,
                published TEXT,
                sent BOOLEAN DEFAULT 0,
                fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()


def url_hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:16]


async def save_news(items: list[dict], min_score: float = 7.0) -> int:
    """Сохранить релевантные новости. Возвращает кол-во новых."""
    added = 0
    async with aiosqlite.connect(DB_PATH) as db:
        for item in items:
            if item.get("score", 0) < min_score:
                continue
            
            item_id = url_hash(item["url"])
            
            try:
                await db.execute("""
                    INSERT INTO news (id, title, url, source, score, summary_ru, published)
                    VALUES (?,?,?,?,?,?,?)
                """, (
                    item_id, item["title"], item["url"],
                    item["source"], item["score"],
                    item.get("summary_ru", ""), item.get("published", "")
                ))
                added += 1
            except Exception:
                pass  # дубль — пропускаем
        
        await db.commit()
    
    return added


async def get_unsent(limit: int = 10) -> list[dict]:
    """Получить непубликованные новости по убыванию оценки."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("""
            SELECT * FROM news WHERE sent = 0
            ORDER BY score DESC, fetched_at ASC
            LIMIT ?
        """, (limit,))
        return [dict(r) for r in rows]


async def mark_sent(ids: list[str]):
    if not ids:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        placeholders = ",".join("?" for _ in ids)
        await db.execute(f"UPDATE news SET sent = 1 WHERE id IN ({placeholders})", ids)
        await db.commit()
```

## scheduler.py

```python
import asyncio
import os
import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from aiogram import Bot

from fetcher import fetch_all_sources
from db import save_news, get_unsent, mark_sent

with open("sources.yaml") as f:
    CONFIG = yaml.safe_load(f)

bot = Bot(token=os.getenv("BOT_TOKEN"))
scheduler = AsyncIOScheduler()


async def job_fetch():
    """Раз в час: собрать новые новости."""
    print("Fetching news...")
    items = await fetch_all_sources()
    added = await save_news(items, min_score=CONFIG.get("min_score", 7))
    print(f"Added {added} new items")


async def job_digest():
    """Публиковать дайджест дня."""
    unsent = await get_unsent(limit=8)
    
    if not unsent:
        print("No news for digest")
        return
    
    # Сформировать дайджест
    lines = ["📰 *Дайджест AI-новостей*\n"]
    
    for item in unsent:
        score_stars = "🔥" if item["score"] >= 9 else "⭐"
        lines.append(
            f"{score_stars} [{item['title']}]({item['url']})\n"
            f"_{item['summary_ru']}_\n"
            f"📌 {item['source']}\n"
        )
    
    digest_text = "\n".join(lines)
    
    # Ограничение Telegram: 4096 символов
    if len(digest_text) > 4000:
        digest_text = digest_text[:3950] + "...\n"
    
    channel = CONFIG["channel_id"]
    
    await bot.send_message(
        chat_id=channel,
        text=digest_text,
        parse_mode="Markdown",
        disable_web_page_preview=True
    )
    
    # Отметить как опубликованное
    await mark_sent([item["id"] for item in unsent])
    print(f"Digest sent: {len(unsent)} items")


def setup_scheduler():
    scheduler.add_job(job_fetch, "interval", hours=1, id="fetch")
    scheduler.add_job(job_digest, "cron", hour="9,19", minute=0, id="digest")
    scheduler.start()
```

## bot.py

```python
import asyncio
import os
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message
from dotenv import load_dotenv

from db import init_db
from scheduler import setup_scheduler, job_fetch, job_digest

load_dotenv()

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))


@dp.message(Command("fetch"))
async def cmd_fetch(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer("Запускаю сбор новостей...")
    await job_fetch()
    await message.answer("Готово!")


@dp.message(Command("digest"))
async def cmd_digest(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await job_digest()


async def main():
    await init_db()
    setup_scheduler()
    
    # Первый сбор при старте
    asyncio.create_task(job_fetch())
    
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
ANTHROPIC_API_KEY=your_key
ADMIN_ID=your_telegram_id
DB_PATH=news.db
```

## Запуск

```bash
pip install aiogram anthropic aiosqlite feedparser aiohttp apscheduler python-dotenv pyyaml
python bot.py
```

---

::: tip Настройка под нишу
Измени `topic` в `sources.yaml` и список источников — бот автоматически подстроит фильтрацию. Для русских новостей добавь источники вида `https://habr.com/ru/rss/hub/<hub>/all/`. Порог `min_score: 7` можно снизить до 5 если новостей мало.
:::
