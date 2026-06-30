# Архитектура: как не наломать дров

Когда проект вырастает за пределы «скрипт в одном файле», возникают вопросы: как разбить код? когда выносить в отдельный сервис? как не написать монолит который сложно менять?

Здесь нет одного правильного ответа — но есть хорошие принципы.

## Монолит vs микросервисы

**Монолит** — всё в одном приложении: и бот, и API, и задачи, и база.

**Микросервисы** — каждая часть отдельный сервис с отдельной базой, общаются по API или очередям.

**Для вайб-кодера: почти всегда монолит.**

Причины:
- Легче разрабатывать, деплоить, отлаживать
- Меньше инфраструктуры (один сервер, одна БД)
- Проще думать о консистентности данных

Микросервисы нужны когда: разные части требуют разных языков, масштабируются независимо, или разрабатываются разными командами. Для соло-проектов это overhead без выгоды.

## Разделение кода внутри монолита

Хороший монолит — не «всё в одном файле». Разделяй по ответственности:

```
my_project/
├── bot/
│   ├── handlers/          # хэндлеры aiogram: отдельный файл на раздел
│   │   ├── start.py
│   │   ├── catalog.py
│   │   └── payment.py
│   ├── keyboards.py       # клавиатуры
│   └── middlewares.py     # middleware aiogram
├── services/              # бизнес-логика (не знает про Telegram)
│   ├── user_service.py    # работа с пользователями
│   ├── payment_service.py # обработка платежей
│   └── email_service.py   # отправка email
├── db/
│   ├── models.py          # SQLAlchemy модели или схема SQLite
│   └── queries.py         # запросы
├── api/                   # FastAPI (если нужен HTTP API)
│   └── routes.py
├── tasks/                 # фоновые задачи (Celery или asyncio)
│   └── notifications.py
├── config.py              # все настройки из .env
└── main.py                # точка входа
```

Правило: **handlers** не должны содержать бизнес-логику. Хэндлер принимает запрос → вызывает сервис → возвращает ответ. Если хэндлер больше 20 строк — что-то не так.

## Принцип единственной ответственности

Каждый модуль делает одну вещь:

```python
# Плохо: handler делает всё сам
@dp.message(Command("buy"))
async def cmd_buy(message: Message):
    # 50 строк: валидация, работа с БД, оплата, email, Telegram
    user = db.execute("SELECT ...")
    if not user:
        db.execute("INSERT INTO users ...")
    invoice = stripe.create_invoice(...)
    db.execute("INSERT INTO orders ...")
    send_email(user.email, ...)
    await message.answer("Заказ оформлен!")

# Хорошо: handler делегирует
@dp.message(Command("buy"))
async def cmd_buy(message: Message):
    result = await order_service.create(user_id=message.from_user.id)
    await message.answer(result.confirmation_message)
```

## Когда выносить в отдельный сервис

Признаки что пора:
- Задача блокирует event loop бота (тяжёлые вычисления, долгие I/O)
- Нужны разные masштабы (бот легко справляется, API перегружен)
- Команда растёт и две части кодабазы постоянно конфликтуют

Простое решение: очередь задач (Celery/Redis) вместо нового сервиса. Бот кладёт задачу → воркер делает в фоне → уведомляет результат.

## Конфигурация

Один модуль `config.py` для всех настроек:

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    bot_token: str
    db_path: str = "app.db"
    anthropic_api_key: str = ""
    admin_id: int = 0
    debug: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
```

Теперь `from config import settings` вместо `os.getenv(...)` везде. Валидируется при старте — ошибка сразу, не в рантайме.

## Обработка ошибок

Плохо: ошибки падают молча.

Хорошо: единая точка обработки:

```python
# bot/middlewares.py
from aiogram import BaseMiddleware
from aiogram.types import Update
import logging

logger = logging.getLogger(__name__)

class ErrorMiddleware(BaseMiddleware):
    async def __call__(self, handler, event: Update, data: dict):
        try:
            return await handler(event, data)
        except Exception as e:
            logger.error(f"Unhandled error: {e}", exc_info=True)
            # Уведомить пользователя
            if event.message:
                await event.message.answer(
                    "Что-то пошло не так. Попробуй позже или напиши /start"
                )
            # Уведомить админа
            from config import settings
            if settings.admin_id:
                await event.message.bot.send_message(
                    settings.admin_id,
                    f"⚠️ Ошибка: {e}\nUser: {event.message.from_user.id}"
                )
```

## Логирование

```python
import logging
import sys

def setup_logging(debug: bool = False):
    level = logging.DEBUG if debug else logging.INFO
    
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler("app.log", encoding="utf-8"),
        ]
    )
    
    # Приглушить слишком шумные библиотеки
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("aiogram").setLevel(logging.WARNING)
```

Что логировать: действия пользователей (покупка, регистрация), ошибки (всегда), и ничего лишнего (не каждое сообщение).

## Принцип «сделай проще сначала»

Часто вижу такую ошибку: начинают с «правильной архитектуры» — микросервисы, очереди, event sourcing — и тратят недели на инфраструктуру вместо продукта.

**Правило:** сделай работающее, потом улучшай архитектуру при необходимости.

Хороший порядок:
1. Один файл — работает, но грязно
2. Разбил на модули по ответственности
3. Добавил слой сервисов
4. Вынес тяжёлые задачи в очередь
5. Отдельные сервисы (только если реально нужно)

Большинство проектов останавливаются на шаге 2–3.

---

::: info Структура важнее паттернов
Чистая структура папок с понятными именами даёт 80% пользы «правильной архитектуры» без её сложности. Начни с этого.
:::
