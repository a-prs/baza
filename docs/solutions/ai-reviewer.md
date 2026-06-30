# AI-ревьюер: бот проверяет тексты

Бот принимает текст (резюме, пост, описание товара, бизнес-план) и возвращает структурированный разбор через Claude. Универсальный шаблон — меняешь промпт и получаешь ревьюер чего угодно.

## Что умеет

- Принять текст сообщением или файлом (.txt, .md)
- Выбрать тип проверки (резюме / пост / питч / произвольное)
- Вернуть структурированный анализ с оценкой и конкретными улучшениями
- Сохранить историю проверок

## Структура

```
ai-reviewer/
├── bot.py
├── reviewer.py    # логика проверок
├── prompts/
│   ├── resume.txt
│   ├── post.txt
│   └── pitch.txt
├── .env
└── requirements.txt
```

## Промпты (prompts/)

**resume.txt:**
```
Ты — опытный HR-специалист и карьерный консультант. 
Оцени резюме по следующим критериям:

1. ПЕРВОЕ ВПЕЧАТЛЕНИЕ (1-10): что бросается в глаза за 6 секунд
2. СТРУКТУРА: логика и порядок разделов
3. ДОСТИЖЕНИЯ: конкретные результаты или просто обязанности?
4. ФОРМУЛИРОВКИ: активный голос, конкретные глаголы
5. КРАСНЫЕ ФЛАГИ: что насторожит рекрутера
6. ТОП-3 УЛУЧШЕНИЯ: что сделать прямо сейчас

Формат: для каждого пункта — оценка + 2-3 предложения + конкретный пример правки если нужен.
В конце — общая оценка от 1 до 10 и одна фраза «главный вывод».
```

**post.txt:**
```
Ты — опытный контент-маркетолог. Оцени пост для социальных сетей:

1. КРЮЧОК (1-10): первые 1-2 предложения — захватывают ли внимание?
2. ЦЕННОСТЬ: чему научит или что даст читателю?
3. ЧИТАБЕЛЬНОСТЬ: форматирование, абзацы, длина
4. CTA: есть ли призыв к действию? Он чёткий?
5. ТОНАЛЬНОСТЬ: соответствует ли аудитории?
6. ПРАВКИ: 3 конкретных улучшения с примерами

Общая оценка (1-10) и одна фраза — что здесь лучше всего.
```

**pitch.txt:**
```
Ты — венчурный инвестор и ментор стартапов. Оцени питч/описание бизнеса:

1. ПРОБЛЕМА: чётко ли сформулирована боль клиента?
2. РЕШЕНИЕ: понятно ли в чём уникальность?
3. РЫНОК: есть ли понимание размера и клиента?
4. БИЗНЕС-МОДЕЛЬ: откуда деньги?
5. КОМАНДА: упомянуты ли ключевые компетенции?
6. СЛАБЫЕ МЕСТА: 3 главных вопроса которые возникают сразу
7. СИЛЬНЫЕ СТОРОНЫ: что реально цепляет

Готов ли я дать $100k после этого питча? Почему да/нет.
```

## Логика проверки (reviewer.py)

```python
import os
from anthropic import AsyncAnthropic

client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")

REVIEW_TYPES = {
    "resume": ("📄 Резюме", "resume.txt"),
    "post": ("📱 Пост", "post.txt"),
    "pitch": ("🚀 Питч", "pitch.txt"),
}


def load_prompt(filename: str) -> str:
    with open(os.path.join(PROMPTS_DIR, filename), encoding="utf-8") as f:
        return f.read()


async def review(text: str, review_type: str = "post") -> str:
    """Провести ревью текста. Вернуть анализ."""
    _, prompt_file = REVIEW_TYPES.get(review_type, ("Пост", "post.txt"))
    system_prompt = load_prompt(prompt_file)
    
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"Вот текст для анализа:\n\n---\n{text}\n---"
        }]
    )
    return response.content[0].text
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
)
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

from reviewer import review, REVIEW_TYPES


class ReviewStates(StatesGroup):
    waiting_type = State()
    waiting_text = State()


def type_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for key, (label, _) in REVIEW_TYPES.items():
        builder.button(text=label, callback_data=f"type:{key}")
    builder.button(text="🎯 Произвольный промпт", callback_data="type:custom")
    builder.adjust(1)
    return builder.as_markup()


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "Привет! Я AI-ревьюер.\n\n"
        "Пришли текст — разберу по косточкам:\n"
        "👉 Что работает, что нет, что улучшить\n\n"
        "Команды:\n"
        "/review — начать новую проверку\n"
        "/help — примеры что можно проверить"
    )


@dp.message(Command("review"))
async def cmd_review(message: Message, state: FSMContext):
    await state.set_state(ReviewStates.waiting_type)
    await message.answer(
        "Что хочешь проверить?",
        reply_markup=type_keyboard()
    )


@dp.callback_query(F.data.startswith("type:"), ReviewStates.waiting_type)
async def handle_type(callback: CallbackQuery, state: FSMContext):
    review_type = callback.data.split(":")[1]
    await state.update_data(review_type=review_type)
    await state.set_state(ReviewStates.waiting_text)
    
    if review_type == "custom":
        await callback.message.edit_text(
            "Сначала пришли системный промпт (инструкцию для ревьюера), "
            "потом сам текст через разделитель ---"
        )
    else:
        type_label = REVIEW_TYPES[review_type][0]
        await callback.message.edit_text(
            f"Отлично! Пришли {type_label.lower()} для анализа.\n\n"
            "Можно текстом или файлом (.txt, .md)"
        )
    await callback.answer()


@dp.message(ReviewStates.waiting_text, F.text)
async def handle_text(message: Message, state: FSMContext):
    data = await state.get_data()
    review_type = data.get("review_type", "post")
    
    text = message.text
    if len(text) < 50:
        await message.answer("Текст слишком короткий. Пришли полный текст.")
        return
    
    await state.clear()
    status = await message.answer("Анализирую... ⏳")
    
    try:
        result = await review(text, review_type)
        await status.delete()
        
        # Длинный ответ — разбить на части
        if len(result) > 4000:
            parts = [result[i:i+4000] for i in range(0, len(result), 4000)]
            for part in parts:
                await message.answer(part)
        else:
            await message.answer(result)
        
        # Предложить новую проверку
        await message.answer(
            "Хочешь ещё что-то проверить?",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="🔄 Новая проверка", callback_data="new_review")
            ]])
        )
    
    except Exception as e:
        await status.edit_text(f"Ошибка: {e}")


@dp.message(ReviewStates.waiting_text, F.document)
async def handle_document(message: Message, state: FSMContext):
    """Принять файл .txt или .md"""
    doc = message.document
    
    if not doc.file_name.endswith((".txt", ".md")):
        await message.answer("Поддерживаю только .txt и .md файлы.")
        return
    
    if doc.file_size > 50_000:  # 50KB лимит
        await message.answer("Файл слишком большой. Максимум 50 KB.")
        return
    
    file = await bot.get_file(doc.file_id)
    file_bytes = await bot.download_file(file.file_path)
    text = file_bytes.read().decode("utf-8", errors="replace")
    
    # Эмулировать текстовое сообщение
    message.text = text
    await handle_text(message, state)


@dp.callback_query(F.data == "new_review")
async def new_review(callback: CallbackQuery, state: FSMContext):
    await state.set_state(ReviewStates.waiting_type)
    await callback.message.edit_text("Что проверяем?", reply_markup=type_keyboard())
    await callback.answer()


# Позволить начать отправкой текста без /review
@dp.message(F.text & ~F.text.startswith("/"))
async def handle_direct_text(message: Message, state: FSMContext):
    current_state = await state.get_state()
    if current_state:
        return  # уже в процессе — пусть FSM обрабатывает
    
    # Пришёл текст без команды — предложить выбрать тип
    await state.update_data(pending_text=message.text)
    await state.set_state(ReviewStates.waiting_type)
    await message.answer(
        "Хочешь чтобы я проверил этот текст?\nВыбери тип:",
        reply_markup=type_keyboard()
    )


async def main():
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
ANTHROPIC_API_KEY=your_key
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install aiogram anthropic python-dotenv
mkdir prompts  # создать папку и добавить файлы промптов
python bot.py
```

## Добавить свой тип ревью

1. Создай файл `prompts/mytype.txt` с инструкцией для Claude
2. Добавь в `reviewer.py`:
```python
REVIEW_TYPES = {
    ...
    "mytype": ("🎯 Мой тип", "mytype.txt"),
}
```
3. Перезапусти бота

---

::: tip Улучшения
Добавь `/history` для просмотра прошлых проверок (SQLite). Или интеграцию с Google Docs — пришли ссылку, бот скачает и проверит. Промпты можно редактировать без перезапуска — они читаются при каждом запросе.
:::
