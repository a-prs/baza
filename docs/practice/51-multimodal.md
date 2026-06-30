# Мультимодальный AI: работа с изображениями

Claude, GPT-4o и Gemini умеют читать изображения. Это открывает целый класс продуктов: анализатор чеков, ревьюер дизайна, распознаватель документов, OCR.

## Claude Vision: основы

```python
import anthropic
import base64
import httpx
from pathlib import Path


client = anthropic.Anthropic()


def encode_image_file(path: str) -> tuple[str, str]:
    """Закодировать локальный файл в base64."""
    path = Path(path)
    with open(path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode("utf-8")
    
    # Определить media_type по расширению
    ext = path.suffix.lower()
    media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", 
                   ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}
    media_type = media_types.get(ext, "image/jpeg")
    
    return data, media_type


async def analyze_image(image_path: str, question: str) -> str:
    """Проанализировать изображение с вопросом."""
    import anthropic
    
    aclient = anthropic.AsyncAnthropic()
    data, media_type = encode_image_file(image_path)
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data,
                    },
                },
                {"type": "text", "text": question}
            ]
        }]
    )
    
    return response.content[0].text


async def analyze_image_url(url: str, question: str) -> str:
    """Проанализировать изображение по URL."""
    aclient = anthropic.AsyncAnthropic()
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "url", "url": url},
                },
                {"type": "text", "text": question}
            ]
        }]
    )
    
    return response.content[0].text
```

## Паттерны использования

### Анализ чека/скриншота

```python
async def extract_receipt_data(image_path: str) -> dict:
    """Извлечь данные из фото чека."""
    import json
    
    aclient = anthropic.AsyncAnthropic()
    data, media_type = encode_image_file(image_path)
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": """Извлеки данные из чека. Верни ТОЛЬКО JSON без markdown:
{
  "store": "название магазина или null",
  "date": "дата в формате YYYY-MM-DD или null",
  "total": 0.00,
  "currency": "RUB",
  "items": [
    {"name": "название товара", "price": 0.00, "quantity": 1}
  ]
}"""}
            ]
        }]
    )
    
    return json.loads(response.content[0].text)
```

### Ревью дизайна

```python
async def review_design(image_path: str, context: str = "") -> str:
    """Дать структурированный фидбек по дизайну."""
    aclient = anthropic.AsyncAnthropic()
    data, media_type = encode_image_file(image_path)
    
    prompt = f"""Ты — опытный UX/UI дизайнер. Дай конструктивный фидбек по этому дизайну.

{f'Контекст: {context}' if context else ''}

Структура ответа:
1. Что работает хорошо (2-3 пункта)
2. Что нужно улучшить (2-3 пункта)
3. Конкретные рекомендации

Будь конкретным, не общим."""
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=800,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": prompt}
            ]
        }]
    )
    
    return response.content[0].text
```

### OCR: читать текст с изображения

```python
async def extract_text_from_image(image_path: str) -> str:
    """Извлечь текст с изображения (OCR через AI)."""
    aclient = anthropic.AsyncAnthropic()
    data, media_type = encode_image_file(image_path)
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": "Перепиши весь текст с этого изображения. Сохрани форматирование (абзацы, списки). Только текст, без комментариев."}
            ]
        }]
    )
    
    return response.content[0].text


async def analyze_document(image_path: str) -> dict:
    """Классифицировать и извлечь данные из документа."""
    import json
    aclient = anthropic.AsyncAnthropic()
    data, media_type = encode_image_file(image_path)
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": """Проанализируй документ. Верни JSON:
{
  "type": "тип документа (паспорт/накладная/договор/другое)",
  "language": "язык",
  "key_fields": {"название_поля": "значение"},
  "summary": "краткое описание (1 предложение)"
}"""}
            ]
        }]
    )
    
    return json.loads(response.content[0].text)
```

## Telegram-бот с анализом фото

```python
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, PhotoSize
import tempfile
import os

@dp.message(F.photo)
async def handle_photo(message: Message, bot: Bot):
    # Скачать наибольшее качество
    photo: PhotoSize = message.photo[-1]
    
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        await bot.download(photo, destination=tmp_path)
        
        # Определить тип анализа из подписи
        caption = message.caption or ""
        
        if "чек" in caption.lower() or "receipt" in caption.lower():
            data = await extract_receipt_data(tmp_path)
            await message.answer(
                f"🧾 Чек распознан:\n"
                f"Магазин: {data.get('store', '—')}\n"
                f"Дата: {data.get('date', '—')}\n"
                f"Итого: {data.get('total', 0)} {data.get('currency', 'RUB')}"
            )
        
        elif "дизайн" in caption.lower() or "design" in caption.lower():
            context = caption.replace("дизайн", "").replace("design", "").strip()
            review = await review_design(tmp_path, context)
            await message.answer(review)
        
        elif "текст" in caption.lower() or "ocr" in caption.lower():
            text = await extract_text_from_image(tmp_path)
            await message.answer(f"Текст:\n\n{text}")
        
        else:
            # Общий анализ
            description = await analyze_image(tmp_path, "Что на этом изображении? Опиши кратко (3-4 предложения).")
            await message.answer(description)
    
    finally:
        os.unlink(tmp_path)
```

## Несколько изображений сразу

```python
async def compare_images(paths: list[str], question: str) -> str:
    """Сравнить несколько изображений."""
    aclient = anthropic.AsyncAnthropic()
    
    content = []
    for i, path in enumerate(paths[:4], 1):  # max 4 изображения
        data, media_type = encode_image_file(path)
        content.append({"type": "text", "text": f"Изображение {i}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
    
    content.append({"type": "text", "text": question})
    
    response = await aclient.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        messages=[{"role": "user", "content": content}]
    )
    
    return response.content[0].text
```

## Ограничения и советы

| Параметр | Claude |
|---|---|
| Форматы | JPEG, PNG, GIF, WebP |
| Макс. размер | 5 MB на изображение |
| Макс. в запросе | 20 изображений |
| Лучшее качество | Для текста / деталей — PNG |
| Скорость | +0.5-2 сек по сравнению с текстом |

```python
# Сжать изображение перед отправкой
from PIL import Image
import io

def compress_image(input_path: str, max_size_kb: int = 1000) -> bytes:
    with Image.open(input_path) as img:
        if img.mode != "RGB":
            img = img.convert("RGB")
        
        quality = 85
        while True:
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality)
            size_kb = buffer.tell() / 1024
            
            if size_kb <= max_size_kb or quality < 30:
                return buffer.getvalue()
            
            quality -= 10
```

---

::: tip Модели для Vision
`claude-sonnet-4-6` — лучший баланс цена/качество для большинства задач с изображениями. `claude-opus-4-8` — для сложных документов где важна высокая точность. `claude-haiku-4-5` — для простых задач (классификация, базовое OCR), дешевле и быстрее.
:::
