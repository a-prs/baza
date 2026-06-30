# Работа с файлами: PDF, Excel, CSV

Очень частая задача: прочитать Excel-выгрузку, распарсить PDF-отчёт, обработать CSV с данными. Python делает это легко, а ИИ напишет код под конкретный файл.

## CSV — самый простой формат

CSV (Comma-Separated Values) — текстовый файл где данные разделены запятыми. Открывается в Excel и Google Sheets.

### Читать CSV

```python
import csv

with open("data.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)  # DictReader: каждая строка = словарь
    for row in reader:
        print(row["Имя"], row["Email"])
```

### Записать CSV

```python
import csv

rows = [
    {"Имя": "Андрей", "Email": "a@example.com"},
    {"Имя": "Мария", "Email": "m@example.com"},
]

with open("result.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["Имя", "Email"])
    writer.writeheader()
    writer.writerows(rows)
```

### CSV через pandas (удобнее для большого файла)

```bash
pip install pandas
```

```python
import pandas as pd

df = pd.read_csv("data.csv", encoding="utf-8")

# Фильтр: только строки где Город = Москва
moscow = df[df["Город"] == "Москва"]

# Сортировка
sorted_df = df.sort_values("Дата", ascending=False)

# Сохранить результат
moscow.to_csv("moscow.csv", index=False, encoding="utf-8")

print(f"Записей: {len(df)}")
print(df.head())  # первые 5 строк
```

## Excel (.xlsx)

```bash
pip install openpyxl
```

### Читать Excel

```python
import openpyxl

wb = openpyxl.load_workbook("report.xlsx")
ws = wb.active  # первый лист

for row in ws.iter_rows(min_row=2, values_only=True):  # пропускаем заголовок
    name, email, date = row
    print(name, email, date)
```

### Создать Excel с форматированием

```python
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Отчёт"

# Заголовки с форматированием
headers = ["Имя", "Продажи", "Процент"]
for col, header in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.font = Font(bold=True)
    cell.fill = PatternFill("solid", fgColor="4472C4")
    cell.font = Font(bold=True, color="FFFFFF")

# Данные
data = [
    ("Андрей", 150000, 0.35),
    ("Мария", 280000, 0.65),
]
for row_num, row_data in enumerate(data, 2):
    for col, value in enumerate(row_data, 1):
        ws.cell(row=row_num, column=col, value=value)

# Ширина колонок
ws.column_dimensions["A"].width = 20
ws.column_dimensions["B"].width = 15

wb.save("result.xlsx")
```

### Excel через pandas (проще для данных)

```python
import pandas as pd

# Читать
df = pd.read_excel("report.xlsx", sheet_name="Лист1")

# Создать Excel с несколькими листами
with pd.ExcelWriter("result.xlsx", engine="openpyxl") as writer:
    df_moscow.to_excel(writer, sheet_name="Москва", index=False)
    df_spb.to_excel(writer, sheet_name="Питер", index=False)
```

## PDF — извлечение текста

PDF сложнее: текст может быть векторным (копируется) или растровым (изображение, нужен OCR).

### Текстовый PDF

```bash
pip install pypdf2
```

```python
import PyPDF2

with open("document.pdf", "rb") as f:
    reader = PyPDF2.PdfReader(f)
    text = ""
    for page in reader.pages:
        text += page.extract_text()

print(text)
```

Или через `pdfminer` — точнее с форматированием:

```bash
pip install pdfminer.six
```

```python
from pdfminer.high_level import extract_text

text = extract_text("document.pdf")
```

### PDF как изображение (сканы, OCR)

```bash
pip install pytesseract Pillow pdf2image
# Ещё нужен Tesseract: apt install tesseract-ocr tesseract-ocr-rus
```

```python
from pdf2image import convert_from_path
import pytesseract

pages = convert_from_path("scan.pdf", dpi=300)
for i, page in enumerate(pages):
    text = pytesseract.image_to_string(page, lang="rus+eng")
    print(f"Страница {i+1}:\n{text}")
```

## Промпты для работы с файлами

### Обработать конкретный файл

```
У меня CSV файл с колонками: [перечисли колонки из первой строки].
Вот несколько строк примера:
[вставь 3-5 строк]

Напиши Python-скрипт который:
1. Читает файл data.csv
2. Фильтрует строки где [условие]
3. Сортирует по [колонка]
4. Сохраняет результат в result.csv
```

### Извлечь данные из PDF

```
Есть PDF документ. Нужно извлечь из каждой страницы:
- [поле 1]
- [поле 2]
Данные могут быть в таблице или в тексте.

Напиши скрипт который:
1. Читает все страницы PDF
2. Извлекает нужные данные
3. Сохраняет в CSV или JSON
```

### Создать отчёт Excel

```
Создай Python-скрипт который:
1. Читает данные из [источник: CSV/API/список в коде]
2. Создаёт Excel-файл report.xlsx
3. Форматирует: заголовки жирным, заморозить первую строку,
   числа с разделителем тысяч, даты в формате ДД.ММ.ГГГГ
4. Несколько листов: Сводка и Детали
```

## Работа с изображениями

```bash
pip install Pillow
```

```python
from PIL import Image

# Открыть и изменить размер
img = Image.open("photo.jpg")
img_resized = img.resize((800, 600))
img_resized.save("photo_small.jpg", quality=85)

# Обрезать
cropped = img.crop((0, 0, 400, 300))  # (left, top, right, bottom)

# Конвертировать формат
img.save("photo.png")

# Получить размер
width, height = img.size
```

Обработка папки с изображениями:

```python
from pathlib import Path
from PIL import Image

for img_path in Path("images/").glob("*.jpg"):
    img = Image.open(img_path)
    img_resized = img.resize((1024, 1024))
    output_path = Path("output") / img_path.name
    output_path.parent.mkdir(exist_ok=True)
    img_resized.save(output_path, quality=90)
    print(f"Обработано: {img_path.name}")
```

## Зачистка и нормализация данных

Частая задача — данные пришли «грязными»: лишние пробелы, разные форматы дат, пустые строки.

```python
import pandas as pd
from datetime import datetime

df = pd.read_csv("dirty_data.csv")

# Убрать лишние пробелы в строках
df["Имя"] = df["Имя"].str.strip()

# Привести к одному регистру
df["Email"] = df["Email"].str.lower()

# Нормализовать даты
df["Дата"] = pd.to_datetime(df["Дата"], dayfirst=True)

# Убрать дубликаты
df = df.drop_duplicates(subset=["Email"])

# Убрать строки с пустым именем
df = df.dropna(subset=["Имя"])

print(f"Осталось записей: {len(df)}")
df.to_csv("clean_data.csv", index=False)
```

---

::: info Что дальше?
Умеешь читать и писать файлы — можешь автоматизировать обработку отчётов. Следующий уровень: [внешние API](/practice/21-external-apis) для получения данных из облачных хранилищ или [Python-скрипты](/practice/17-python-scripts) для более сложной автоматизации.
:::
