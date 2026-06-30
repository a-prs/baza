# RAG-бот: отвечает на вопросы по твоим документам

Загружаешь свои материалы (статьи, инструкции, FAQ) — бот отвечает на вопросы по ним. Не знает — честно скажет. Ответы только из твоей базы, без фантазий.

**Применения:**
- Бот-помощник по документации компании
- Поддержка клиентов по FAQ
- Личный ассистент по архиву заметок
- Чат с PDF-документом

## Что понадобится

- Python 3.10+
- Telegram-бот токен
- API-ключ Anthropic (Claude для ответов)
- API-ключ OpenAI (для создания embeddings)

## Структура проекта

```
rag-bot/
├── bot.py          # Telegram-бот
├── rag.py          # Логика поиска и ответов
├── ingest.py       # Загрузка документов в базу
├── .env
├── requirements.txt
└── chroma_db/      # Создастся автоматически
```

## Зависимости

```bash
pip install aiogram==3.13 anthropic openai chromadb python-dotenv
```

`requirements.txt`:
```
aiogram==3.13
anthropic
openai
chromadb
python-dotenv
```

## RAG-движок (rag.py)

```python
import os
import chromadb
from anthropic import Anthropic
from openai import OpenAI

chroma = chromadb.PersistentClient(path="./chroma_db")
collection = chroma.get_or_create_collection("docs")

claude = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EMBED_MODEL = "text-embedding-3-small"


def _embed(text: str) -> list[float]:
    return oai.embeddings.create(model=EMBED_MODEL, input=text).data[0].embedding


def add_text(doc_id: str, text: str, source: str = "") -> int:
    """Разбить текст на чанки и добавить в базу. Вернуть кол-во чанков."""
    words = text.split()
    chunk_size, overlap = 400, 40
    chunks = []
    i = 0
    while i < len(words):
        chunks.append(" ".join(words[i:i + chunk_size]))
        i += chunk_size - overlap

    ids, embeddings, docs, metas = [], [], [], []
    for idx, chunk in enumerate(chunks):
        ids.append(f"{doc_id}:{idx}")
        embeddings.append(_embed(chunk))
        docs.append(chunk)
        metas.append({"source": source, "chunk": idx})

    collection.add(ids=ids, embeddings=embeddings, documents=docs, metadatas=metas)
    return len(chunks)


def search(query: str, n: int = 4) -> list[str]:
    """Найти релевантные чанки по запросу."""
    results = collection.query(
        query_embeddings=[_embed(query)],
        n_results=min(n, collection.count() or 1),
    )
    return results["documents"][0] if results["documents"] else []


def answer(question: str) -> str:
    """Ответить на вопрос используя базу."""
    if collection.count() == 0:
        return "База знаний пуста. Добавь документы командой /add."

    chunks = search(question)
    if not chunks:
        return "Ничего релевантного не найдено."

    context = "\n\n---\n\n".join(chunks)
    resp = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        messages=[{
            "role": "user",
            "content": (
                "Ответь на вопрос ТОЛЬКО на основе контекста ниже. "
                "Если ответа в контексте нет — так и скажи: «Этого в базе нет.»\n\n"
                f"Контекст:\n{context}\n\n"
                f"Вопрос: {question}"
            ),
        }],
    )
    return resp.content[0].text


def stats() -> str:
    count = collection.count()
    return f"В базе {count} фрагментов."
```

## Загрузчик документов (ingest.py)

```python
import os
import sys
from rag import add_text

def ingest_file(path: str):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    n = add_text(doc_id=path, text=text, source=os.path.basename(path))
    print(f"✓ {path}: {n} чанков добавлено")

def ingest_dir(directory: str):
    exts = {".txt", ".md"}
    for fname in os.listdir(directory):
        if any(fname.endswith(e) for e in exts):
            ingest_file(os.path.join(directory, fname))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python ingest.py <файл_или_папка>")
        sys.exit(1)

    target = sys.argv[1]
    if os.path.isdir(target):
        ingest_dir(target)
    else:
        ingest_file(target)
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message
from aiogram.filters import Command

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

# Импортируем rag после load_dotenv — нужны ключи в env
from rag import add_text, answer, stats


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "Привет! Я отвечаю на вопросы по загруженной базе знаний.\n\n"
        "Команды:\n"
        "/add <текст> — добавить текст в базу\n"
        "/stats — сколько документов в базе\n"
        "Или просто напиши вопрос."
    )


@dp.message(Command("add"))
async def cmd_add(message: Message):
    text = message.text.removeprefix("/add").strip()
    if not text:
        await message.answer("Напиши текст после команды: /add <твой текст>")
        return
    n = add_text(
        doc_id=f"user:{message.from_user.id}:{message.message_id}",
        text=text,
        source="Telegram"
    )
    await message.answer(f"Добавлено ({n} фрагмент{'ов' if n != 1 else ''}).")


@dp.message(Command("stats"))
async def cmd_stats(message: Message):
    await message.answer(stats())


@dp.message(F.text)
async def handle_question(message: Message):
    await message.answer("Ищу ответ...")
    reply = answer(message.text)
    await message.answer(reply)


async def main():
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_bot_token
ANTHROPIC_API_KEY=your_key
OPENAI_API_KEY=your_key
```

## Запуск

```bash
# Установить зависимости
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Загрузить документы (опционально — можно добавлять через /add)
python ingest.py ./my-docs/

# Запустить бота
python bot.py
```

## Деплой (systemd)

```ini
[Unit]
Description=RAG Bot
After=network.target

[Service]
User=office
WorkingDirectory=/home/office/rag-bot
ExecStart=/home/office/rag-bot/.venv/bin/python bot.py
Restart=always
EnvironmentFile=/home/office/rag-bot/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp rag-bot.service /etc/systemd/system/
sudo systemctl enable --now rag-bot
```

## Промпт для расширения

```
Добавь в RAG-бота возможность загружать PDF-документы.
Используй PyPDF2 для извлечения текста из PDF.
Команда /upload — попроси прислать документ, 
получи file_id, скачай через bot.download(), 
извлеки текст и добавь в ChromaDB.
```

---

::: tip Как улучшить поиск
Если ответы не точные — уменьши `chunk_size` до 200–300 слов (меньше чанк = точнее попадание) и увеличь `n` до 6–8 в функции `search`. Качество embeddings можно повысить заменив `text-embedding-3-small` на `text-embedding-3-large` (дороже, но точнее).
:::
