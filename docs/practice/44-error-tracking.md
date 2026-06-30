# Отслеживание ошибок: Sentry и алтернативы

Когда бот живёт на сервере без тебя — ошибки происходят молча. Пользователи страдают, ты не знаешь. Трекер ошибок собирает все исключения, контекст и уведомляет тебя.

## Самый простой вариант: уведомления в Telegram

Не всегда нужен внешний сервис. Для небольших проектов — сообщение в личку или admin-чат:

```python
import traceback
import asyncio
import os

ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

async def notify_error(bot, error: Exception, context: str = ""):
    """Уведомить админа об ошибке"""
    if not ADMIN_ID:
        return
    
    text = (
        f"⚠️ **Ошибка в боте**\n\n"
        f"Тип: `{type(error).__name__}`\n"
        f"Сообщение: `{str(error)[:200]}`\n"
    )
    if context:
        text += f"Контекст: {context[:300]}\n"
    
    tb = traceback.format_exc()
    if tb and tb != "NoneType: None\n":
        text += f"\n```\n{tb[-800:]}\n```"
    
    try:
        await bot.send_message(ADMIN_ID, text, parse_mode="Markdown")
    except Exception:
        pass  # не ломать обработчик ошибок при отправке ошибки


# В middleware:
from aiogram import BaseMiddleware
from aiogram.types import TelegramObject

class ErrorMiddleware(BaseMiddleware):
    def __init__(self, bot):
        self.bot = bot
    
    async def __call__(self, handler, event: TelegramObject, data: dict):
        try:
            return await handler(event, data)
        except Exception as e:
            user = data.get("event_from_user")
            context = f"User: {user.id if user else '?'}"
            await notify_error(self.bot, e, context)
            
            # Ответить пользователю
            if hasattr(event, 'answer'):
                await event.answer("Произошла ошибка. Уже работаю над этим.")
            
            raise  # пробросить дальше для логирования
```

## Sentry: профессиональный трекер

Sentry собирает ошибки, группирует повторяющиеся, показывает стектрейс, переменные в момент ошибки, историю действий пользователя.

Бесплатен до 5000 ошибок/месяц.

```bash
pip install sentry-sdk
```

> 💬 «Установи Sentry SDK для отслеживания ошибок»

```python
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    traces_sample_rate=0.1,  # 10% транзакций для performance
    environment=os.getenv("ENV", "production"),
    
    # Интеграция с logging — автоматически захватывает WARNING+
    integrations=[
        LoggingIntegration(level=None, event_level=logging.ERROR)
    ]
)
```

### Добавить контекст пользователя

```python
import sentry_sdk

async def set_sentry_user(user_id: int, username: str = None):
    """Установить пользователя для текущего события Sentry"""
    sentry_sdk.set_user({
        "id": user_id,
        "username": username or str(user_id),
    })

# В хэндлере:
@dp.message(Command("start"))
async def cmd_start(message: Message):
    await set_sentry_user(message.from_user.id, message.from_user.username)
    # ... дальнейший код
```

### Ручная отправка событий

```python
# Ошибка с контекстом
try:
    result = await risky_operation()
except Exception as e:
    sentry_sdk.capture_exception(e)
    sentry_sdk.set_context("operation", {"input": data, "step": "parsing"})
    await message.answer("Что-то пошло не так")

# Предупреждение (не ошибка)
sentry_sdk.capture_message(
    f"Пользователь {user_id} исчерпал лимит запросов",
    level="warning"
)
```

### Интеграция с aiogram

```python
@dp.errors()
async def error_handler(event, exception):
    """Глобальный обработчик ошибок aiogram"""
    sentry_sdk.capture_exception(exception)
    return True  # ошибка обработана
```

## Glitchtip: self-hosted альтернатива

Если не хочешь платить или отправлять данные на серверы Sentry — Glitchtip совместим с Sentry SDK:

```bash
# docker-compose.yml
services:
  glitchtip:
    image: glitchtip/glitchtip:latest
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://user:pass@db/glitchtip
      SECRET_KEY: your-secret-key
```

> 💬 «Создай docker-compose.yml для запуска Glitchtip — self-hosted аналога Sentry — на порту 8000»

В SDK меняешь только DSN:
```python
sentry_sdk.init(dsn="http://key@your-server:8000/1")
```

## Логирование в файл + ротация

Базовый вариант без внешних сервисов:

```python
import logging
from logging.handlers import RotatingFileHandler

def setup_logging():
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    # Консоль
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    
    # Файл с ротацией (10 файлов по 5MB)
    file_handler = RotatingFileHandler(
        "app.log",
        maxBytes=5 * 1024 * 1024,  # 5MB
        backupCount=10,
        encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    for h in [console, file_handler]:
        h.setFormatter(logging.Formatter(fmt))
        logger.addHandler(h)

setup_logging()
logger = logging.getLogger(__name__)

# Использование
logger.info(f"Пользователь {user_id} запустил бота")
logger.warning(f"Превышен лимит запросов для {user_id}")
logger.error(f"Ошибка при обработке платежа", exc_info=True)  # exc_info=True добавит стектрейс
```

## Алерты при критических ошибках

Паттерн «раз в час» — не спамить при каждой ошибке:

```python
import time
from collections import defaultdict

error_counts: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0))
ALERT_THRESHOLD = 3  # 3 ошибки одного типа за WINDOW
WINDOW = 3600  # секунд

async def smart_alert(bot, error_type: str, error_msg: str):
    """Алерт только при повторяющихся ошибках"""
    count, window_start = error_counts[error_type]
    now = time.time()
    
    if now - window_start > WINDOW:
        # Сбросить счётчик
        count = 0
        window_start = now
    
    count += 1
    error_counts[error_type] = (count, window_start)
    
    if count == ALERT_THRESHOLD:
        await bot.send_message(
            ADMIN_ID,
            f"🚨 Повторяющаяся ошибка: {error_type}\n{error_msg}\n\n"
            f"Встретилась {count} раз за последний час."
        )
```

## Структурированное логирование

Для удобного поиска — логируй JSON:

```python
import json
import logging
from datetime import datetime

class JsonFormatter(logging.Formatter):
    def format(self, record):
        data = {
            "time": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "module": record.module,
            "message": record.getMessage(),
        }
        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)

# Добавить к обработчику
json_handler = logging.StreamHandler()
json_handler.setFormatter(JsonFormatter())
```

Такие логи удобно парсить через `grep`, `jq`, или отправлять в Loki/ELK.

---

::: info Приоритеты
1. Уведомления в Telegram (5 минут настройки) — обязательно
2. Ротация лог-файла — обязательно
3. Sentry — когда проект приносит деньги и нужна детальная аналитика ошибок
:::
