# Кэширование: быстрее без лишних запросов

Кэш — это хранение результата дорогой операции чтобы не повторять её снова. Дорогая операция — это запрос к внешнему API, сложный SQL-запрос, генерация текста через LLM.

## Когда кэшировать

Кэш нужен когда:
- Один и тот же запрос повторяется часто (список товаров, курс валют)
- Операция дорогая (LLM API — время + деньги)
- Данные меняются редко (раз в час/день, не в секунду)

Не кэшируй:
- Данные уникальные для каждого пользователя
- Данные которые меняются постоянно и важна актуальность
- Маленькие и быстрые операции

## Простейший кэш: словарь Python

```python
import time
from functools import wraps
from typing import Any, Callable

# Простой in-memory кэш с TTL
cache: dict[str, tuple[Any, float]] = {}

def get_cached(key: str, ttl: int = 300) -> Any | None:
    if key in cache:
        value, expires_at = cache[key]
        if time.time() < expires_at:
            return value
        del cache[key]
    return None

def set_cached(key: str, value: Any, ttl: int = 300):
    cache[key] = (value, time.time() + ttl)
```

### Декоратор кэширования

```python
def cached(ttl: int = 300, key_prefix: str = ""):
    """Декоратор: кэшировать результат функции"""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Ключ кэша из имени функции и аргументов
            cache_key = f"{key_prefix}{func.__name__}:{args}:{kwargs}"
            
            result = get_cached(cache_key, ttl)
            if result is not None:
                return result
            
            result = await func(*args, **kwargs)
            set_cached(cache_key, result, ttl)
            return result
        return wrapper
    return decorator

# Использование
@cached(ttl=3600)  # кэш на 1 час
async def get_exchange_rate(currency: str) -> float:
    """Запрос курса валюты (дорогой)"""
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.get(f"https://api.example.com/rate/{currency}")
        return r.json()["rate"]

# Первый вызов — запрос к API
rate1 = await get_exchange_rate("USD")
# Второй вызов — из кэша (мгновенно)
rate2 = await get_exchange_rate("USD")
```

## Кэш LLM-запросов

Если пользователи часто задают похожие вопросы — LLM API очень дорого. Кэш по точному тексту запроса:

```python
import hashlib

def request_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()

async def ask_claude_cached(question: str, ttl: int = 86400) -> str:
    """Ответить через Claude с кэшем на 24 часа"""
    key = f"claude:{request_hash(question)}"
    
    cached_result = get_cached(key, ttl)
    if cached_result:
        return cached_result
    
    # Реальный запрос
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{"role": "user", "content": question}]
    )
    result = response.content[0].text
    
    set_cached(key, result, ttl)
    return result
```

## Redis для кэша (persistence + несколько процессов)

In-memory словарь умирает при рестарте. Redis — нет:

```python
import redis.asyncio as aioredis
import json
import os

redis = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

async def cache_get(key: str) -> Any | None:
    value = await redis.get(key)
    if value:
        return json.loads(value)
    return None

async def cache_set(key: str, value: Any, ttl: int = 300):
    await redis.set(key, json.dumps(value), ex=ttl)

async def cache_delete(key: str):
    await redis.delete(key)

async def cache_clear_prefix(prefix: str):
    """Удалить все ключи с префиксом"""
    keys = await redis.keys(f"{prefix}*")
    if keys:
        await redis.delete(*keys)
```

### Паттерн cache-aside

```python
async def get_user_profile(user_id: int) -> dict:
    """Профиль пользователя с кэшем"""
    key = f"user:{user_id}:profile"
    
    # 1. Смотрим в кэш
    cached = await cache_get(key)
    if cached:
        return cached
    
    # 2. Запрашиваем из БД
    profile = await db_get_user(user_id)
    
    # 3. Кладём в кэш
    await cache_set(key, profile, ttl=600)  # 10 минут
    
    return profile

async def update_user_profile(user_id: int, data: dict):
    """При обновлении — инвалидировать кэш"""
    await db_update_user(user_id, data)
    await cache_delete(f"user:{user_id}:profile")  # ← важно!
```

## functools.lru_cache для синхронного кода

Встроенный Python-кэш без внешних зависимостей. Только для синхронных функций и без TTL:

```python
from functools import lru_cache

@lru_cache(maxsize=128)
def get_config(key: str) -> str:
    """Конфиг из файла — кэшируется автоматически"""
    import json
    with open("config.json") as f:
        return json.load(f).get(key, "")

# Очистить кэш
get_config.cache_clear()
```

## HTTP-кэш в ответах API

Для публичных данных — добавь заголовки кэширования в FastAPI:

```python
from fastapi import FastAPI
from fastapi.responses import Response

app = FastAPI()

@app.get("/api/catalog")
async def get_catalog(response: Response):
    """Каталог — кэшировать на 1 час"""
    response.headers["Cache-Control"] = "public, max-age=3600"
    response.headers["Vary"] = "Accept-Encoding"
    
    return {"products": [...]}

@app.get("/api/user/profile")
async def get_profile(response: Response):
    """Профиль — не кэшировать"""
    response.headers["Cache-Control"] = "no-store"
    return {...}
```

## Когда инвалидировать кэш

Проблема кэша — устаревание данных. Стратегии:
- **TTL**: автоматически через N секунд (легко, иногда показывает старое)
- **По событию**: при изменении данных удаляем кэш (точно, нужна логика)
- **Версионирование**: `user:5:profile:v3` — при изменении меняем версию

```python
class UserCache:
    def __init__(self, user_id: int):
        self.user_id = user_id
        self._version = None
    
    async def _get_version(self) -> int:
        v = await redis.get(f"user:{self.user_id}:cache_version")
        return int(v) if v else 1
    
    async def _key(self, name: str) -> str:
        v = await self._get_version()
        return f"user:{self.user_id}:{name}:v{v}"
    
    async def get(self, name: str) -> Any | None:
        return await cache_get(await self._key(name))
    
    async def set(self, name: str, value: Any, ttl: int = 600):
        await cache_set(await self._key(name), value, ttl)
    
    async def invalidate_all(self):
        """Инвалидировать весь кэш пользователя одной операцией"""
        v = await self._get_version()
        await redis.set(f"user:{self.user_id}:cache_version", v + 1)
```

---

::: info Мониторинг эффективности кэша
Логируй cache hit/miss: `print(f"Cache {'HIT' if result else 'MISS'}: {key}")`. Хороший cache hit rate — 80%+. Если ниже — или данные слишком динамичные, или TTL слишком мал.
:::
