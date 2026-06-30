# Мини-CRM в Telegram

Простая CRM прямо в боте: добавляй контакты, ставь статусы, записывай заметки и получай напоминания о следующих шагах. Всё в одном чате, без переключения между приложениями.

## Функционал

- Добавить контакт (имя + телефон/telegram + источник)
- Установить статус: Лид → Переговоры → Клиент → Закрыт
- Добавить заметку или задачу с дедлайном
- Просмотреть список контактов с фильтром по статусу
- Напоминания о задачах (APScheduler)

## Структура

```
crm-bot/
├── bot.py
├── db.py
├── keyboards.py
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
apscheduler
python-dotenv
aiosqlite
```

## База данных (db.py)

```python
import aiosqlite
import os
from datetime import datetime

DB_PATH = os.getenv("DB_PATH", "crm.db")

STATUSES = ["Лид", "Переговоры", "Клиент", "Закрыт"]


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                phone TEXT,
                telegram TEXT,
                source TEXT,
                status TEXT DEFAULT 'Лид',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER,
                owner_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                due_at TIMESTAMP,
                done BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            )
        """)
        await db.commit()


async def add_contact(owner_id: int, name: str, phone: str = "", telegram: str = "", source: str = "") -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO contacts (owner_id, name, phone, telegram, source) VALUES (?, ?, ?, ?, ?)",
            (owner_id, name, phone, telegram, source)
        )
        await db.commit()
        return cursor.lastrowid


async def get_contacts(owner_id: int, status: str = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status:
            rows = await db.execute_fetchall(
                "SELECT * FROM contacts WHERE owner_id = ? AND status = ? ORDER BY updated_at DESC",
                (owner_id, status)
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM contacts WHERE owner_id = ? ORDER BY updated_at DESC",
                (owner_id,)
            )
        return [dict(r) for r in rows]


async def get_contact(contact_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        row = await db.execute_fetchone(
            "SELECT * FROM contacts WHERE id = ?", (contact_id,)
        )
        return dict(row) if row else None


async def update_status(contact_id: int, status: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE contacts SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, contact_id)
        )
        await db.commit()


async def add_note(contact_id: int, note: str):
    async with aiosqlite.connect(DB_PATH) as db:
        row = await db.execute_fetchone(
            "SELECT notes FROM contacts WHERE id = ?", (contact_id,)
        )
        existing = row[0] if row and row[0] else ""
        timestamp = datetime.now().strftime("%d.%m %H:%M")
        new_notes = f"{existing}\n[{timestamp}] {note}".strip()
        
        await db.execute(
            "UPDATE contacts SET notes = ?, updated_at = datetime('now') WHERE id = ?",
            (new_notes, contact_id)
        )
        await db.commit()


async def add_task(owner_id: int, contact_id: int, text: str, due_at: datetime = None) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO tasks (owner_id, contact_id, text, due_at) VALUES (?, ?, ?, ?)",
            (owner_id, contact_id, text, due_at.isoformat() if due_at else None)
        )
        await db.commit()
        return cursor.lastrowid


async def get_overdue_tasks(before: datetime) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            """SELECT t.*, c.name as contact_name 
               FROM tasks t 
               LEFT JOIN contacts c ON t.contact_id = c.id
               WHERE t.done = 0 AND t.due_at <= ?""",
            (before.isoformat(),)
        )
        return [dict(r) for r in rows]


async def complete_task(task_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE tasks SET done = 1 WHERE id = ?", (task_id,))
        await db.commit()
```

## Клавиатуры (keyboards.py)

```python
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder

STATUSES = ["Лид", "Переговоры", "Клиент", "Закрыт"]

def main_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="➕ Добавить контакт", callback_data="crm:add")
    builder.button(text="📋 Все контакты", callback_data="crm:list:all")
    builder.button(text="🔥 Лиды", callback_data="crm:list:Лид")
    builder.button(text="💬 Переговоры", callback_data="crm:list:Переговоры")
    builder.button(text="✅ Клиенты", callback_data="crm:list:Клиент")
    builder.adjust(1, 2, 2)
    return builder.as_markup()


def contact_keyboard(contact_id: int) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="📝 Заметка", callback_data=f"crm:note:{contact_id}")
    builder.button(text="⏰ Задача", callback_data=f"crm:task:{contact_id}")
    builder.button(text="🔄 Статус", callback_data=f"crm:status:{contact_id}")
    builder.button(text="← Назад", callback_data="crm:list:all")
    builder.adjust(2, 1, 1)
    return builder.as_markup()


def status_keyboard(contact_id: int) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for status in STATUSES:
        builder.button(text=status, callback_data=f"crm:setstatus:{contact_id}:{status}")
    builder.button(text="← Отмена", callback_data=f"crm:contact:{contact_id}")
    builder.adjust(2, 1)
    return builder.as_markup()
```

## Бот (bot.py — выдержки ключевой логики)

```python
import asyncio
import os
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

from db import *
from keyboards import *


class AddContact(StatesGroup):
    name = State()
    phone = State()
    source = State()

class AddNote(StatesGroup):
    contact_id = State()
    text = State()

class AddTask(StatesGroup):
    contact_id = State()
    text = State()
    due_days = State()


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer("👋 CRM-бот\n\nУправляй контактами прямо здесь.", reply_markup=main_keyboard())


# --- Добавление контакта ---

@dp.callback_query(F.data == "crm:add")
async def start_add(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AddContact.name)
    await callback.message.answer("Имя контакта:")
    await callback.answer()

@dp.message(AddContact.name)
async def got_name(message: Message, state: FSMContext):
    await state.update_data(name=message.text)
    await state.set_state(AddContact.phone)
    await message.answer("Телефон или Telegram (или /skip):")

@dp.message(AddContact.phone)
async def got_phone(message: Message, state: FSMContext):
    phone = "" if message.text == "/skip" else message.text
    await state.update_data(phone=phone)
    await state.set_state(AddContact.source)
    await message.answer("Откуда контакт? (реклама, рекомендация, конф. и т.д. или /skip):")

@dp.message(AddContact.source)
async def got_source(message: Message, state: FSMContext):
    data = await state.get_data()
    await state.clear()
    
    source = "" if message.text == "/skip" else message.text
    contact_id = await add_contact(
        owner_id=message.from_user.id,
        name=data["name"],
        phone=data.get("phone", ""),
        source=source
    )
    await message.answer(
        f"✅ Контакт добавлен: **{data['name']}**",
        reply_markup=contact_keyboard(contact_id),
        parse_mode="Markdown"
    )


# --- Список контактов ---

@dp.callback_query(F.data.startswith("crm:list:"))
async def show_list(callback: CallbackQuery):
    status = callback.data.split(":")[2]
    filter_status = None if status == "all" else status
    
    contacts = await get_contacts(callback.from_user.id, filter_status)
    
    if not contacts:
        await callback.message.edit_text(
            "Контактов нет. Добавь первый!",
            reply_markup=main_keyboard()
        )
        await callback.answer()
        return
    
    builder = InlineKeyboardBuilder()
    for c in contacts[:15]:
        status_icon = {"Лид": "🔥", "Переговоры": "💬", "Клиент": "✅", "Закрыт": "❌"}.get(c["status"], "•")
        builder.button(
            text=f"{status_icon} {c['name']}",
            callback_data=f"crm:contact:{c['id']}"
        )
    builder.button(text="← Меню", callback_data="crm:menu")
    builder.adjust(1)
    
    title = f"Все контакты ({len(contacts)})" if not filter_status else f"{filter_status} ({len(contacts)})"
    await callback.message.edit_text(title, reply_markup=builder.as_markup())
    await callback.answer()


# --- Детальная карточка ---

@dp.callback_query(F.data.startswith("crm:contact:"))
async def show_contact(callback: CallbackQuery):
    contact_id = int(callback.data.split(":")[2])
    c = await get_contact(contact_id)
    
    if not c:
        await callback.answer("Контакт не найден.")
        return
    
    text = (
        f"**{c['name']}**\n"
        f"Статус: {c['status']}\n"
        + (f"Телефон: {c['phone']}\n" if c.get("phone") else "")
        + (f"Источник: {c['source']}\n" if c.get("source") else "")
        + (f"\n**Заметки:**\n{c['notes']}" if c.get("notes") else "")
    )
    
    await callback.message.edit_text(text, reply_markup=contact_keyboard(contact_id), parse_mode="Markdown")
    await callback.answer()


# --- Статус ---

@dp.callback_query(F.data.startswith("crm:status:"))
async def change_status(callback: CallbackQuery):
    contact_id = int(callback.data.split(":")[2])
    await callback.message.edit_text("Выбери новый статус:", reply_markup=status_keyboard(contact_id))
    await callback.answer()

@dp.callback_query(F.data.startswith("crm:setstatus:"))
async def set_status(callback: CallbackQuery):
    _, _, contact_id, status = callback.data.split(":")
    await update_status(int(contact_id), status)
    await callback.answer(f"Статус → {status}")
    # Вернуть карточку
    callback.data = f"crm:contact:{contact_id}"
    await show_contact(callback)


# --- Напоминания ---

async def send_reminders():
    now = datetime.now()
    tasks = await get_overdue_tasks(now)
    for task in tasks:
        try:
            contact_name = task.get("contact_name", "контакт")
            await bot.send_message(
                task["owner_id"],
                f"⏰ **Напоминание**\n{task['text']}\n\nКонтакт: {contact_name}"
            )
            await complete_task(task["id"])
        except Exception:
            pass


async def main():
    await init_db()
    scheduler.add_job(send_reminders, "interval", minutes=30, id="reminders")
    scheduler.start()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
DB_PATH=crm.db
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

---

::: tip Экспорт данных
Добавь команду /export — отправляет CSV со всеми контактами. Промпт: «Добавь в бота команду /export которая генерирует CSV файл со всеми контактами (колонки: имя, телефон, статус, заметки, дата) и отправляет его документом».
:::
