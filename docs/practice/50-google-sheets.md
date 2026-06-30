# Google Sheets API

Google Sheets как база данных для несложных проектов: контент-план, CRM, лиды, отчёты. Без платного сервера, без SQL — просто таблица.

## Когда подходит

- Редактировать данные нужно вручную (контент-план, лиды)
- Данных немного (< 10 000 строк)
- Нужно показывать данные нетехническому человеку
- Нужна история изменений (Sheets встроено)

Для > 10 000 строк или высоких RPS — PostgreSQL.

## Настройка

### 1. Service Account (для серверного кода)

1. console.cloud.google.com → создать проект
2. APIs & Services → Enable → Google Sheets API + Google Drive API
3. Credentials → Create credentials → Service account
4. Скачать JSON-ключ
5. В таблице: Share → добавить email сервис-аккаунта (viewer/editor)

### 2. Установить библиотеку

```bash
pip install gspread google-auth
```

> 💬 «Установи gspread и google-auth для работы с Google Таблицами»

## Базовые операции

```python
import gspread
from google.oauth2.service_account import Credentials
import os

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def get_client() -> gspread.Client:
    creds = Credentials.from_service_account_file(
        os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json"),
        scopes=SCOPES
    )
    return gspread.authorize(creds)


def open_sheet(spreadsheet_id: str, sheet_name: str = "Sheet1"):
    client = get_client()
    spreadsheet = client.open_by_key(spreadsheet_id)
    return spreadsheet.worksheet(sheet_name)


# Читать все данные
def read_all(sheet_id: str, sheet_name: str = "Sheet1") -> list[dict]:
    ws = open_sheet(sheet_id, sheet_name)
    return ws.get_all_records()  # список словарей, ключи = первая строка


# Читать одну строку
def read_row(sheet_id: str, row: int) -> list:
    ws = open_sheet(sheet_id)
    return ws.row_values(row)


# Записать строку в конец
def append_row(sheet_id: str, values: list, sheet_name: str = "Sheet1"):
    ws = open_sheet(sheet_id, sheet_name)
    ws.append_row(values)


# Обновить ячейку
def update_cell(sheet_id: str, row: int, col: int, value, sheet_name: str = "Sheet1"):
    ws = open_sheet(sheet_id, sheet_name)
    ws.update_cell(row, col, value)
```

## Async-обёртка для ботов

gspread синхронный — оберни в `asyncio.to_thread`:

```python
import asyncio


async def async_read_all(sheet_id: str, sheet_name: str = "Sheet1") -> list[dict]:
    return await asyncio.to_thread(read_all, sheet_id, sheet_name)


async def async_append_row(sheet_id: str, values: list, sheet_name: str = "Sheet1"):
    return await asyncio.to_thread(append_row, sheet_id, values, sheet_name)
```

## Практические паттерны

### Лиды из формы → Sheets

```python
from datetime import datetime


async def save_lead(name: str, phone: str, source: str = "telegram"):
    values = [
        datetime.now().strftime("%d.%m.%Y %H:%M"),
        name,
        phone,
        source,
        "Новый",  # статус
        "",       # комментарий менеджера
    ]
    await async_append_row(
        sheet_id=os.getenv("LEADS_SHEET_ID"),
        values=values,
        sheet_name="Лиды"
    )


# В Telegram-боте:
@dp.message(LeadForm.phone)
async def got_phone(message: Message, state: FSMContext):
    data = await state.get_data()
    await save_lead(data["name"], message.text, "telegram")
    await state.clear()
    await message.answer("Заявка принята! Скоро свяжемся.")
```

### Контент-план → публикация

```python
async def get_ready_posts() -> list[dict]:
    """Получить посты со статусом 'Готово'."""
    records = await async_read_all(
        os.getenv("CONTENT_SHEET_ID"),
        "Контент-план"
    )
    return [r for r in records if r.get("Статус") == "Готово"]


async def mark_published(row_number: int):
    """Обновить статус на 'Опубликовано'."""
    from datetime import datetime
    ws = open_sheet(os.getenv("CONTENT_SHEET_ID"), "Контент-план")
    
    # Найти колонку "Статус" (предполагаем что это 4-я колонка)
    # Лучше найти её программно:
    headers = ws.row_values(1)
    status_col = headers.index("Статус") + 1  # +1 потому что 1-индексация
    published_col = headers.index("Дата публикации") + 1 if "Дата публикации" in headers else None
    
    await asyncio.to_thread(ws.update_cell, row_number, status_col, "Опубликовано")
    if published_col:
        await asyncio.to_thread(
            ws.update_cell,
            row_number,
            published_col,
            datetime.now().strftime("%d.%m.%Y")
        )
```

### Отчёт из БД → Sheets

```python
async def export_stats_to_sheet(stats: list[dict]):
    """Экспортировать статистику в новый лист."""
    client = get_client()
    spreadsheet = client.open_by_key(os.getenv("REPORT_SHEET_ID"))
    
    sheet_name = datetime.now().strftime("Отчёт %d.%m.%Y")
    
    try:
        ws = spreadsheet.worksheet(sheet_name)
        ws.clear()
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(sheet_name, rows=1000, cols=20)
    
    # Заголовки
    if stats:
        headers = list(stats[0].keys())
        ws.update([headers] + [[row.get(h, "") for h in headers] for row in stats])
    
    # Форматирование заголовка (жирный)
    ws.format("A1:Z1", {"textFormat": {"bold": True}})
```

### Поиск по таблице

```python
async def find_by_field(sheet_id: str, field: str, value: str) -> list[dict]:
    """Найти строки где поле = значение."""
    records = await async_read_all(sheet_id)
    return [r for r in records if str(r.get(field, "")) == str(value)]


async def find_user(telegram_id: int) -> dict | None:
    results = await find_by_field(
        os.getenv("USERS_SHEET_ID"),
        "telegram_id",
        str(telegram_id)
    )
    return results[0] if results else None
```

## Батч-операции (быстрее)

```python
# Записать много строк за один API-вызов
def batch_append(sheet_id: str, rows: list[list], sheet_name: str = "Sheet1"):
    ws = open_sheet(sheet_id, sheet_name)
    ws.append_rows(rows)  # один запрос вместо N


# Обновить диапазон
def update_range(sheet_id: str, range_notation: str, values: list[list]):
    """range_notation: например 'A2:D10'"""
    ws = open_sheet(sheet_id)
    ws.update(range_notation, values)
```

## Rate limits и кэш

Google Sheets API: 60 запросов в минуту на проект, 100 в минуту на пользователя.

```python
import time
from functools import wraps

_sheet_cache = {}

def cached_read(ttl_seconds: int = 60):
    """Кэшировать чтение таблицы."""
    def decorator(func):
        @wraps(func)
        async def wrapper(sheet_id: str, *args, **kwargs):
            key = f"{sheet_id}:{func.__name__}"
            now = time.time()
            
            if key in _sheet_cache and now - _sheet_cache[key]["ts"] < ttl_seconds:
                return _sheet_cache[key]["data"]
            
            result = await func(sheet_id, *args, **kwargs)
            _sheet_cache[key] = {"data": result, "ts": now}
            return result
        return wrapper
    return decorator


@cached_read(ttl_seconds=120)
async def get_content_plan(sheet_id: str) -> list[dict]:
    return await async_read_all(sheet_id, "Контент-план")
```

## Переменные окружения

```bash
# .env
GOOGLE_CREDENTIALS_FILE=credentials.json
LEADS_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
CONTENT_SHEET_ID=...
```

> 💬 «Добавь в .env переменные для подключения к Google Таблицам: путь к credentials.json и ID таблицы»

---

::: tip Структура таблицы
Первая строка всегда — заголовки (названия колонок). `get_all_records()` использует их как ключи словаря. Называй колонки без пробелов и кириллицы если это технические ключи, или используй читаемые имена если таблицу редактирует человек.
:::
