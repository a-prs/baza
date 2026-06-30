# Платежи через ЮКассу

Stripe недоступен для ряда российских аккаунтов. ЮКасса (ЮMoney) — основная альтернатива для РФ: принимает карты, СБП, ЮMoney-кошелёк. Разбираем интеграцию в Telegram-боте.

## Регистрация

1. Зарегистрироваться на yookassa.ru (нужен ИП или ООО; самозанятые — отдельный продукт «ЮKassa для самозанятых»)
2. Пройти верификацию (1-3 дня)
3. В личном кабинете: Настройки → API-ключи → скопировать `shopId` и `секретный ключ`
4. Webhook: Настройки → Уведомления → указать URL вашего сервера

## Установка

```bash
pip install yookassa
```

## Базовая оплата: создать платёж

```python
import uuid
import os
from yookassa import Configuration, Payment

Configuration.account_id = os.getenv("YOOKASSA_SHOP_ID")
Configuration.secret_key = os.getenv("YOOKASSA_SECRET_KEY")


def create_payment(amount: float, description: str, user_id: int, return_url: str) -> dict:
    """Создать платёж и получить ссылку для оплаты."""
    idempotence_key = str(uuid.uuid4())
    
    payment = Payment.create({
        "amount": {
            "value": f"{amount:.2f}",
            "currency": "RUB"
        },
        "confirmation": {
            "type": "redirect",
            "return_url": return_url  # куда вернуть после оплаты
        },
        "capture": True,  # автоматически подтверждать
        "description": description,
        "metadata": {
            "user_id": str(user_id),
        }
    }, idempotence_key)
    
    return {
        "payment_id": payment.id,
        "confirmation_url": payment.confirmation.confirmation_url,
        "status": payment.status
    }
```

## Интеграция с Telegram-ботом

```python
import asyncio
import os
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.utils.keyboard import InlineKeyboardBuilder
from dotenv import load_dotenv

load_dotenv()

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

RETURN_URL = "https://t.me/your_bot"  # вернуть в бота после оплаты


@dp.message(Command("subscribe"))
async def cmd_subscribe(message: Message):
    kb = InlineKeyboardBuilder()
    kb.button(text="499₽ / месяц", callback_data="pay:499:month")
    kb.button(text="3990₽ / год (-33%)", callback_data="pay:3990:year")
    kb.adjust(1)
    
    await message.answer(
        "Выберите план подписки:",
        reply_markup=kb.as_markup()
    )


@dp.callback_query(F.data.startswith("pay:"))
async def handle_pay(callback: CallbackQuery):
    _, amount_str, plan = callback.data.split(":")
    amount = float(amount_str)
    
    user_id = callback.from_user.id
    
    result = create_payment(
        amount=amount,
        description=f"Подписка {plan}",
        user_id=user_id,
        return_url=RETURN_URL
    )
    
    # Сохранить payment_id для последующей проверки
    await save_pending_payment(user_id, result["payment_id"], plan, amount)
    
    kb = InlineKeyboardBuilder()
    kb.button(text="💳 Оплатить", url=result["confirmation_url"])
    
    await callback.message.edit_text(
        f"Сумма: {amount:.0f}₽\n\n"
        "После оплаты нажмите кнопку — я проверю платёж.",
        reply_markup=kb.as_markup()
    )
    await callback.answer()
```

## Webhook: получать уведомления от ЮКассы

ЮКасса отправляет POST-запрос когда статус платежа меняется.

```python
import hmac
import hashlib
import json
from fastapi import FastAPI, Request, HTTPException
from yookassa import Payment

app = FastAPI()


def verify_yookassa_signature(body: bytes, signature: str, secret: str) -> bool:
    """Проверить подпись вебхука."""
    expected = hmac.new(
        secret.encode(),
        body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@app.post("/webhook/yookassa")
async def yookassa_webhook(request: Request):
    body = await request.body()
    
    # ЮКасса отправляет подпись в заголовке
    signature = request.headers.get("X-Idempotency-Key", "")
    
    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON")
    
    event_type = event.get("event")
    payment_obj = event.get("object", {})
    
    payment_id = payment_obj.get("id")
    status = payment_obj.get("status")
    metadata = payment_obj.get("metadata", {})
    
    if event_type == "payment.succeeded" and status == "succeeded":
        user_id = int(metadata.get("user_id", 0))
        amount = float(payment_obj.get("amount", {}).get("value", 0))
        
        if user_id:
            await on_payment_success(user_id, payment_id, amount)
    
    elif event_type == "payment.canceled":
        user_id = int(metadata.get("user_id", 0))
        if user_id:
            await on_payment_failed(user_id, payment_id)
    
    return {"ok": True}


async def on_payment_success(user_id: int, payment_id: str, amount: float):
    """Активировать подписку и уведомить пользователя."""
    # Получить план из БД по payment_id
    pending = await get_pending_payment(payment_id)
    if not pending:
        return
    
    # Активировать подписку
    days = 365 if pending["plan"] == "year" else 30
    await extend_subscription(user_id, days)
    await mark_payment_completed(payment_id)
    
    # Уведомить пользователя
    await bot.send_message(
        user_id,
        f"✅ Оплата принята!\n"
        f"Подписка активирована на {days} дней.\n"
        f"Сумма: {amount:.0f}₽"
    )


async def on_payment_failed(user_id: int, payment_id: str):
    await bot.send_message(user_id, "❌ Платёж отменён. Попробуй снова /subscribe")
```

## Проверить статус вручную (polling)

Если вебхук недоступен — можно проверять статус по кнопке:

```python
from yookassa import Payment as YkPayment


@dp.callback_query(F.data.startswith("check_payment:"))
async def check_payment(callback: CallbackQuery):
    payment_id = callback.data.split(":")[1]
    
    payment = YkPayment.find_one(payment_id)
    
    if payment.status == "succeeded":
        await on_payment_success(
            callback.from_user.id,
            payment_id,
            float(payment.amount.value)
        )
        await callback.answer("Оплата подтверждена!", show_alert=True)
    
    elif payment.status == "pending":
        await callback.answer("Платёж ещё обрабатывается, подождите...", show_alert=True)
    
    else:
        await callback.answer(f"Статус: {payment.status}", show_alert=True)
```

## СБП (Система быстрых платежей)

```python
def create_sbp_payment(amount: float, user_id: int) -> dict:
    """Платёж через СБП — QR-код или диплинк."""
    payment = Payment.create({
        "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
        "payment_method_data": {
            "type": "sbp"  # Только СБП
        },
        "confirmation": {
            "type": "redirect",
            "return_url": RETURN_URL
        },
        "capture": True,
        "description": "Подписка",
        "metadata": {"user_id": str(user_id)}
    }, str(uuid.uuid4()))
    
    return {
        "payment_id": payment.id,
        "confirmation_url": payment.confirmation.confirmation_url,
    }
```

## База данных для платежей

```sql
CREATE TABLE payments (
    id TEXT PRIMARY KEY,         -- payment_id от ЮКассы
    user_id INTEGER NOT NULL,
    plan TEXT,                   -- 'month' / 'year'
    amount REAL,
    status TEXT DEFAULT 'pending', -- pending / completed / cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE subscriptions (
    user_id INTEGER PRIMARY KEY,
    premium_until TIMESTAMP,
    total_paid REAL DEFAULT 0
);
```

```python
async def save_pending_payment(user_id: int, payment_id: str, plan: str, amount: float):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO payments (id, user_id, plan, amount) VALUES (?,?,?,?)",
            (payment_id, user_id, plan, amount)
        )
        await db.commit()


async def extend_subscription(user_id: int, days: int):
    async with aiosqlite.connect(DB_PATH) as db:
        # Если уже есть подписка — продлить от конца, иначе от сегодня
        await db.execute("""
            INSERT INTO subscriptions (user_id, premium_until)
            VALUES (?, datetime('now', ?))
            ON CONFLICT(user_id) DO UPDATE SET
                premium_until = CASE
                    WHEN premium_until > datetime('now')
                    THEN datetime(premium_until, ?)
                    ELSE datetime('now', ?)
                END
        """, (user_id, f"+{days} days", f"+{days} days", f"+{days} days"))
        await db.commit()


async def is_premium(user_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        row = await db.execute_fetchall(
            "SELECT premium_until FROM subscriptions WHERE user_id = ? AND premium_until > datetime('now')",
            (user_id,)
        )
        return bool(row)
```

## .env

```
BOT_TOKEN=your_token
YOOKASSA_SHOP_ID=your_shop_id
YOOKASSA_SECRET_KEY=your_secret_key
DB_PATH=payments.db
```

## Запуск (с вебхуком)

```bash
pip install aiogram yookassa fastapi uvicorn aiosqlite python-dotenv

# Отдельный процесс: вебхук-сервер
uvicorn webhook_server:app --host 0.0.0.0 --port 8001

# И бот
python bot.py
```

---

::: tip Тест без реальных денег
В личном кабинете ЮКассы включи тестовый режим — все платежи проходят без списаний. Тестовая карта: 5555 5555 5555 4444, любой срок, любой CVV.
:::
