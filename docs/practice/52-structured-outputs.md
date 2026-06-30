# Структурированные ответы AI

Когда AI отвечает JSON — парсинг превращается в надёжную операцию, не в гадание. Разбираем паттерны для надёжного получения структурированных данных.

## Проблема

```python
# Ненадёжно: AI иногда добавляет ```json\n, иногда текст до JSON, иногда комментарии
response = "Вот результат анализа:\n```json\n{\"sentiment\": \"positive\"}\n```"
# json.loads(response) — упадёт
```

## Решение 1: Принудить через промпт

```python
async def get_sentiment(text: str) -> dict:
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        messages=[{
            "role": "user",
            "content": f"""Проанализируй тональность текста.
Верни ТОЛЬКО валидный JSON без markdown-обёртки, комментариев и пояснений:
{{"sentiment": "positive|negative|neutral", "confidence": 0.0-1.0, "reason": "одно предложение"}}

Текст: {text}

JSON:"""
        }]
    )
    
    return json.loads(response.content[0].text.strip())
```

Последнее слово `JSON:` (или `{`) заставляет модель начать именно с JSON.

## Решение 2: Pydantic + валидация с ретраями

```python
from pydantic import BaseModel, ValidationError
import json
import re


class SentimentResult(BaseModel):
    sentiment: str  # positive | negative | neutral
    confidence: float
    reason: str
    
    def model_post_init(self, __context):
        if self.sentiment not in ("positive", "negative", "neutral"):
            raise ValueError("Invalid sentiment value")
        if not 0 <= self.confidence <= 1:
            raise ValueError("Confidence must be 0-1")


def extract_json(text: str) -> str:
    """Вытащить JSON из текста с возможной разметкой."""
    # Убрать markdown-блок
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if match:
        return match.group(1)
    # Найти JSON-объект
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        return match.group(0)
    return text.strip()


async def get_structured_response(
    prompt: str,
    model_class: type[BaseModel],
    max_retries: int = 3
) -> BaseModel:
    """Получить структурированный ответ с автоматическим ретраем при ошибке."""
    
    for attempt in range(max_retries):
        response = await claude.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": prompt + "\n\nВерни ТОЛЬКО JSON, без markdown."
            }]
        )
        
        text = response.content[0].text
        
        try:
            json_str = extract_json(text)
            data = json.loads(json_str)
            return model_class(**data)
        except (json.JSONDecodeError, ValidationError) as e:
            if attempt == max_retries - 1:
                raise ValueError(f"Failed after {max_retries} attempts: {e}")
            # Добавить ошибку в следующий промпт
            prompt += f"\n\nПредыдущий ответ был неверным: {e}. Исправь."
    
    raise ValueError("Max retries exceeded")


# Использование
class ExtractedEntities(BaseModel):
    persons: list[str]
    organizations: list[str]
    locations: list[str]
    dates: list[str]

result = await get_structured_response(
    f"Извлеки именованные сущности из текста:\n{text}\n\n"
    f"Формат: {{\"persons\":[],\"organizations\":[],\"locations\":[],\"dates\":[]}}",
    ExtractedEntities
)
```

## Решение 3: Tool Use (самый надёжный)

Claude Tool Use (function calling) гарантирует структуру — модель обязана вызвать инструмент с правильными параметрами:

```python
tools = [
    {
        "name": "classify_text",
        "description": "Классифицировать текст по категориям",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["spam", "news", "personal", "business", "other"],
                    "description": "Категория текста"
                },
                "confidence": {
                    "type": "number",
                    "description": "Уверенность 0-1"
                },
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Ключевые слова (максимум 5)"
                }
            },
            "required": ["category", "confidence", "keywords"]
        }
    }
]


async def classify_with_tool_use(text: str) -> dict:
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        tools=tools,
        tool_choice={"type": "tool", "name": "classify_text"},  # принудить использовать инструмент
        messages=[{
            "role": "user",
            "content": f"Классифицируй этот текст: {text}"
        }]
    )
    
    # Результат всегда в tool_use блоке
    for block in response.content:
        if block.type == "tool_use":
            return block.input  # уже dict, не нужен json.loads
    
    raise ValueError("No tool use in response")
```

## Паттерны для реальных задач

### Извлечение данных из письма/сообщения

```python
class EmailIntent(BaseModel):
    intent: str      # inquiry | complaint | request | other
    urgency: str     # high | medium | low
    topic: str
    action_needed: str
    customer_name: str | None = None


EXTRACT_PROMPT = """Проанализируй обращение клиента и верни JSON:
{{
  "intent": "inquiry|complaint|request|other",
  "urgency": "high|medium|low",
  "topic": "краткая тема (5-10 слов)",
  "action_needed": "что нужно сделать (1 предложение)",
  "customer_name": "имя клиента или null"
}}

Обращение: {text}

JSON:"""


async def analyze_customer_message(text: str) -> EmailIntent:
    return await get_structured_response(
        EXTRACT_PROMPT.format(text=text),
        EmailIntent
    )
```

### Генерация контента в структуре

```python
class ContentPlan(BaseModel):
    posts: list[dict]  # [{"day": int, "hook": str, "body": str, "cta": str}]


async def generate_content_plan(topic: str, days: int = 7) -> ContentPlan:
    tools = [{
        "name": "create_content_plan",
        "description": "Создать контент-план",
        "input_schema": {
            "type": "object",
            "properties": {
                "posts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "day": {"type": "integer"},
                            "hook": {"type": "string", "description": "Цепляющий заголовок"},
                            "body": {"type": "string", "description": "Текст поста (100-200 слов)"},
                            "cta": {"type": "string", "description": "Призыв к действию"}
                        },
                        "required": ["day", "hook", "body", "cta"]
                    }
                }
            },
            "required": ["posts"]
        }
    }]
    
    response = await claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        tools=tools,
        tool_choice={"type": "tool", "name": "create_content_plan"},
        messages=[{
            "role": "user",
            "content": f"Создай контент-план на {days} дней по теме: {topic}"
        }]
    )
    
    for block in response.content:
        if block.type == "tool_use":
            return ContentPlan(**block.input)
    
    raise ValueError("No tool use")
```

### Валидация бизнес-правил

```python
from pydantic import BaseModel, field_validator


class OrderData(BaseModel):
    product_name: str
    quantity: int
    price: float
    customer_email: str
    
    @field_validator("quantity")
    @classmethod
    def quantity_positive(cls, v):
        if v <= 0:
            raise ValueError("Количество должно быть > 0")
        return v
    
    @field_validator("customer_email")
    @classmethod
    def valid_email(cls, v):
        if "@" not in v:
            raise ValueError("Некорректный email")
        return v


async def extract_order_from_message(message: str) -> OrderData:
    """Извлечь заказ из неструктурированного сообщения."""
    return await get_structured_response(
        f"""Извлеки данные заказа из сообщения клиента.
JSON: {{"product_name":"", "quantity":1, "price":0.0, "customer_email":""}}

Сообщение: {message}""",
        OrderData
    )
```

## Таблица выбора подхода

| Подход | Надёжность | Сложность | Когда |
|---|---|---|---|
| Промпт + `JSON:` суффикс | 85% | Минимальная | Прототипы, просто |
| Промпт + extract_json + retry | 95% | Низкая | Большинство задач |
| Pydantic + retry с ошибкой | 97% | Средняя | Критичные данные |
| Tool Use | 99%+ | Средняя | Продакшн, строгая схема |

---

::: tip Промпт-хак
Заканчивай промпт на `\nJSON:` или `\n{` — это заставляет Claude начать ответ с JSON. Добавь `temperature=0` для максимальной предсказуемости при структурированном выводе.
:::
