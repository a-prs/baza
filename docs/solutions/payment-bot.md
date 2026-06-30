# Бот с приёмом оплаты

Telegram умеет принимать оплату прямо внутри чата — пользователь вводит карту и платит не выходя из мессенджера. Подключается через провайдера платежей (ЮКасса, Stripe, и другие).

**Время настройки:** 30–60 минут  
**Стек:** Python + aiogram 3 + платёжный провайдер  
**Нужен:** Telegram-бот, аккаунт ЮКасса или другого провайдера

## Как работает оплата в Telegram

1. Бот отправляет **Invoice** (счёт) с описанием и суммой
2. Пользователь нажимает «Оплатить» — Telegram открывает форму оплаты
3. Пользователь вводит карту → деньги идут через провайдера
4. Telegram присылает боту `pre_checkout_query` — бот подтверждает
5. После оплаты Telegram присылает `successful_payment` — бот выдаёт товар/услугу

## Шаг 1: Подключи провайдера платежей

### ЮКасса (для РФ)

1. Зарегистрируйся на [yookassa.ru](https://yookassa.ru/)
2. Создай магазин → получи `shopId` и секретный ключ
3. В настройках магазина → Интеграция → Telegram → укажи username бота
4. ЮКасса выдаст **Payment Provider Token**

### Stripe (международный)

1. Зарегистрируйся на [stripe.com](https://stripe.com/)
2. В BotFather: `/mybots` → выбери бота → Payments → добавь Stripe
3. Получишь **Payment Provider Token**

### Тестовый провайдер (без реальных денег)

В BotFather: `/mybots` → Payments → `Stripe TEST` — для разработки.

## Шаг 2: Код бота

```python
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import (
    Message, LabeledPrice, PreCheckoutQuery,
    SuccessfulPayment, InlineKeyboardMarkup, InlineKeyboardButton
)
import os
from dotenv import load_dotenv
import sqlite3

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
PAYMENT_TOKEN = os.getenv("PAYMENT_TOKEN")  # от провайдера

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- Каталог товаров ---
PRODUCTS = {
    "consultation": {
        "title": "Консультация 1 час",
        "description": "Персональная консультация по автоматизации бизнеса",
        "price": 300000,  # в копейках! 3000 руб = 300000 копеек
        "currency": "RUB",
    },
    "bot_template": {
        "title": "Шаблон Telegram-бота",
        "description": "Готовый шаблон бота с базой данных и FSM",
        "price": 99000,  # 990 руб
        "currency": "RUB",
    },
}

# --- Каталог ---
@dp.message(Command("shop"))
async def show_shop(message: Message):
    text = "🛍 Наш каталог:\n\n"
    buttons = []
    
    for product_id, product in PRODUCTS.items():
        price_rub = product["price"] // 100
        text += f"• {product['title']} — {price_rub} руб.\n"
        buttons.append([InlineKeyboardButton(
            text=f"Купить: {product['title']}",
            callback_data=f"buy:{product_id}"
        )])
    
    kb = InlineKeyboardMarkup(inline_keyboard=buttons)
    await message.answer(text, reply_markup=kb)

# --- Отправить инвойс ---
@dp.callback_query(F.data.startswith("buy:"))
async def send_invoice(callback):
    product_id = callback.data.split(":")[1]
    product = PRODUCTS.get(product_id)
    
    if not product:
        await callback.answer("Товар не найден")
        return
    
    await callback.answer()
    
    await bot.send_invoice(
        chat_id=callback.message.chat.id,
        title=product["title"],
        description=product["description"],
        payload=f"{product_id}:{callback.from_user.id}",  # передаём что купили и кто
        provider_token=PAYMENT_TOKEN,
        currency=product["currency"],
        prices=[LabeledPrice(label=product["title"], amount=product["price"])],
        start_parameter="buy",
        # Для тестовой оплаты:
        # need_name=True, need_phone_number=True,
    )

# --- Подтверждение до оплаты ---
@dp.pre_checkout_query()
async def process_pre_checkout(pre_checkout: PreCheckoutQuery):
    # Здесь можно проверить наличие товара, лимиты и т.д.
    # Если всё ок — подтверждаем
    await pre_checkout.answer(ok=True)
    
    # Если что-то не так:
    # await pre_checkout.answer(ok=False, error_message="Товар закончился")

# --- Успешная оплата ---
@dp.message(F.successful_payment)
async def payment_success(message: Message):
    payment = message.successful_payment
    payload = payment.invoice_payload  # "product_id:user_id"
    product_id, user_id = payload.split(":")
    
    product = PRODUCTS.get(product_id)
    amount_rub = payment.total_amount // 100
    
    # Сохранить в базу
    save_purchase(
        user_id=int(user_id),
        product_id=product_id,
        amount=amount_rub,
        telegram_charge_id=payment.telegram_payment_charge_id,
    )
    
    # Выдать товар
    await deliver_product(message, product_id)
    
    await message.answer(
        f"✅ Оплата прошла успешно!\n\n"
        f"Куплено: {product['title']}\n"
        f"Сумма: {amount_rub} руб.\n\n"
        f"Чек: #{payment.telegram_payment_charge_id[:8]}"
    )

async def deliver_product(message: Message, product_id: str):
    """Выдача товара/услуги после оплаты"""
    if product_id == "bot_template":
        await message.answer_document(
            "https://example.com/template.zip",  # или file_id из Telegram
            caption="Ваш шаблон бота готов!"
        )
    elif product_id == "consultation":
        await message.answer(
            "Консультация забронирована!\n"
            "Я свяжусь с вами в течение 2 часов для согласования времени."
        )

def save_purchase(user_id: int, product_id: str, amount: int, telegram_charge_id: str):
    conn = sqlite3.connect("purchases.db")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            product_id TEXT,
            amount INTEGER,
            charge_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "INSERT INTO purchases (user_id, product_id, amount, charge_id) VALUES (?, ?, ?, ?)",
        (user_id, product_id, amount, telegram_charge_id)
    )
    conn.commit()
    conn.close()

# --- Старт ---
async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## .env файл

```
BOT_TOKEN=1234567890:ABCdef...
PAYMENT_TOKEN=381764628:TEST:ваш_токен_от_провайдера
```

## Тестирование

С тестовым провайдером (Stripe TEST) — используй карты для тестирования:
- Успешная оплата: `4242 4242 4242 4242`, любая дата/CVV
- Отклонённая: `4000 0000 0000 0002`

## Важные ограничения Telegram

- **Минимальная сумма:** зависит от провайдера, обычно от 60–100 руб.
- **Валюта:** зависит от провайдера (ЮКасса — только RUB)
- **Продавец должен быть ИП/ООО** для ЮКассы (самозанятый — уточни у ЮКассы)
- **Чеки:** ЮКасса автоматически формирует фискальные чеки (54-ФЗ)

## Возврат средств

```python
@dp.message(Command("refund"))
async def refund(message: Message):
    # В реальном боте — проверь права и найди charge_id по user_id
    charge_id = "..."  # telegram_payment_charge_id из БД
    
    await bot.refund_star_payment(  # для Stars
        user_id=message.from_user.id,
        telegram_payment_charge_id=charge_id
    )
    # Для обычных платежей — возврат через кабинет провайдера
```

---

::: info Связанные материалы
- [Telegram-бот с нуля](/practice/11-telegram-bot) — основы aiogram
- [Telegram FSM](/practice/28-telegram-fsm) — многошаговые диалоги для онбординга перед оплатой
- [Базы данных](/practice/15-databases) — хранение покупок
:::
