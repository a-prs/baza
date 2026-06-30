# Структурированное логирование

Стандартный `logging.basicConfig` хорош для разработки. В продакшне нужнее структурированные логи: JSON-формат, контекст, трассируемость запросов. Разбираем `structlog` и паттерны для AI-продуктов.

## Почему structlog

```python
# Обычный лог — трудно парсить
logger.info(f"User {user_id} sent message '{text[:50]}' to bot")

# Structlog — машинночитаемый, фильтруемый
logger.info("message_received", user_id=user_id, text_length=len(text), bot_id=bot_id)
```

Результат в JSON:
```json
{"event": "message_received", "user_id": 123, "text_length": 42, "bot_id": "mybot", "timestamp": "2024-01-15T10:30:00Z", "level": "info"}
```

Можно искать по `user_id=123`, считать `event=llm_call` за 24ч, видеть цепочку событий одного запроса.

## Установка

```bash
pip install structlog
```

## Базовая настройка

```python
import structlog
import logging
import sys


def configure_logging(debug: bool = False, json: bool = True):
    """Настроить structlog для продакшна или разработки."""
    
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.stdlib.add_logger_name,
    ]
    
    if json:
        # Продакшн: JSON-формат
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Разработка: читаемый цветной формат
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]
    
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.DEBUG if debug else logging.INFO
        ),
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        cache_logger_on_first_use=True,
    )


# Вызвать при старте
import os
configure_logging(
    debug=os.getenv("DEBUG", "false").lower() == "true",
    json=os.getenv("ENV", "development") == "production"
)

logger = structlog.get_logger()
```

## Контекстные переменные

Привязать контекст (user_id, request_id) к потоку:

```python
from structlog.contextvars import bind_contextvars, clear_contextvars
import uuid


# Middleware для FastAPI
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
        
        # Привязать к текущему контексту async-таски
        bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )
        
        logger.info("request_started")
        
        import time
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start
        
        logger.info("request_completed", 
                    status=response.status_code,
                    duration_ms=round(duration * 1000, 2))
        
        clear_contextvars()
        return response
```

## Логирование AI-вызовов

```python
import structlog
import time
import functools

logger = structlog.get_logger()


def log_llm_call(func):
    """Декоратор для логирования вызовов LLM."""
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        start = time.perf_counter()
        
        # Извлечь prompt из аргументов
        messages = kwargs.get("messages", [])
        prompt_len = sum(len(m.get("content", "")) for m in messages)
        model = kwargs.get("model", "unknown")
        
        try:
            result = await func(*args, **kwargs)
            duration = time.perf_counter() - start
            
            # Извлечь токены из ответа
            usage = getattr(result, "usage", None)
            
            logger.info(
                "llm_call_completed",
                model=model,
                duration_ms=round(duration * 1000, 2),
                prompt_tokens=usage.input_tokens if usage else None,
                completion_tokens=usage.output_tokens if usage else None,
                prompt_length=prompt_len,
            )
            
            return result
        
        except Exception as e:
            duration = time.perf_counter() - start
            logger.error(
                "llm_call_failed",
                model=model,
                duration_ms=round(duration * 1000, 2),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise
    
    return wrapper


# Использование
from anthropic import AsyncAnthropic

claude = AsyncAnthropic()

@log_llm_call
async def call_claude(**kwargs):
    return await claude.messages.create(**kwargs)
```

## Логирование в Telegram-боте

```python
from aiogram import BaseMiddleware
from aiogram.types import Message, Update
import structlog
from structlog.contextvars import bind_contextvars, clear_contextvars

logger = structlog.get_logger()


class LoggingMiddleware(BaseMiddleware):
    async def __call__(self, handler, event: Update, data: dict):
        message = event.message or event.callback_query
        
        if message:
            user = (message.from_user if hasattr(message, "from_user") else None)
            
            bind_contextvars(
                user_id=user.id if user else None,
                username=user.username if user else None,
                update_type=event.event_type,
            )
        
        try:
            result = await handler(event, data)
            return result
        except Exception as e:
            logger.error(
                "handler_error",
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            raise
        finally:
            clear_contextvars()


# Регистрация
dp.update.outer_middleware(LoggingMiddleware())
```

## Метрики через логи

```python
# Структурированные события = автоматические метрики
# Настрой парсинг в Grafana/Loki или просто grep по JSON

# Примеры событий для метрик:
logger.info("user_registered", source="telegram", referred=bool(ref_code))
logger.info("subscription_activated", plan="monthly", stars=200, user_id=user_id)
logger.info("message_processed", message_type="text", user_premium=is_premium)
logger.error("payment_failed", error_code="insufficient_funds", user_id=user_id)

# Потом: cat app.log | jq 'select(.event=="subscription_activated")' | wc -l
# Или: grep '"subscription_activated"' app.log | wc -l
```

## Ротация файлов логов

```python
import logging
from logging.handlers import RotatingFileHandler


def setup_file_logging(log_file: str = "app.log", max_mb: int = 50, backups: int = 5):
    """Добавить ротацию файлов к structlog."""
    handler = RotatingFileHandler(
        log_file,
        maxBytes=max_mb * 1024 * 1024,
        backupCount=backups,
        encoding="utf-8"
    )
    handler.setLevel(logging.INFO)
    
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)
```

## systemd: просмотр логов в продакшне

```bash
# Просмотр логов systemd-сервиса
journalctl -u mybot -f                    # live поток
journalctl -u mybot -n 100                # последние 100 строк
journalctl -u mybot --since "1 hour ago" # последний час

# Поиск в JSON-логах
journalctl -u mybot -o json-pretty | jq 'select(.event=="llm_call_failed")'

# Если пишешь в файл:
tail -f /var/log/mybot/app.log | jq .
grep '"level":"error"' /var/log/mybot/app.log | jq .
```

## Тихие ошибки: не потеряй их

```python
# Частая проблема: ошибка в background-задаче не попадает в логи
async def background_task():
    try:
        await do_something()
    except Exception as e:
        logger.error("background_task_failed", error=str(e), exc_info=True)
        # Не перебрасывать если задача не критична
        # Но всегда логировать!


# APScheduler: настроить логирование ошибок
from apscheduler.events import EVENT_JOB_ERROR

def job_error_listener(event):
    logger.error(
        "scheduler_job_failed",
        job_id=event.job_id,
        error=str(event.exception),
        exc_info=event.traceback
    )

scheduler.add_listener(job_error_listener, EVENT_JOB_ERROR)
```

---

::: tip Минимальный уровень
Если structlog кажется сложным — минимум для продакшна: добавить `exc_info=True` к каждому `logger.error()`, настроить ротацию файлов (`RotatingFileHandler`), и добавить timestamp в формат. Это уже в разы лучше дефолтного `basicConfig`.
:::
