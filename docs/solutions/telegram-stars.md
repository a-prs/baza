# Оплата через Telegram Stars

Telegram Stars — внутренняя валюта Telegram. Пользователи покупают звёзды за реальные деньги, а ты получаешь их от подписчиков. Проще чем ЮКасса: не нужен ИП, не нужна интеграция с банком, работает в любой стране.

**Как работает:**
- Пользователь платит Telegram-звёздами прямо в боте
- Ты выводишь звёзды в криптовалюту (TON) через Fragment
- Обменный курс: ~50 Stars = $1

**Что продавать:**
- Цифровой контент (PDF, шаблоны, гайды)
- Доступ к боту / подписка
- Консультации, ответы на вопросы

## Структура проекта

```
stars-bot/
├── bot.py
├── db.py
├── products.py
├── .env
└── requirements.txt
```

## Каталог товаров (products.py)

```python
PRODUCTS = {
    "guide_python": {
        "title": "Гайд по Python",
        "description": "PDF-гайд: Python для вайб-кодеров. 50 страниц, практические примеры.",
        "price": 100,  # Stars
        "file_path": "files/guide_python.pdf",  # что выдать после оплаты
    },
    "template_bot": {
        "title": "Шаблон бота",
        "description": "Готовый шаблон Telegram-бота на aiogram 3: FSM, SQLite, деплой.",
        "price": 150,
        "file_path": "files/template_bot.zip",
    },
    "consultation": {
        "title": "Консультация 30 мин",
        "description": "Разберём твой проект: архитектура, ошибки, следующие шаги.",
        "price": 250,
        "file_path": None,  # выдаём ссылку на Calendly
        "link": "https://calendly.com/yourname",
    },
}
```

## База данных (db.py)

```python
import sqlite3
import os

DB_PATH = os.getenv("DB_PATH", "stars_bot.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id TEXT NOT NULL,
            charge_id TEXT UNIQUE,
            paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def record_purchase(user_id: int, product_id: str, charge_id: str):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR IGNORE INTO purchases (user_id, product_id, charge_id) VALUES (?, ?, ?)",
        (user_id, product_id, charge_id)
    )
    conn.commit()
    conn.close()

def has_purchased(user_id: int, product_id: str) -> bool:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT 1 FROM purchases WHERE user_id = ? AND product_id = ?",
        (user_id, product_id)
    ).fetchone()
    conn.close()
    return row is not None
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice,
    PreCheckoutQuery, SuccessfulPayment, InlineKeyboardMarkup, InlineKeyboardButton
)
from aiogram.filters import Command
from aiogram.utils.keyboard import InlineKeyboardBuilder

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

from products import PRODUCTS
from db import init_db, record_purchase, has_purchased


def catalog_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for pid, p in PRODUCTS.items():
        builder.button(
            text=f"{p['title']} — {p['price']} ⭐",
            callback_data=f"buy:{pid}"
        )
    builder.adjust(1)
    return builder.as_markup()


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "Привет! Здесь можно купить цифровые продукты за Telegram Stars ⭐\n\n"
        "Нажми кнопку чтобы посмотреть каталог.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="📦 Каталог", callback_data="catalog")
        ]])
    )


@dp.callback_query(F.data == "catalog")
async def show_catalog(callback: CallbackQuery):
    text = "Выбери что купить:\n\n"
    for p in PRODUCTS.values():
        text += f"• **{p['title']}** — {p['price']} ⭐\n  {p['description']}\n\n"
    
    await callback.message.edit_text(text, reply_markup=catalog_keyboard(), parse_mode="Markdown")
    await callback.answer()


@dp.callback_query(F.data.startswith("buy:"))
async def initiate_purchase(callback: CallbackQuery):
    product_id = callback.data.split(":")[1]
    product = PRODUCTS.get(product_id)
    
    if not product:
        await callback.answer("Товар не найден", show_alert=True)
        return
    
    # Проверяем — уже куплено?
    if has_purchased(callback.from_user.id, product_id):
        await callback.answer("Вы уже приобрели этот товар!", show_alert=True)
        # Сразу выдать
        await deliver_product(callback.message, callback.from_user.id, product_id)
        return
    
    # Отправить инвойс со Stars
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title=product["title"],
        description=product["description"],
        payload=f"{product_id}:{callback.from_user.id}",  # передаём через payload
        currency="XTR",  # XTR = Telegram Stars
        prices=[LabeledPrice(label=product["title"], amount=product["price"])],
        # provider_token="" — для Stars оставить пустым или не передавать
    )
    await callback.answer()


@dp.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery):
    # Обязательно подтвердить в течение 10 секунд
    await query.answer(ok=True)


@dp.message(F.successful_payment)
async def successful_payment_handler(message: Message):
    payment: SuccessfulPayment = message.successful_payment
    payload_parts = payment.invoice_payload.split(":")
    product_id = payload_parts[0]
    
    # Сохранить покупку
    record_purchase(
        user_id=message.from_user.id,
        product_id=product_id,
        charge_id=payment.telegram_payment_charge_id
    )
    
    await message.answer(f"Оплата прошла! Получаю твой товар...")
    await deliver_product(message, message.from_user.id, product_id)


async def deliver_product(message: Message, user_id: int, product_id: str):
    product = PRODUCTS.get(product_id)
    if not product:
        return
    
    if product.get("file_path") and os.path.exists(product["file_path"]):
        # Отправить файл
        with open(product["file_path"], "rb") as f:
            await bot.send_document(user_id, f, caption=f"Вот твой {product['title']}!")
    elif product.get("link"):
        # Отправить ссылку
        await bot.send_message(
            user_id,
            f"Отлично! Записывайся по ссылке: {product['link']}"
        )
    else:
        await bot.send_message(user_id, f"Спасибо за покупку {product['title']}! Скоро напишу.")


async def main():
    init_db()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
DB_PATH=stars_bot.db
ADMIN_ID=123456789
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install aiogram python-dotenv

mkdir -p files  # папка для файлов-товаров
python bot.py
```

## Вывод Stars

Stars выводятся через [Fragment](https://fragment.com):
1. Зайди на fragment.com через Telegram
2. Найди своего бота в разделе «Боты»
3. Нажми «Вывести звёзды» → меняются на TON

Комиссия ~30% с каждой транзакции забирает Telegram. Учитывай при ценообразовании.

## Проверка в тестовом режиме

Telegram поддерживает тестирование Stars без реальных денег через тестовую среду (@BotFather → Payments → Test Mode). В тесте инвойсы проходят без реальной оплаты.

```python
# Для теста — использовать тестовый токен (нет provider_token, нужен тестовый бот)
# Команда BotFather: /mybots → выбрать бот → Bot Settings → Payments → Enable test mode
```

---

::: tip Pricing
Стандартный подход: цена в Stars ≈ цена в долларах × 50. Пример: $5 = 250 Stars. Telegram берёт ~30% → ты получаешь ~175 Stars (~$3.5). Планируй с учётом комиссии.
:::
