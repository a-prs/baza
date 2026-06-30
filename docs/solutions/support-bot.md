# Бот службы поддержки

Бот отвечает на частые вопросы через AI, ищет в базе знаний, и передаёт сложные запросы живому оператору. Снимает 80% обращений без участия человека.

## Логика

```
Пользователь пишет вопрос
    ↓
Поиск в FAQ (ключевые слова / векторный)
    ├── Нашёл → AI-ответ с ссылкой на статью
    └── Не нашёл → AI пробует ответить общо
                        ├── Уверен → ответить
                        └── Не уверен → создать тикет → оператор
```

## Структура

```
support-bot/
├── bot.py
├── db.py          # пользователи, тикеты, FAQ
├── knowledge.py   # база знаний и поиск
├── ai_handler.py  # логика ответа через Claude
├── operator.py    # передача оператору
├── faq.json       # статьи FAQ
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
anthropic
aiosqlite
python-dotenv
```

## База знаний (faq.json)

```json
[
  {
    "id": "pricing",
    "title": "Стоимость подписки",
    "keywords": ["цена", "стоимость", "сколько стоит", "тариф", "подписка"],
    "content": "Базовый план — 200 Stars/месяц (≈$2). Включает 200 AI-запросов в день. Premium — 500 Stars/месяц, безлимит."
  },
  {
    "id": "refund",
    "title": "Возврат средств",
    "keywords": ["возврат", "вернуть деньги", "refund"],
    "content": "Telegram Stars не возвращаются согласно политике Telegram. Если есть технические проблемы — напишите @support."
  },
  {
    "id": "cancel",
    "title": "Отмена подписки",
    "keywords": ["отменить", "отписаться", "прекратить"],
    "content": "Команда /cancel отменяет подписку. Доступ сохраняется до конца оплаченного периода."
  }
]
```

## Поиск в FAQ (knowledge.py)

```python
import json
import os

FAQ_PATH = os.path.join(os.path.dirname(__file__), "faq.json")


def load_faq() -> list[dict]:
    with open(FAQ_PATH, encoding="utf-8") as f:
        return json.load(f)


FAQ = load_faq()
FAQ_TEXT = "\n\n".join(
    f"### {item['title']}\n{item['content']}"
    for item in FAQ
)


def search_faq(query: str) -> list[dict]:
    """Поиск по ключевым словам (без внешних зависимостей)."""
    query_lower = query.lower()
    results = []
    
    for item in FAQ:
        score = 0
        for kw in item["keywords"]:
            if kw.lower() in query_lower:
                score += 1
        if score > 0:
            results.append({"item": item, "score": score})
    
    results.sort(key=lambda x: x["score"], reverse=True)
    return [r["item"] for r in results[:3]]
```

## AI-обработчик (ai_handler.py)

```python
from anthropic import AsyncAnthropic
import os
import json

from knowledge import FAQ_TEXT, search_faq

claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = f"""Ты — помощник службы поддержки. 
Отвечай только на основе базы знаний. Если ответа нет — честно скажи.

БАЗА ЗНАНИЙ:
{FAQ_TEXT}

ПРАВИЛА:
- Короткие ответы (2-3 предложения)
- Если точного ответа нет — скажи "Не уверен, передам оператору"
- Не выдумывай детали которых нет в базе знаний
- Предложи команду /operator если вопрос сложный"""


async def get_ai_answer(question: str) -> dict:
    """
    Вернуть ответ AI + флаг нужен ли оператор.
    """
    relevant_faq = search_faq(question)
    
    # Дополнительный контекст из найденного FAQ
    extra_context = ""
    if relevant_faq:
        extra_context = "\n\nНаиболее релевантные статьи:\n" + "\n".join(
            f"- {item['title']}: {item['content']}"
            for item in relevant_faq
        )
    
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=SYSTEM_PROMPT + extra_context,
        messages=[{
            "role": "user",
            "content": question
        }]
    )
    
    answer = response.content[0].text
    
    # Определить нужен ли оператор
    needs_operator = (
        "Не уверен" in answer
        or "передам оператору" in answer.lower()
        or "оператор" in answer.lower()
        or len(answer) < 20  # слишком короткий ответ = неуверенность
    )
    
    return {
        "answer": answer,
        "needs_operator": needs_operator,
        "faq_matches": [f["id"] for f in relevant_faq],
    }
```

## База данных (db.py)

```python
import aiosqlite
import os
from datetime import datetime

DB_PATH = os.getenv("DB_PATH", "support.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id INTEGER PRIMARY KEY,
                username TEXT,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                question TEXT,
                ai_answer TEXT,
                status TEXT DEFAULT 'open',
                operator_id INTEGER,
                operator_answer TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP
            )
        """)
        await db.commit()


async def create_ticket(user_id: int, question: str, ai_answer: str = "") -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO tickets (user_id, question, ai_answer) VALUES (?, ?, ?)",
            (user_id, question, ai_answer)
        )
        await db.commit()
        return cursor.lastrowid


async def resolve_ticket(ticket_id: int, operator_id: int, answer: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            UPDATE tickets SET status='resolved', operator_id=?, operator_answer=?, 
            resolved_at=CURRENT_TIMESTAMP WHERE id=?
        """, (operator_id, answer, ticket_id))
        await db.commit()


async def get_open_tickets() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            "SELECT * FROM tickets WHERE status='open' ORDER BY created_at DESC"
        )
        return [dict(r) for r in rows]
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.utils.keyboard import InlineKeyboardBuilder

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

OPERATOR_CHAT_ID = int(os.getenv("OPERATOR_CHAT_ID"))  # чат операторов

from db import init_db, create_ticket, resolve_ticket, get_open_tickets
from ai_handler import get_ai_answer


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "Привет! Я помощник службы поддержки.\n\n"
        "Напиши свой вопрос — постараюсь помочь.\n"
        "/faq — частые вопросы\n"
        "/operator — связаться с оператором"
    )


@dp.message(Command("faq"))
async def cmd_faq(message: Message):
    from knowledge import FAQ
    lines = ["📚 Частые вопросы:\n"]
    for item in FAQ:
        lines.append(f"• {item['title']}")
    lines.append("\nНапиши вопрос своими словами — отвечу точнее.")
    await message.answer("\n".join(lines))


@dp.message(Command("operator"))
async def cmd_operator(message: Message):
    await message.answer(
        "Создаю тикет для оператора...\n"
        "Напиши свой вопрос следующим сообщением."
    )
    # Можно добавить FSM для принудительной передачи оператору


@dp.message(F.text & ~F.text.startswith("/"))
async def handle_question(message: Message):
    question = message.text
    user_id = message.from_user.id
    
    await bot.send_chat_action(message.chat.id, "typing")
    
    # Получить ответ AI
    result = await get_ai_answer(question)
    
    if result["needs_operator"]:
        # Создать тикет
        ticket_id = await create_ticket(user_id, question, result["answer"])
        
        # Уведомить оператора
        kb = InlineKeyboardBuilder()
        kb.button(text="Ответить", callback_data=f"resolve:{ticket_id}:{user_id}")
        
        await bot.send_message(
            OPERATOR_CHAT_ID,
            f"🎫 Тикет #{ticket_id}\n"
            f"От: {message.from_user.full_name} (@{message.from_user.username})\n\n"
            f"Вопрос: {question}\n\n"
            f"AI-ответ: {result['answer']}",
            reply_markup=kb.as_markup()
        )
        
        await message.answer(
            f"{result['answer']}\n\n"
            f"Этот вопрос требует внимания оператора (тикет #{ticket_id}). "
            f"Ответим в течение нескольких часов."
        )
    else:
        await message.answer(result["answer"])


# Оператор отвечает на тикет
@dp.callback_query(F.data.startswith("resolve:"))
async def handle_resolve(callback: CallbackQuery):
    _, ticket_id, user_id = callback.data.split(":")
    
    await callback.message.answer(
        f"Напишите ответ для тикета #{ticket_id}:\n"
        f"(следующее сообщение будет отправлено пользователю)"
    )
    
    # Простая реализация через ожидание следующего сообщения от оператора
    # В продакшне лучше использовать FSM
    @dp.message(F.chat.id == callback.message.chat.id)
    async def get_operator_answer(msg: Message):
        dp.message.handlers.remove(get_operator_answer)  # удалить хендлер
        
        # Сохранить ответ
        await resolve_ticket(int(ticket_id), msg.from_user.id, msg.text)
        
        # Отправить пользователю
        await bot.send_message(
            int(user_id),
            f"✅ Ответ от оператора по тикету #{ticket_id}:\n\n{msg.text}"
        )
        
        await msg.answer(f"Ответ отправлен пользователю {user_id}")
    
    await callback.answer()


# Список открытых тикетов для операторов
@dp.message(Command("tickets"))
async def cmd_tickets(message: Message):
    if message.chat.id != OPERATOR_CHAT_ID:
        return
    
    tickets = await get_open_tickets()
    if not tickets:
        await message.answer("Нет открытых тикетов")
        return
    
    lines = [f"📋 Открытые тикеты ({len(tickets)}):\n"]
    for t in tickets[:10]:
        lines.append(f"#{t['id']}: {t['question'][:60]}...")
    
    await message.answer("\n".join(lines))


async def main():
    await init_db()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
ANTHROPIC_API_KEY=your_key
OPERATOR_CHAT_ID=-100xxxxxxxxxx  # ID группы операторов
DB_PATH=support.db
```

## Как расширить

- **Векторный поиск по FAQ** — добавить ChromaDB (глава 31), качество ответов вырастет
- **Тег-система** — категоризировать тикеты по темам
- **SLA-напоминания** — APScheduler напоминает операторам о тикетах старше 4ч
- **Рейтинг ответов** — кнопки «Помогло / Не помогло» после AI-ответа

---

::: tip База знаний
Начни с 20-30 FAQ-записями. После первой недели работы посмотри на тикеты которые ушли к оператору — это пробелы в базе знаний. Добавь их, и доля автоответов вырастет с 50% до 80%.
:::
