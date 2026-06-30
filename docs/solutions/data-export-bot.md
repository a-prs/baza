# Бот-отчётчик: данные → Excel/PDF/CSV

Бот собирает данные из разных источников (Google Sheets, БД, API) и по команде или по расписанию генерирует отчёт нужного формата — и сразу отправляет файлом в Telegram.

## Что умеет

- Генерировать CSV из SQLite/PostgreSQL
- Создавать Excel с форматированием через openpyxl
- Делать PDF-отчёты через ReportLab
- Отправлять по расписанию (еженедельный отчёт)
- Собирать данные из Google Sheets

## Структура

```
report-bot/
├── bot.py
├── exporters/
│   ├── csv_export.py
│   ├── excel_export.py
│   └── pdf_export.py
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
openpyxl
reportlab
gspread
google-auth
apscheduler
python-dotenv
aiosqlite
```

## CSV из SQLite (csv_export.py)

```python
import csv
import io
import sqlite3
import os


def export_to_csv(query: str, params: tuple = (), db_path: str = "app.db") -> bytes:
    """Выполнить запрос и вернуть CSV как bytes"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    rows = conn.execute(query, params).fetchall()
    conn.close()
    
    if not rows:
        return b""
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows([dict(row) for row in rows])
    
    return output.getvalue().encode("utf-8-sig")  # utf-8-sig для корректного открытия в Excel


def orders_report_csv() -> bytes:
    """Пример: отчёт по заказам"""
    return export_to_csv(
        """SELECT 
               id, 
               user_name,
               amount,
               status,
               strftime('%d.%m.%Y', created_at) as date
           FROM orders
           ORDER BY created_at DESC
           LIMIT 1000"""
    )
```

## Excel с форматированием (excel_export.py)

```python
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import io
from datetime import datetime


def export_to_excel(
    data: list[dict],
    title: str = "Отчёт",
    sheet_name: str = "Данные"
) -> bytes:
    """Создать Excel-файл из списка словарей"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    
    if not data:
        ws["A1"] = "Нет данных"
        output = io.BytesIO()
        wb.save(output)
        return output.getvalue()
    
    # Стили
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin")
    )
    
    # Заголовок документа
    ws["A1"] = title
    ws["A1"].font = Font(bold=True, size=14)
    ws["B1"] = f"Создан: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
    
    # Заголовки таблицы
    headers = list(data[0].keys())
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=3, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = border
    
    # Данные
    for row_idx, row_data in enumerate(data, 4):
        for col_idx, key in enumerate(headers, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=row_data.get(key))
            cell.border = border
            
            # Зебра-раскраска строк
            if row_idx % 2 == 0:
                cell.fill = PatternFill(start_color="F0F9FF", fill_type="solid")
    
    # Авто-ширина колонок
    for col in ws.columns:
        max_len = max((len(str(c.value or "")) for c in col), default=0)
        ws.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 4, 50)
    
    # Заморозить строку с заголовками
    ws.freeze_panes = "A4"
    
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def sales_report_excel(data: list[dict]) -> bytes:
    """Отчёт по продажам"""
    return export_to_excel(
        data,
        title="Отчёт по продажам",
        sheet_name="Продажи"
    )
```

## PDF-отчёт (pdf_export.py)

```python
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import io


def export_to_pdf(
    data: list[dict],
    title: str = "Отчёт",
    summary: str = ""
) -> bytes:
    """Создать PDF с таблицей данных"""
    output = io.BytesIO()
    
    doc = SimpleDocTemplate(
        output,
        pagesize=landscape(A4) if len(data[0]) > 5 else A4,
        topMargin=20,
        bottomMargin=20,
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title",
        parent=styles["Title"],
        fontSize=16,
        spaceAfter=12
    )
    
    elements = []
    
    # Заголовок
    elements.append(Paragraph(title, title_style))
    
    if summary:
        elements.append(Paragraph(summary, styles["Normal"]))
    elements.append(Spacer(1, 12))
    
    if not data:
        elements.append(Paragraph("Нет данных", styles["Normal"]))
    else:
        headers = list(data[0].keys())
        table_data = [headers]
        for row in data:
            table_data.append([str(row.get(h, "")) for h in headers])
        
        table = Table(table_data, repeatRows=1)
        table.setStyle(TableStyle([
            # Заголовок
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, 0), 11),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            # Данные
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0F9FF")]),
            # Рамки
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(table)
    
    doc.build(elements)
    return output.getvalue()
```

## Бот (bot.py)

```python
import asyncio
import os
import sqlite3
from dotenv import load_dotenv
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, BufferedInputFile
from aiogram.filters import Command
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()
bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

ADMIN_ID = int(os.getenv("ADMIN_ID"))

from exporters.csv_export import orders_report_csv
from exporters.excel_export import sales_report_excel
from exporters.pdf_export import export_to_pdf


def get_sample_data() -> list[dict]:
    """Пример данных из БД"""
    conn = sqlite3.connect("app.db")
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@dp.message(Command("report"))
async def cmd_report(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    await message.answer(
        "Выбери формат отчёта:\n"
        "/report_csv — CSV (открывается в Excel)\n"
        "/report_excel — Excel с форматированием\n"
        "/report_pdf — PDF"
    )


@dp.message(Command("report_csv"))
async def cmd_report_csv(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    status = await message.answer("Генерирую CSV...")
    data = orders_report_csv()
    
    if not data:
        await status.edit_text("Данных нет.")
        return
    
    fname = f"orders_{datetime.now().strftime('%Y%m%d')}.csv"
    await bot.send_document(
        message.chat.id,
        document=BufferedInputFile(data, filename=fname),
        caption=f"Отчёт по заказам, {datetime.now().strftime('%d.%m.%Y')}"
    )
    await status.delete()


@dp.message(Command("report_excel"))
async def cmd_report_excel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    status = await message.answer("Генерирую Excel...")
    rows = get_sample_data()
    data = sales_report_excel(rows)
    
    fname = f"report_{datetime.now().strftime('%Y%m%d')}.xlsx"
    await bot.send_document(
        message.chat.id,
        document=BufferedInputFile(data, filename=fname),
        caption=f"Отчёт: {len(rows)} строк"
    )
    await status.delete()


@dp.message(Command("report_pdf"))
async def cmd_report_pdf(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    status = await message.answer("Генерирую PDF...")
    rows = get_sample_data()
    data = export_to_pdf(rows, title="Отчёт по продажам", summary=f"Всего: {len(rows)} записей")
    
    fname = f"report_{datetime.now().strftime('%Y%m%d')}.pdf"
    await bot.send_document(
        message.chat.id,
        document=BufferedInputFile(data, filename=fname)
    )
    await status.delete()


async def weekly_report():
    """Еженедельный отчёт каждый понедельник в 9:00"""
    rows = get_sample_data()
    data = sales_report_excel(rows)
    fname = f"weekly_{datetime.now().strftime('%Y%m%d')}.xlsx"
    
    await bot.send_document(
        ADMIN_ID,
        document=BufferedInputFile(data, filename=fname),
        caption=f"Еженедельный отчёт, {datetime.now().strftime('%d.%m.%Y')}"
    )


async def main():
    scheduler.add_job(
        weekly_report,
        "cron",
        day_of_week="mon",
        hour=9,
        minute=0,
        id="weekly_report"
    )
    scheduler.start()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
ADMIN_ID=123456789
DB_PATH=app.db
```

---

::: tip Google Sheets как источник
Чтобы читать данные из Google Sheets — добавь gspread и service account (как в решении «Автопостинг из Google Sheets»). Функция `get_sample_data()` возвращает список словарей — можно взять данные из любого источника.
:::
