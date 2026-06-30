# Генерация изображений через API

ИИ умеет рисовать. Подключи это к боту — и пользователи смогут генерировать обложки, иллюстрации, аватарки прямо в Telegram. Разберём три провайдера: DALL-E (OpenAI), Stable Diffusion (через Replicate), и fal.ai.

## DALL-E 3 (OpenAI)

Самый простой вариант — используешь уже знакомый OpenAI SDK.

```bash
pip install openai
```

```python
from openai import OpenAI
import os
import httpx

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def generate_image(prompt: str, size: str = "1024x1024") -> str:
    """Сгенерировать изображение. Вернуть URL."""
    response = client.images.generate(
        model="dall-e-3",
        prompt=prompt,
        size=size,  # "1024x1024", "1792x1024", "1024x1792"
        quality="standard",  # "standard" или "hd"
        n=1
    )
    return response.data[0].url

def generate_and_save(prompt: str, path: str = "image.png"):
    """Сгенерировать и сохранить локально"""
    url = generate_image(prompt)
    img_data = httpx.get(url).content
    with open(path, "wb") as f:
        f.write(img_data)
    return path
```

### Цены DALL-E 3
- Стандарт 1024×1024: $0.04 за изображение
- HD 1024×1024: $0.08 за изображение

## Встроить в Telegram-бота

```python
import asyncio
import os
import httpx
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, BufferedInputFile
from aiogram.filters import Command
from openai import AsyncOpenAI

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
ai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


@dp.message(Command("imagine"))
async def cmd_imagine(message: Message):
    prompt = message.text.removeprefix("/imagine").strip()
    
    if not prompt:
        await message.answer("Напиши промпт: /imagine красивый закат над морем")
        return
    
    status = await message.answer("Рисую... ✏️")
    
    try:
        # Генерация
        response = await ai.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size="1024x1024",
            n=1
        )
        image_url = response.data[0].url
        revised_prompt = response.data[0].revised_prompt  # что DALL-E реально нарисовал
        
        # Скачать и отправить
        async with httpx.AsyncClient() as http:
            img_bytes = (await http.get(image_url)).content
        
        await bot.send_photo(
            message.chat.id,
            photo=BufferedInputFile(img_bytes, filename="image.png"),
            caption=f"🎨 Готово!\n\n_{revised_prompt[:200]}_",
            parse_mode="Markdown"
        )
        await status.delete()
    
    except Exception as e:
        await status.edit_text(f"Ошибка: {e}")
```

## Replicate: сотни моделей

Replicate даёт доступ к Stable Diffusion, SDXL, Flux и ещё сотням моделей. Платишь только за вычисления.

```bash
pip install replicate
```

```python
import replicate
import os

os.environ["REPLICATE_API_TOKEN"] = os.getenv("REPLICATE_API_TOKEN")

def generate_sdxl(prompt: str, negative: str = "") -> str:
    """SDXL — качественные реалистичные изображения"""
    output = replicate.run(
        "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        input={
            "prompt": prompt,
            "negative_prompt": negative or "ugly, blurry, low quality",
            "width": 1024,
            "height": 1024,
            "num_inference_steps": 25,
        }
    )
    return output[0]  # URL изображения


def generate_flux(prompt: str) -> str:
    """Flux Schnell — быстрая генерация"""
    output = replicate.run(
        "black-forest-labs/flux-schnell",
        input={"prompt": prompt}
    )
    return output[0]
```

Преимущество: можно менять модель не меняя код. Цены от $0.002 за изображение.

## fal.ai: быстрее всего

fal.ai специализируется на быстрой генерации (<3 сек для большинства моделей):

```bash
pip install fal-client
```

```python
import fal_client
import os

os.environ["FAL_KEY"] = os.getenv("FAL_API_KEY")

async def generate_fast(prompt: str) -> str:
    """FLUX.1-schnell через fal.ai"""
    handler = await fal_client.submit_async(
        "fal-ai/flux/schnell",
        arguments={
            "prompt": prompt,
            "image_size": "square_hd",
            "num_inference_steps": 4,
        }
    )
    result = await handler.get()
    return result["images"][0]["url"]
```

## Совет по промптам

Качество изображения сильно зависит от промпта:

```python
def enhance_prompt(user_prompt: str, style: str = "photo") -> str:
    """Улучшить промпт для лучшего результата"""
    styles = {
        "photo": "professional photo, 4k, sharp, well-lit",
        "art": "digital art, illustration, vibrant colors, detailed",
        "logo": "minimal logo design, vector style, clean, professional",
        "cover": "book cover design, typography, dramatic lighting",
    }
    
    suffix = styles.get(style, "")
    return f"{user_prompt}, {suffix}" if suffix else user_prompt


# Использование
prompt = enhance_prompt("красивый горный пейзаж", style="photo")
# → "красивый горный пейзаж, professional photo, 4k, sharp, well-lit"
```

## Бот с выбором стиля

```python
from aiogram.utils.keyboard import InlineKeyboardBuilder

def style_keyboard(prompt: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    styles = [("📷 Фото", "photo"), ("🎨 Арт", "art"), ("💼 Лого", "logo")]
    for label, style in styles:
        encoded = f"{style}:{prompt[:100]}"  # обрезаем чтобы влезло в callback_data
        builder.button(text=label, callback_data=f"gen:{encoded}")
    return builder.as_markup()


@dp.message(Command("imagine"))
async def cmd_imagine(message: Message):
    prompt = message.text.removeprefix("/imagine").strip()
    if not prompt:
        await message.answer("Напиши промпт: /imagine горный закат")
        return
    
    await message.answer(
        f"Промпт: *{prompt}*\n\nВыбери стиль:",
        reply_markup=style_keyboard(prompt),
        parse_mode="Markdown"
    )


@dp.callback_query(F.data.startswith("gen:"))
async def handle_generate(callback: CallbackQuery):
    _, style, *prompt_parts = callback.data.split(":")
    prompt = ":".join(prompt_parts)  # восстанавливаем промпт
    
    await callback.message.edit_text(f"Генерирую в стиле «{style}»...")
    
    full_prompt = enhance_prompt(prompt, style)
    # ... вызов generate_and_save, отправка фото
    await callback.answer()
```

## Ограничения и модерация

OpenAI автоматически отклоняет неподходящие промпты. Replicate/fal.ai — зависит от модели. Добавь базовый фильтр:

```python
BANNED_WORDS = ["explicit", "nsfw", "nude"]  # дополни по необходимости

def is_safe_prompt(prompt: str) -> bool:
    lower = prompt.lower()
    return not any(word in lower for word in BANNED_WORDS)
```

---

::: info Сравнение провайдеров
- **DALL-E 3** — лучшее следование промпту, понимает русский язык, $0.04/img
- **Flux Schnell** (fal.ai) — самый быстрый (<3 сек), $0.003/img
- **SDXL** (Replicate) — гибкие параметры, много моделей, от $0.002/img
:::
