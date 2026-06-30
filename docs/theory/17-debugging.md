# Отладка AI-продуктов

Дебаггинг AI-приложений отличается от обычного: ошибка может быть не в коде, а в промпте. Или в данных. Или в логике роутинга. Методичный подход экономит часы.

## Уровни где что-то может сломаться

```
Пользователь → бот/API → промпт → LLM → парсинг ответа → действие
```

Каждый уровень — отдельный класс ошибок:

| Уровень | Симптом | Инструмент |
|---|---|---|
| Сеть/API | Timeout, 502, 429 | логи, curl |
| Промпт | Неверный формат ответа | playground, print |
| Парсинг | `KeyError`, `JSONDecodeError` | print + try/except |
| Логика | «Бот сделал не то» | пошаговый trace |
| Данные | Устаревший контекст | проверить что в RAG |

## Первый шаг: изолировать слой

Никогда не отлаживай всё сразу. Пример:

```python
# Проблема: бот возвращает неверный JSON
# Шаг 1: запустить ТОЛЬКО запрос к LLM, напечатать сырой ответ

response = await claude.messages.create(
    model="claude-haiku-4-5-20251001",
    messages=[{"role": "user", "content": YOUR_PROMPT}]
)
print(repr(response.content[0].text))  # repr покажет \n и невидимые символы
```

Если ответ выглядит правильно — проблема в парсинге. Если нет — в промпте.

## Отладка промптов

### Playground первым делом

Сломанный промпт → вставь в claude.ai или console.anthropic.com. Там:
- Видишь сырой ответ без слоёв парсинга
- Можешь итерировать быстро без перезапуска бота
- Есть token counter (промпт слишком длинный?)

### Печатай что уходит в модель

```python
async def call_llm(system: str, user: str) -> str:
    if os.getenv("DEBUG_PROMPTS"):
        print("=== SYSTEM ===")
        print(system)
        print("=== USER ===")
        print(user)
        print("==============")
    
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        system=system,
        messages=[{"role": "user", "content": user}]
    )
    
    result = response.content[0].text
    
    if os.getenv("DEBUG_PROMPTS"):
        print("=== RESPONSE ===")
        print(result)
        print("================")
    
    return result
```

Запуск: `DEBUG_PROMPTS=1 python bot.py`

### Типичные ошибки в промптах

**Модель добавляет markdown-обёртку:**
```python
# Проблема: промпт просит JSON, модель отвечает ```json\n{...}\n```
import re

def extract_json(text: str) -> str:
    # Убрать markdown-блок
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if match:
        return match.group(1)
    # Попробовать найти JSON напрямую
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        return match.group(0)
    return text
```

**Модель игнорирует ограничения:**
Проверь расположение. Самые важные правила — в начале системного промпта и/или в конце пользовательского сообщения (не в середине длинного текста).

**Нестабильный вывод:**
Добавь `temperature=0` для детерминированных задач (классификация, JSON-вывод).

## Отладка Telegram-бота

### Включить подробный лог aiogram

```python
import logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(name)s %(levelname)s %(message)s'
)
# Заглушить шум от httpx/httpcore
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
```

### Проверить что получает бот

```python
@dp.message()
async def debug_all(message: Message):
    print(f"Type: {message.content_type}")
    print(f"Text: {message.text!r}")
    print(f"Chat: {message.chat.id} ({message.chat.type})")
    print(f"From: {message.from_user.id} @{message.from_user.username}")
```

Зарегистрировать ПОСЛЕ всех нормальных хендлеров — это «ловит» всё что не обработалось.

### Callback не срабатывает

Проблема: нажал кнопку — ничего не происходит.

Чек-лист:
1. `callback_data` совпадает с фильтром? `F.data == "exact_string"` или `.startswith("prefix:")`?
2. Хендлер зарегистрирован до `dp.start_polling`?
3. Бот отвечает на `callback.answer()` хотя бы пустым?

```python
@dp.callback_query()
async def debug_callbacks(callback: CallbackQuery):
    print(f"Callback data: {callback.data!r}")  # показать что пришло
    await callback.answer()
```

### FSM-состояние не меняется

```python
# Принудительно напечатать текущее состояние
@dp.message(Command("state"))
async def check_state(message: Message, state: FSMContext):
    current = await state.get_state()
    data = await state.get_data()
    await message.answer(f"State: {current}\nData: {data}")
```

## Отладка FastAPI

### Включить traceback в ответе (только dev!)

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import traceback

app = FastAPI()

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if os.getenv("ENV") == "development":
        return JSONResponse(
            status_code=500,
            content={"error": str(exc), "traceback": traceback.format_exc()}
        )
    return JSONResponse(status_code=500, content={"error": "Internal server error"})
```

### Логировать каждый запрос

```python
import time
import logging

logger = logging.getLogger(__name__)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    logger.info(f"{request.method} {request.url.path} → {response.status_code} ({duration:.2f}s)")
    return response
```

### Тестировать эндпоинты без фронтенда

```bash
# curl — всегда работает
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "привет"}'

# httpie — удобнее
pip install httpie
http POST localhost:8000/api/chat message="привет"
```

## Производительность: найти медленное место

```python
import time
import functools
import logging

logger = logging.getLogger(__name__)


def timed(label: str):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            start = time.perf_counter()
            result = await func(*args, **kwargs)
            elapsed = time.perf_counter() - start
            logger.info(f"[PERF] {label}: {elapsed:.3f}s")
            return result
        return wrapper
    return decorator


@timed("llm_call")
async def call_llm(prompt: str) -> str:
    ...

@timed("db_query")
async def get_user(user_id: int) -> dict:
    ...
```

Запусти несколько запросов и смотри на `[PERF]` в логах — сразу видно что тормозит.

## Дифференциальная диагностика: чек-лист

Когда «бот не работает»:

1. **Бот вообще запущен?** `systemctl status mybot` / `ps aux | grep bot.py`
2. **Получает ли обновления?** Добавь `print("got update")` в первый хендлер
3. **Токен верный?** `curl https://api.telegram.org/bot<TOKEN>/getMe`
4. **Ошибки в консоли?** `journalctl -u mybot -n 50 --no-pager`
5. **Конфликт нескольких инстансов?** `ps aux | grep python` — должен быть один
6. **LLM-запрос проходит?** Запустить изолированно: `python -c "import asyncio; asyncio.run(test_llm())"`
7. **Правильный .env?** `python -c "from dotenv import load_dotenv; load_dotenv(); import os; print(os.getenv('BOT_TOKEN')[:10])"`

## Промпт для отладки с Claude Code

```
Бот крашится с этой ошибкой:
<traceback>
TypeError: argument of type 'NoneType' is not iterable
  File "bot.py", line 47, in handle_message
    if user_text in KEYWORDS:
</traceback>

Вот хендлер:
<код>

Найди причину и исправь.
```

---

::: info Правило одной переменной
Отлаживая, меняй только одну вещь за раз. Изменил промпт и температуру одновременно — не знаешь что помогло. Изменил только промпт — точно знаешь.
:::
