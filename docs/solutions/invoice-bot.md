# Бот для выставления счетов

Бот создаёт профессиональный PDF-счёт по команде и отправляет его клиенту или тебе. Для фрилансеров и самозанятых — замена дорогому бухгалтерскому ПО.

## Что делает

- Добавить клиента через диалог
- Создать счёт (выбрать клиента → описание → сумма)
- Получить PDF с вашими реквизитами
- История счетов с фильтром по статусу
- Отметить счёт оплаченным

## Структура

```
invoice-bot/
├── bot.py
├── db.py
├── pdf_generator.py  # генерация PDF через ReportLab
├── config.py         # ваши реквизиты
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
aiosqlite
reportlab
python-dotenv
```

## Конфиг реквизитов (config.py)

```python
SELLER = {
    "name": "ИП Иванов Иван Иванович",
    "inn": "772512345678",
    "address": "г. Москва, ул. Примерная, д. 1",
    "phone": "+7 (999) 123-45-67",
    "email": "ivan@example.com",
    "bank": "ПАО «Сбербанк»",
    "bik": "044525225",
    "account": "40802810000000000001",
    "corr_account": "30101810400000000225",
}
```

## Генерация PDF (pdf_generator.py)

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, 
                                  Table, TableStyle, HRFlowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from io import BytesIO
import os
from datetime import datetime

from config import SELLER


def generate_invoice_pdf(invoice: dict, client: dict, items: list[dict]) -> bytes:
    """
    invoice: {number, date, due_date, notes}
    client: {name, inn, address, email}
    items: [{description, quantity, unit_price}]
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
        leftMargin=2*cm, rightMargin=1.5*cm
    )
    
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    normal.fontName = "Helvetica"
    normal.fontSize = 9
    
    h1 = ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=16, spaceAfter=4)
    h2 = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=10, spaceAfter=4)
    small = ParagraphStyle("Small", fontName="Helvetica", fontSize=8, textColor=colors.grey)
    
    story = []
    
    # Заголовок
    story.append(Paragraph(f"СЧЁТ НА ОПЛАТУ № {invoice['number']}", h1))
    story.append(Paragraph(
        f"от {invoice['date']}  •  Срок оплаты: {invoice.get('due_date', 'По договорённости')}",
        small
    ))
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#2563EB")))
    story.append(Spacer(1, 0.4*cm))
    
    # Продавец и Покупатель
    parties_data = [
        [
            Paragraph("<b>Продавец:</b>", normal),
            Paragraph("<b>Покупатель:</b>", normal)
        ],
        [
            Paragraph(SELLER["name"], normal),
            Paragraph(client["name"], normal)
        ],
        [
            Paragraph(f"ИНН: {SELLER['inn']}", small),
            Paragraph(f"ИНН: {client.get('inn', '—')}", small)
        ],
        [
            Paragraph(SELLER["address"], small),
            Paragraph(client.get("address", "—"), small)
        ],
        [
            Paragraph(f"Тел: {SELLER['phone']}", small),
            Paragraph(f"Email: {client.get('email', '—')}", small)
        ],
    ]
    
    parties_table = Table(parties_data, colWidths=[9*cm, 9*cm])
    parties_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(parties_table)
    story.append(Spacer(1, 0.6*cm))
    
    # Таблица позиций
    story.append(Paragraph("Услуги / Товары:", h2))
    
    table_data = [["№", "Описание", "Кол-во", "Цена", "Сумма"]]
    total = 0
    
    for i, item in enumerate(items, 1):
        qty = item.get("quantity", 1)
        price = item["unit_price"]
        amount = qty * price
        total += amount
        table_data.append([
            str(i),
            item["description"],
            str(qty),
            f"{price:,.0f} ₽",
            f"{amount:,.0f} ₽"
        ])
    
    # Итого
    table_data.append(["", "", "", "ИТОГО:", f"{total:,.0f} ₽"])
    
    col_widths = [1*cm, 9*cm, 2*cm, 3*cm, 3*cm]
    items_table = Table(table_data, colWidths=col_widths)
    items_table.setStyle(TableStyle([
        # Заголовок
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        # Строки
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F8FAFC")]),
        # Итого
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
        # Общее
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("PADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 0.8*cm))
    
    # Банковские реквизиты
    story.append(Paragraph("Банковские реквизиты:", h2))
    bank_data = [
        ["Банк:", SELLER["bank"]],
        ["БИК:", SELLER["bik"]],
        ["Расчётный счёт:", SELLER["account"]],
        ["Корр. счёт:", SELLER["corr_account"]],
    ]
    bank_table = Table(bank_data, colWidths=[4*cm, 14*cm])
    bank_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(bank_table)
    
    if invoice.get("notes"):
        story.append(Spacer(1, 0.4*cm))
        story.append(Paragraph(f"Примечание: {invoice['notes']}", small))
    
    doc.build(story)
    return buffer.getvalue()
```

## База данных (db.py)

```python
import aiosqlite
import json
import os

DB_PATH = os.getenv("DB_PATH", "invoices.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                inn TEXT,
                address TEXT,
                email TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number TEXT UNIQUE,
                client_id INTEGER,
                items TEXT,  -- JSON
                total REAL,
                status TEXT DEFAULT 'pending',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                paid_at TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clients(id)
            )
        """)
        await db.commit()


async def add_client(name: str, inn: str = "", address: str = "", email: str = "") -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO clients (name, inn, address, email) VALUES (?,?,?,?)",
            (name, inn, address, email)
        )
        await db.commit()
        return cur.lastrowid


async def get_clients() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("SELECT * FROM clients ORDER BY name")
        return [dict(r) for r in rows]


async def create_invoice(client_id: int, items: list[dict], notes: str = "") -> dict:
    from datetime import datetime, timedelta
    
    now = datetime.now()
    number = f"{now.strftime('%Y%m%d')}-{client_id:03d}"
    total = sum(i.get("quantity", 1) * i["unit_price"] for i in items)
    due = (now + timedelta(days=14)).strftime("%d.%m.%Y")
    
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO invoices (number, client_id, items, total, notes) VALUES (?,?,?,?,?)",
            (number, client_id, json.dumps(items, ensure_ascii=False), total, notes)
        )
        await db.commit()
        invoice_id = cur.lastrowid
    
    return {
        "id": invoice_id,
        "number": number,
        "date": now.strftime("%d.%m.%Y"),
        "due_date": due,
        "notes": notes,
        "items": items,
        "total": total,
    }


async def get_invoices(status: str = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status:
            rows = await db.execute_fetchall(
                "SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id=c.id WHERE i.status=? ORDER BY i.created_at DESC",
                (status,)
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id=c.id ORDER BY i.created_at DESC LIMIT 20"
            )
        return [dict(r) for r in rows]
```

## Бот (bot.py)

```python
import asyncio, os, json, logging
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery, BufferedInputFile
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
ADMIN_ID = int(os.getenv("ADMIN_ID"))

from db import init_db, add_client, get_clients, create_invoice, get_invoices
from pdf_generator import generate_invoice_pdf


class AddClient(StatesGroup):
    name = State()
    inn = State()
    email = State()


class CreateInvoice(StatesGroup):
    choose_client = State()
    add_items = State()
    confirm = State()


@dp.message(Command("start"))
async def cmd_start(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "📄 Счета и инвойсы\n\n"
        "/newclient — добавить клиента\n"
        "/invoice — создать счёт\n"
        "/invoices — список счетов\n"
        "/pending — неоплаченные"
    )


@dp.message(Command("newclient"))
async def cmd_new_client(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return
    await state.set_state(AddClient.name)
    await message.answer("Имя/название клиента:")


@dp.message(AddClient.name)
async def got_client_name(message: Message, state: FSMContext):
    await state.update_data(name=message.text)
    await state.set_state(AddClient.inn)
    await message.answer("ИНН клиента (или /skip):")


@dp.message(AddClient.inn)
async def got_client_inn(message: Message, state: FSMContext):
    inn = "" if message.text == "/skip" else message.text
    await state.update_data(inn=inn)
    await state.set_state(AddClient.email)
    await message.answer("Email клиента (или /skip):")


@dp.message(AddClient.email)
async def got_client_email(message: Message, state: FSMContext):
    email = "" if message.text == "/skip" else message.text
    data = await state.get_data()
    
    client_id = await add_client(data["name"], data.get("inn", ""), "", email)
    await state.clear()
    await message.answer(f"✅ Клиент добавлен (ID: {client_id})\n{data['name']}")


@dp.message(Command("invoice"))
async def cmd_invoice(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID:
        return
    
    clients = await get_clients()
    if not clients:
        await message.answer("Нет клиентов. Добавь: /newclient")
        return
    
    kb = InlineKeyboardBuilder()
    for c in clients:
        kb.button(text=c["name"], callback_data=f"inv_client:{c['id']}")
    kb.adjust(1)
    
    await state.set_state(CreateInvoice.choose_client)
    await message.answer("Выбери клиента:", reply_markup=kb.as_markup())


@dp.callback_query(F.data.startswith("inv_client:"), CreateInvoice.choose_client)
async def chose_client(callback: CallbackQuery, state: FSMContext):
    client_id = int(callback.data.split(":")[1])
    await state.update_data(client_id=client_id, items=[])
    await state.set_state(CreateInvoice.add_items)
    await callback.message.edit_text(
        "Добавь позиции в счёт.\n\n"
        "Формат: Описание | Цена (или: Описание | Количество | Цена)\n"
        "Пример: Разработка лендинга | 30000\n\n"
        "Когда закончишь — /done"
    )
    await callback.answer()


@dp.message(CreateInvoice.add_items)
async def add_item(message: Message, state: FSMContext):
    if message.text == "/done":
        data = await state.get_data()
        if not data.get("items"):
            await message.answer("Добавь хотя бы одну позицию")
            return
        
        total = sum(i.get("quantity", 1) * i["unit_price"] for i in data["items"])
        lines = [f"• {i['description']} — {i['unit_price']:,.0f} ₽ × {i.get('quantity',1)}" for i in data["items"]]
        
        kb = InlineKeyboardBuilder()
        kb.button(text="✅ Создать счёт", callback_data="inv_confirm")
        kb.button(text="❌ Отмена", callback_data="inv_cancel")
        kb.adjust(2)
        
        await state.set_state(CreateInvoice.confirm)
        await message.answer(
            f"Итого: {total:,.0f} ₽\n\n" + "\n".join(lines),
            reply_markup=kb.as_markup()
        )
        return
    
    # Парсить строку
    parts = [p.strip() for p in message.text.split("|")]
    try:
        if len(parts) == 2:
            desc, price = parts
            items_data = {"description": desc, "quantity": 1, "unit_price": float(price.replace(",", "").replace("₽", "").strip())}
        elif len(parts) == 3:
            desc, qty, price = parts
            items_data = {"description": desc, "quantity": int(qty), "unit_price": float(price.replace(",", "").replace("₽", "").strip())}
        else:
            raise ValueError
    except (ValueError, IndexError):
        await message.answer("Неверный формат. Пример: Дизайн логотипа | 15000")
        return
    
    data = await state.get_data()
    items = data.get("items", [])
    items.append(items_data)
    await state.update_data(items=items)
    await message.answer(f"✅ Добавлено: {items_data['description']} — {items_data['unit_price']:,.0f} ₽\n\nЕщё позицию или /done")


@dp.callback_query(F.data == "inv_confirm", CreateInvoice.confirm)
async def confirm_invoice(callback: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    await state.clear()
    
    clients = await get_clients()
    client = next(c for c in clients if c["id"] == data["client_id"])
    
    invoice = await create_invoice(data["client_id"], data["items"])
    
    # Сгенерировать PDF
    pdf_bytes = generate_invoice_pdf(invoice, client, data["items"])
    pdf_file = BufferedInputFile(pdf_bytes, filename=f"Счёт_{invoice['number']}.pdf")
    
    await callback.message.answer_document(
        pdf_file,
        caption=f"✅ Счёт № {invoice['number']}\n{client['name']}\nИтого: {invoice['total']:,.0f} ₽"
    )
    await callback.answer()


@dp.message(Command("invoices", "pending"))
async def cmd_list(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    status = "pending" if message.text == "/pending" else None
    invoices = await get_invoices(status)
    
    if not invoices:
        await message.answer("Нет счетов")
        return
    
    lines = [f"{'⏳' if i['status']=='pending' else '✅'} № {i['number']} | {i['client_name']} | {i['total']:,.0f} ₽"
             for i in invoices[:10]]
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
ADMIN_ID=123456789
DB_PATH=invoices.db
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

---

::: tip Кириллица в PDF
ReportLab по умолчанию не рендерит кириллицу. Для русского текста нужно подключить шрифт с поддержкой Unicode. Самый простой способ — скачать DejaVuSans.ttf и зарегистрировать: `pdfmetrics.registerFont(TTFont('DejaVu', 'DejaVuSans.ttf'))`, затем использовать fontName='DejaVu' в стилях.
:::
