# LLM API: добавь ИИ в своё приложение

Хочешь чтобы твоё приложение умело отвечать на вопросы, суммаризировать тексты, генерировать контент или анализировать данные — подключаешь LLM API. Разберём как это делается на практике.

## Выбор модели

| Задача | Модель | Почему |
|--------|--------|--------|
| Суммаризация, классификация | Claude Haiku, GPT-4o mini | Быстро, дёшево |
| Сложный анализ, код | Claude Sonnet, GPT-4o | Баланс цены/качества |
| Самые сложные задачи | Claude Opus, GPT-4 | Максимум качества |
| Локально, бесплатно | Ollama + Llama 3 / Qwen | Нет API-трат |

**Правило:** начинай с дешёвой модели, переключай на дорогую только если качество не устраивает.

## Claude API (Anthropic)

```bash
pip install anthropic
```

```python
import anthropic
import os

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Простой запрос
response = client.messages.create(
    model="claude-haiku-4-5-20251001",  # дешёвая, быстрая
    max_tokens=1024,
    messages=[{"role": "user", "content": "Суммаризируй текст: ..."}]
)

print(response.content[0].text)

# С системным промптом
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=2048,
    system="Ты — помощник который отвечает только по-русски, кратко и по делу.",
    messages=[
        {"role": "user", "content": "Объясни что такое Docker"}
    ]
)
```

## OpenAI API

```bash
pip install openai
```

```python
from openai import OpenAI
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

response = client.chat.completions.create(
    model="gpt-4o-mini",  # дешёвый вариант
    messages=[
        {"role": "system", "content": "Отвечай по-русски, кратко."},
        {"role": "user", "content": "Что такое Redis?"}
    ],
    max_tokens=512,
    temperature=0.7,
)

print(response.choices[0].message.content)
```

## Практические паттерны

### Суммаризация текста

```python
def summarize(text: str, max_sentences: int = 3) -> str:
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": f"Суммаризируй следующий текст в {max_sentences} предложения на русском:\n\n{text}"
        }]
    )
    return response.content[0].text

# Использование
article = "... длинная статья ..."
summary = summarize(article, max_sentences=2)
```

### Классификация

```python
def classify_sentiment(text: str) -> str:
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        messages=[{
            "role": "user",
            "content": f"Определи тональность текста. Ответь одним словом: позитивная, негативная или нейтральная.\n\nТекст: {text}"
        }]
    )
    return response.content[0].text.strip().lower()

# Использование в боте:
sentiment = classify_sentiment(user_message)
if "негативная" in sentiment:
    await message.answer("Вижу что что-то идёт не так. Расскажи подробнее?")
```

### Структурированный вывод (JSON)

```python
import json

def extract_data(text: str) -> dict:
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": f"""Извлеки данные из текста и верни JSON.
            
Формат:
{{
  "name": "имя или null",
  "phone": "телефон или null",
  "email": "email или null",
  "request": "суть запроса"
}}

Текст: {text}

Верни ТОЛЬКО JSON, без пояснений."""
        }]
    )
    
    try:
        return json.loads(response.content[0].text)
    except json.JSONDecodeError:
        return {}

# Использование:
user_text = "Меня зовут Андрей, +79991234567, нужна автоматизация продаж"
data = extract_data(user_text)
# {"name": "Андрей", "phone": "+79991234567", "email": null, "request": "автоматизация продаж"}
```

### Диалог с историей

```python
from typing import List

def chat(messages: List[dict], system: str = "") -> str:
    """messages — список {"role": "user"/"assistant", "content": "..."}"""
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=messages
    )
    return response.content[0].text

# Держим историю в памяти (или в Redis)
conversation = []

def add_message(role: str, content: str):
    conversation.append({"role": role, "content": content})
    # Обрезаем до последних 20 сообщений чтобы не превысить контекст
    if len(conversation) > 20:
        conversation.pop(0)

# Пример диалога:
add_message("user", "Что такое векторная база данных?")
reply = chat(conversation, system="Объясняй просто, для начинающих.")
add_message("assistant", reply)

add_message("user", "Приведи пример когда она нужна")
reply = chat(conversation, system="Объясняй просто, для начинающих.")
```

### Стриминг (ответ по словам)

```python
import sys

with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Напиши поэму о Python"}]
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

В боте стриминг менее полезен — лучше редактировать сообщение частями через `edit_text`.

## Контроль расходов

```python
# После каждого запроса логируй использование токенов
response = client.messages.create(...)

tokens_in = response.usage.input_tokens
tokens_out = response.usage.output_tokens

# Цены Claude Haiku (приблизительно):
# Input: $0.25 / 1M токенов
# Output: $1.25 / 1M токенов
cost_usd = (tokens_in * 0.25 + tokens_out * 1.25) / 1_000_000

print(f"Запрос: {tokens_in}in / {tokens_out}out — ${cost_usd:.6f}")
```

## Ollama: бесплатно и локально

Ollama запускает модели на твоём сервере. Нет платы за токены, данные не покидают сервер.

```bash
# Установка (Ubuntu)
curl https://ollama.ai/install.sh | sh

# Скачать модель
ollama pull qwen2.5:7b   # 4.4GB — хорошее качество
ollama pull llama3.2:3b  # 2GB — быстрее

# Запустить
ollama serve
```

Совместим с OpenAI API:

```python
from openai import OpenAI

# Указываем локальный сервер
client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")

response = client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[{"role": "user", "content": "Привет!"}]
)
```

Переключение между провайдерами — только изменить `base_url` и `api_key`.

## Промпт-инжиниринг: советы

**Будь конкретен в форматах:**
```
Плохо:  «Проанализируй отзыв»
Хорошо: «Определи: 1) тональность (позитивная/негативная/нейтральная), 2) главную жалобу если есть, 3) оценку от 1 до 5. Верни JSON.»
```

**Давай примеры:**
```
Пример входа: «Доставка была медленной, но сам товар понравился»
Пример выхода: {"sentiment": "нейтральная", "issue": "медленная доставка", "score": 3}
```

**Ограничивай длину ответа:**
```
«Ответь не более чем в 2 предложениях.»
«Верни только JSON, без пояснений.»
```

---

::: info Что дальше?
LLM API подключено — добавь его в [Telegram-бота](/practice/11-telegram-bot) или [FastAPI](/practice/24-fastapi). Для автоматизаций без кода — [n8n с AI-нодой](/solutions/n8n-ai-digest).
:::
