# Бот с платной подпиской

Freemium-модель: базовые функции бесплатно, расширенные — за подписку. Пример: 5 бесплатных запросов к AI в день → безлимит за звёзды.

## Логика

```
Пользователь → проверить статус подписки
    ├── Нет подписки → freemium лимит (например 5 запросов/день)
    │   └── Лимит исчерпан → предложить подписку
    └── Есть подписка → полный доступ
```

## Структура

```
sub-bot/
├── bot.py
├── db.py          # подписки и лимиты
├── subscription.py # логика проверки и продления
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
anthropic
python-dotenv
aiosqlite
apscheduler
```

## База данных (db.py)

```python
import aiosqlite
import os
from datetime import datetime, timedelta

DB_PATH = os.getenv("DB_PATH", "bot.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id INTEGER PRIMARY KEY,
                username TEXT,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_premium BOOLEAN DEFAULT 0,
                premium_until TIMESTAMP,
                daily_requests INTEGER DEFAULT 0,
                last_request_date TEXT DEFAULT ''
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER,
                charge_id TEXT UNIQUE,
                stars INTEGER,
                days INTEGER,
                purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()


async def get_or_create_user(telegram_id: int, username: str = "") -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        row = await db.execute_fetchone(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        if not row:
            await db.execute(
                "INSERT INTO users (telegram_id, username) VALUES (?, ?)",
                (telegram_id, username)
            )
            await db.commit()
            row = await db.execute_fetchone(
                "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
            )
        return dict(row)


async def is_premium(telegram_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        row = await db.execute_fetchone(
            "SELECT premium_until FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        if not row or not row[0]:
            return False
        return datetime.fromisoformat(row[0]) > datetime.now()


async def extend_premium(telegram_id: int, days: int, charge_id: str, stars: int):
    async with aiosqlite.connect(DB_PATH) as db:
        # Определить от когда считать
        row = await db.execute_fetchone(
            "SELECT premium_until FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        if row and row[0]:
            current_until = datetime.fromisoformat(row[0])
            # Если ещё активна — продлить, не перезаписать
            if current_until > datetime.now():
                new_until = current_until + timedelta(days=days)
            else:
                new_until = datetime.now() + timedelta(days=days)
        else:
            new_until = datetime.now() + timedelta(days=days)
        
        await db.execute(
            "UPDATE users SET is_premium = 1, premium_until = ? WHERE telegram_id = ?",
            (new_until.isoformat(), telegram_id)
        )
        await db.execute(
            "INSERT OR IGNORE INTO purchases (telegram_id, charge_id, stars, days) VALUES (?, ?, ?, ?)",
            (telegram_id, charge_id, stars, days)
        )
        await db.commit()
        return new_until


async def check_and_increment_free_limit(telegram_id: int, free_limit: int = 5) -> bool:
    """Проверить лимит бесплатных запросов. Вернуть True если можно запросить."""
    today = datetime.now().strftime("%Y-%m-%d")
    
    async with aiosqlite.connect(DB_PATH) as db:
        row = await db.execute_fetchone(
            "SELECT daily_requests, last_request_date FROM users WHERE telegram_id = ?",
            (telegram_id,)
        )
        if not row:
            return False
        
        requests, last_date = row
        
        # Сбросить счётчик если новый день
        if last_date != today:
            requests = 0
        
        if requests >= free_limit:
            return False  # лимит исчерпан
        
        # Увеличить счётчик
        await db.execute(
            "UPDATE users SET daily_requests = ?, last_request_date = ? WHERE telegram_id = ?",
            (requests + 1, today, telegram_id)
        )
        await db.commit()
        return True
```

## Логика подписки (subscription.py)

```python
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder

FREE_LIMIT = 5  # бесплатных запросов в день

PLANS = {
    "month": {
        "name": "Месяц",
        "days": 30,
        "stars": 200,
        "label": "30 дней — 200 ⭐",
    },
    "quarter": {
        "name": "3 месяца",
        "days": 90,
        "stars": 500,
        "label": "90 дней — 500 ⭐ (-17%)",
    },
    "year": {
        "name": "Год",
        "days": 365,
        "stars": 1500,
        "label": "365 дней — 1500 ⭐ (-37%)",
    }
}


def subscription_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for plan_id, plan in PLANS.items():
        builder.button(text=plan["label"], callback_data=f"sub:buy:{plan_id}")
    builder.adjust(1)
    return builder.as_markup()


def upgrade_message(requests_left: int) -> str:
    if requests_left == 0:
        return (
            "⚠️ Бесплатный лимит исчерпан на сегодня.\n\n"
            "Подключи подписку для безлимитного доступа:\n"
        )
    else:
        return (
            f"🔓 У тебя {requests_left} бесплатных запросов сегодня.\n\n"
            "Подписка даёт безлимитный доступ:\n"
        )
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery, LabeledPrice, SuccessfulPayment
from aiogram.filters import Command

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

from anthropic import AsyncAnthropic
claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

from db import init_db, get_or_create_user, is_premium, extend_premium, check_and_increment_free_limit
from subscription import PLANS, subscription_keyboard, upgrade_message, FREE_LIMIT


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await get_or_create_user(message.from_user.id, message.from_user.username or "")
    premium = await is_premium(message.from_user.id)
    
    status = "✨ Ты — Premium пользователь" if premium else f"🆓 Бесплатный план ({FREE_LIMIT} запросов/день)"
    
    await message.answer(
        f"Привет! Я AI-ассистент.\n\n"
        f"Статус: {status}\n\n"
        f"Команды:\n"
        f"/ask <вопрос> — задать вопрос\n"
        f"/status — твой статус\n"
        f"/subscribe — подписка Premium"
    )


@dp.message(Command("ask"))
async def cmd_ask(message: Message):
    question = message.text.removeprefix("/ask").strip()
    if not question:
        await message.answer("Напиши вопрос: /ask что такое RAG?")
        return
    
    user_id = message.from_user.id
    await get_or_create_user(user_id)
    premium = await is_premium(user_id)
    
    if not premium:
        # Проверить бесплатный лимит
        allowed = await check_and_increment_free_limit(user_id, FREE_LIMIT)
        if not allowed:
            await message.answer(
                upgrade_message(0),
                reply_markup=subscription_keyboard()
            )
            return
    
    # Запрос к Claude
    status = await message.answer("Думаю...")
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{"role": "user", "content": question}]
    )
    await status.delete()
    await message.answer(response.content[0].text)


@dp.message(Command("status"))
async def cmd_status(message: Message):
    user_id = message.from_user.id
    await get_or_create_user(user_id)
    premium = await is_premium(user_id)
    
    if premium:
        from db import aiosqlite, DB_PATH
        async with aiosqlite.connect(DB_PATH) as db:
            row = await db.execute_fetchone(
                "SELECT premium_until FROM users WHERE telegram_id = ?", (user_id,)
            )
        until = datetime.fromisoformat(row[0])
        days_left = (until - datetime.now()).days
        await message.answer(f"✨ Premium активен\nДо: {until.strftime('%d.%m.%Y')} ({days_left} дн.)")
    else:
        from db import aiosqlite, DB_PATH
        today = datetime.now().strftime("%Y-%m-%d")
        async with aiosqlite.connect(DB_PATH) as db:
            row = await db.execute_fetchone(
                "SELECT daily_requests, last_request_date FROM users WHERE telegram_id = ?", (user_id,)
            )
        requests = row[0] if row[1] == today else 0
        left = max(0, FREE_LIMIT - requests)
        await message.answer(
            f"🆓 Бесплатный план\nЗапросов сегодня: {requests}/{FREE_LIMIT} (осталось: {left})",
            reply_markup=subscription_keyboard() if left == 0 else None
        )


@dp.message(Command("subscribe"))
async def cmd_subscribe(message: Message):
    await message.answer(
        "💳 Premium подписка\n\n"
        "• Безлимитные запросы каждый день\n"
        "• Доступ к продвинутым функциям\n"
        "• Приоритетные ответы\n\n"
        "Выбери план:",
        reply_markup=subscription_keyboard()
    )


@dp.callback_query(F.data.startswith("sub:buy:"))
async def handle_buy(callback: CallbackQuery):
    plan_id = callback.data.split(":")[2]
    plan = PLANS.get(plan_id)
    if not plan:
        await callback.answer("Неверный план")
        return
    
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title=f"Premium {plan['name']}",
        description=f"Безлимитный доступ к AI на {plan['days']} дней",
        payload=f"sub:{plan_id}:{callback.from_user.id}",
        currency="XTR",
        prices=[LabeledPrice(label=f"Premium {plan['name']}", amount=plan["stars"])]
    )
    await callback.answer()


@dp.pre_checkout_query()
async def pre_checkout(query):
    await query.answer(ok=True)


@dp.message(F.successful_payment)
async def successful_payment(message: Message):
    payment: SuccessfulPayment = message.successful_payment
    parts = payment.invoice_payload.split(":")
    plan_id = parts[1]
    plan = PLANS[plan_id]
    
    until = await extend_premium(
        telegram_id=message.from_user.id,
        days=plan["days"],
        charge_id=payment.telegram_payment_charge_id,
        stars=plan["stars"]
    )
    
    await message.answer(
        f"✨ Premium активирован!\n\n"
        f"План: {plan['name']}\n"
        f"Активен до: {until.strftime('%d.%m.%Y')}\n\n"
        f"Используй /ask для неограниченных запросов!"
    )


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
DB_PATH=bot.db
```

---

::: tip Аналитика
Добавь логирование запросов в таблицу `events` (user_id, action, timestamp). Через неделю ты увидишь: сколько бесплатных пользователей упирается в лимит, какой % конвертирует — это поможет настроить правильный лимит и цену.
:::
