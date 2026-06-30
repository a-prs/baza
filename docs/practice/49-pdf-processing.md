# Работа с PDF

PDF — самый популярный формат документов. Научись его читать, и сможешь строить RAG-системы, нормоконтроль, анализаторы договоров.

## Выбор библиотеки

| Библиотека | Что умеет | Когда |
|---|---|---|
| `PyMuPDF` (fitz) | Текст, изображения, метаданные, быстро | Первый выбор |
| `pdfplumber` | Таблицы, координаты текста | Нужны таблицы |
| `pypdf` | Базовое чтение, слияние, разрезание | Манипуляции с файлом |
| `pdfminer.six` | Детальное извлечение текста | Сложная разметка |

```bash
pip install pymupdf pdfplumber pypdf
```

## PyMuPDF: основы

```python
import fitz  # pymupdf

def extract_text(pdf_path: str) -> str:
    """Извлечь весь текст из PDF."""
    doc = fitz.open(pdf_path)
    pages_text = []
    
    for page_num, page in enumerate(doc, 1):
        text = page.get_text()
        pages_text.append(f"--- Страница {page_num} ---\n{text}")
    
    doc.close()
    return "\n".join(pages_text)


def extract_text_with_metadata(pdf_path: str) -> dict:
    """Текст + метаданные документа."""
    doc = fitz.open(pdf_path)
    
    meta = doc.metadata
    total_pages = len(doc)
    
    pages = []
    for page in doc:
        text = page.get_text()
        # Размер страницы в пунктах (1pt = 1/72 дюйма)
        width, height = page.rect.width, page.rect.height
        pages.append({
            "page": page.number + 1,
            "text": text,
            "width": width,
            "height": height,
        })
    
    doc.close()
    return {
        "title": meta.get("title", ""),
        "author": meta.get("author", ""),
        "pages_count": total_pages,
        "pages": pages,
    }
```

## Чанкинг для RAG

Большие PDF не влезают в контекст — нарезай на чанки с перекрытием:

```python
def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Разрезать текст на чанки с перекрытием."""
    chunks = []
    start = 0
    
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        
        # Не резать посредине слова
        if end < len(text):
            last_space = chunk.rfind(" ")
            if last_space > chunk_size * 0.8:
                chunk = chunk[:last_space]
                end = start + last_space
        
        chunks.append(chunk.strip())
        start = end - overlap
    
    return [c for c in chunks if len(c) > 50]  # убрать мусор


def extract_chunks_from_pdf(pdf_path: str, chunk_size: int = 1000) -> list[dict]:
    """Извлечь чанки с метаданными страницы."""
    doc = fitz.open(pdf_path)
    all_chunks = []
    
    for page_num, page in enumerate(doc, 1):
        text = page.get_text()
        if not text.strip():
            continue
        
        chunks = chunk_text(text, chunk_size)
        for i, chunk in enumerate(chunks):
            all_chunks.append({
                "content": chunk,
                "page": page_num,
                "chunk_index": i,
                "source": pdf_path,
            })
    
    doc.close()
    return all_chunks
```

## Таблицы с pdfplumber

PyMuPDF плохо справляется с таблицами — для них pdfplumber:

```python
import pdfplumber
import csv
import io


def extract_tables(pdf_path: str) -> list[list[list]]:
    """Извлечь все таблицы из PDF."""
    all_tables = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            tables = page.extract_tables()
            for table in tables:
                # Убрать None-ячейки
                clean_table = [
                    [cell or "" for cell in row]
                    for row in table
                ]
                all_tables.append({
                    "page": page_num,
                    "data": clean_table,
                })
    
    return all_tables


def table_to_markdown(table: list[list[str]]) -> str:
    """Конвертировать таблицу в Markdown."""
    if not table:
        return ""
    
    lines = []
    # Заголовок
    lines.append("| " + " | ".join(table[0]) + " |")
    lines.append("|" + "|".join(["---"] * len(table[0])) + "|")
    # Строки
    for row in table[1:]:
        lines.append("| " + " | ".join(row) + " |")
    
    return "\n".join(lines)


def extract_tables_as_csv(pdf_path: str, output_dir: str = "."):
    """Сохранить каждую таблицу как отдельный CSV."""
    import os
    os.makedirs(output_dir, exist_ok=True)
    
    with pdfplumber.open(pdf_path) as pdf:
        table_count = 0
        for page_num, page in enumerate(pdf.pages, 1):
            tables = page.extract_tables()
            for table in tables:
                table_count += 1
                output_path = f"{output_dir}/table_p{page_num}_{table_count}.csv"
                
                with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
                    writer = csv.writer(f)
                    for row in table:
                        writer.writerow([cell or "" for cell in row])
                
                print(f"Таблица {table_count}: {output_path}")
```

## Изображения из PDF

```python
def extract_images(pdf_path: str, output_dir: str = "images") -> list[str]:
    """Извлечь изображения из PDF."""
    import os
    os.makedirs(output_dir, exist_ok=True)
    
    doc = fitz.open(pdf_path)
    saved_paths = []
    
    for page_num, page in enumerate(doc):
        image_list = page.get_images(full=True)
        
        for img_index, img_ref in enumerate(image_list):
            xref = img_ref[0]  # идентификатор изображения
            base_image = doc.extract_image(xref)
            
            img_bytes = base_image["image"]
            img_ext = base_image["ext"]  # png, jpeg, etc.
            
            output_path = f"{output_dir}/page{page_num+1}_img{img_index}.{img_ext}"
            with open(output_path, "wb") as f:
                f.write(img_bytes)
            
            saved_paths.append(output_path)
    
    doc.close()
    return saved_paths
```

## Обработка в Telegram-боте

```python
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, Document
import tempfile
import os

@dp.message(F.document.mime_type == "application/pdf")
async def handle_pdf(message: Message, bot: Bot):
    doc: Document = message.document
    
    if doc.file_size > 20 * 1024 * 1024:  # 20 MB limit Bot API
        await message.answer("Файл слишком большой (>20 МБ)")
        return
    
    status = await message.answer("Читаю PDF...")
    
    # Скачать файл
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        await bot.download(doc, destination=tmp_path)
        
        # Извлечь текст
        text = extract_text(tmp_path)
        
        if not text.strip():
            await status.edit_text("PDF не содержит текста (возможно, это сканы)")
            return
        
        # Спросить Claude о содержании
        summary = await summarize_with_claude(text[:8000])  # первые 8000 символов
        await status.edit_text(f"Краткое содержание:\n\n{summary}")
    
    finally:
        os.unlink(tmp_path)


async def summarize_with_claude(text: str) -> str:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic()
    
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{
            "role": "user",
            "content": f"Сделай краткое содержание этого документа (5-7 пунктов):\n\n{text}"
        }]
    )
    return response.content[0].text
```

## Создание PDF с ReportLab

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors


def create_report_pdf(data: dict, output_path: str):
    """Создать PDF-отчёт."""
    doc = SimpleDocTemplate(output_path, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []
    
    # Заголовок
    title_style = ParagraphStyle(
        "Title", parent=styles["Heading1"],
        fontSize=18, spaceAfter=20
    )
    story.append(Paragraph(data["title"], title_style))
    story.append(Spacer(1, 0.5 * cm))
    
    # Таблица с данными
    table_data = [["Параметр", "Значение"]]  # заголовок
    for key, value in data["metrics"].items():
        table_data.append([key, str(value)])
    
    table = Table(table_data, colWidths=[8 * cm, 8 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 12),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("PADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(table)
    
    doc.build(story)
    return output_path
```

---

::: tip Сканированные PDF
`page.get_text()` вернёт пустую строку для отсканированных PDF. Нужен OCR: `pip install easyocr` или Tesseract. Для больших объёмов — сначала проверь `if len(text.strip()) < 100` и переключайся на OCR-пайплайн.
:::
