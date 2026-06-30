# Redis: быстрое хранилище и кэш

Redis — база данных в памяти. Работает на порядок быстрее PostgreSQL или SQLite для простых операций: кэширование ответов, счётчики, очереди, сессии, рейт-лимиты.

## Когда нужен Redis

- Кэшировать дорогие запросы к API (не платить за каждый)
- Хранить сессии пользователей
- Счётчики (лайки, просмотры, количество попыток)
- Rate limiting (не более N запросов в минуту)
- Очередь задач для Celery или aiogram FSM
- Pub/Sub между сервисами

## Установка

```bash
# Ubuntu/Debian
apt install redis-server -y
systemctl start redis
systemctl enable redis

# Проверить
redis-cli ping  # → PONG

# Или через Docker
docker run -d --name redis -p 6379:6379 redis:alpine
```

Python-клиент:

```bash
pip install redis
```

## Основные операции

```python
import redis

r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)

# Строки
r.set("name", "Андрей")
r.get("name")          # "Андрей"

# С TTL (время жизни в секундах)
r.set("session", "abc123", ex=3600)  # истекает через 1 час
r.ttl("session")       # секунд осталось

# Проверить существование
r.exists("name")       # 1 или 0

# Удалить
r.delete("name")

# Атомарный счётчик
r.set("views", 0)
r.incr("views")        # 1
r.incr("views")        # 2
r.incrby("views", 10)  # 12

# Список (очередь)
r.rpush("queue", "task1")
r.rpush("queue", "task2")
r.lpop("queue")        # "task1"
r.llen("queue")        # 1

# Хэш (как словарь)
r.hset("user:42", mapping={"name": "Андрей", "email": "a@b.com"})
r.hget("user:42", "name")      # "Андрей"
r.hgetall("user:42")           # {"name": "Андрей", "email": "a@b.com"}

# Множество (уникальные значения)
r.sadd("online_users", 42, 43, 44)
r.sismember("online_users", 42)  # True
r.smembers("online_users")       # {42, 43, 44}
```

## Паттерн: кэш API-ответов

Не дёргаем API каждый раз — кэшируем на N минут:

```python
import redis
import requests
import json

r = redis.Redis(host="localhost", port=6379, decode_responses=True)

def get_weather(city: str) -> dict:
    cache_key = f"weather:{city}"
    
    # Проверяем кэш
    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # Кэша нет — запрашиваем API
    response = requests.get(
        "https://api.openweathermap.org/data/2.5/weather",
        params={"q": city, "appid": "API_KEY", "lang": "ru", "units": "metric"}
    )
    data = response.json()
    
    # Кэшируем на 30 минут
    r.set(cache_key, json.dumps(data), ex=1800)
    return data
```

## Паттерн: rate limiting

Не более N действий в промежуток времени:

```python
def check_rate_limit(user_id: int, action: str, limit: int, window: int) -> bool:
    """
    Возвращает True если лимит не превышен.
    limit — максимум действий
    window — промежуток в секундах
    """
    key = f"rl:{action}:{user_id}"
    
    count = r.incr(key)
    if count == 1:
        r.expire(key, window)  # устанавливаем TTL только при первом обращении
    
    return count <= limit

# Использование:
if not check_rate_limit(user_id=42, action="send_msg", limit=5, window=60):
    await message.answer("Подожди минуту — слишком много сообщений.")
    return
```

## Паттерн: сессии пользователей

Хранить данные пользователя без базы данных (быстро, с авто-истечением):

```python
import json

def save_session(user_id: int, data: dict, ttl: int = 86400):
    r.set(f"session:{user_id}", json.dumps(data, ensure_ascii=False), ex=ttl)

def get_session(user_id: int) -> dict | None:
    raw = r.get(f"session:{user_id}")
    return json.loads(raw) if raw else None

def update_session(user_id: int, **kwargs):
    session = get_session(user_id) or {}
    session.update(kwargs)
    save_session(user_id, session)

def clear_session(user_id: int):
    r.delete(f"session:{user_id}")

# Использование:
save_session(42, {"step": "waiting_phone", "name": "Андрей"})
session = get_session(42)
update_session(42, phone="+7999...")
```

## Паттерн: счётчики и статистика

```python
from datetime import date

def track_event(event: str):
    today = date.today().isoformat()  # "2025-06-30"
    r.incr(f"stats:{event}:{today}")

def get_today_count(event: str) -> int:
    today = date.today().isoformat()
    return int(r.get(f"stats:{event}:{today}") or 0)

# Использование:
track_event("bot_start")
track_event("form_submitted")

print(f"Стартов сегодня: {get_today_count('bot_start')}")
```

## Async Redis (для aiogram / FastAPI)

Для асинхронного кода используй `redis.asyncio`:

```python
import redis.asyncio as aioredis
import json

redis_client = aioredis.Redis(host="localhost", port=6379, decode_responses=True)

async def get_cached(key: str) -> dict | None:
    data = await redis_client.get(key)
    return json.loads(data) if data else None

async def set_cached(key: str, data: dict, ex: int = 300):
    await redis_client.set(key, json.dumps(data, ensure_ascii=False), ex=ex)

# В aiogram-хендлере:
@dp.message(Command("stats"))
async def stats(message: Message):
    cached = await get_cached(f"user_stats:{message.from_user.id}")
    if not cached:
        cached = await fetch_stats_from_db(message.from_user.id)
        await set_cached(f"user_stats:{message.from_user.id}", cached, ex=300)
    
    await message.answer(f"Твоя статистика: {cached}")
```

## Redis в Docker Compose

```yaml
services:
  app:
    build: .
    env_file: .env
    depends_on:
      - redis
  
  redis:
    image: redis:alpine
    restart: always
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes  # персистентность

volumes:
  redis_data:
```

В `.env`:
```
REDIS_URL=redis://redis:6379/0
```

## Мониторинг Redis

```bash
# Информация о состоянии
redis-cli info memory | grep used_memory_human

# Живой монитор всех команд (для отладки)
redis-cli monitor

# Список всех ключей (осторожно на продакшне — медленно)
redis-cli keys "*"

# Размер БД
redis-cli dbsize
```

## Промпт для добавления Redis

```
Добавь Redis-кэш в мой FastAPI/aiogram проект.
Redis URL: из .env переменной REDIS_URL.
Кэшировать:
- [описание что кэшировать]
- TTL: [секунды]
Используй redis.asyncio для async-кода.
Если Redis недоступен — фолбэк на прямой запрос (не падать).
```

---

::: info Что дальше?
Redis установлен — используй его для [FSM-хранилища](/practice/28-telegram-fsm) в боте (RedisStorage) или как брокер для [фоновых задач Celery](/practice/27-async-tasks).
:::
