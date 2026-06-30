# Rate Limiting: защита от спама и перегрузки

Rate limiting — ограничение числа запросов от одного пользователя за период. Нужно чтобы:
- Один пользователь не мог спамить в бот (и выжигать токены)
- Защитить API от злоупотребления
- Корректно обрабатывать лимиты внешних API (чтобы не получать 429)

## Rate limiting в боте (in-memory)

Для небольшого бота — хватит словаря в памяти:

```python
import time
from collections import defaultdict

# Простой rate limiter
class RateLimiter:
    def __init__(self, max_calls: int, period: float):
        """max_calls за period секунд"""
        self.max_calls = max_calls
        self.period = period
        self.calls: dict[int, list[float]] = defaultdict(list)
    
    def is_allowed(self, user_id: int) -> bool:
        """Проверить можно ли сделать запрос"""
        now = time.time()
        user_calls = self.calls[user_id]
        
        # Убрать устаревшие вызовы
        self.calls[user_id] = [t for t in user_calls if now - t < self.period]
        
        if len(self.calls[user_id]) >= self.max_calls:
            return False
        
        self.calls[user_id].append(now)
        return True
    
    def time_until_reset(self, user_id: int) -> float:
        """Сколько секунд до следующего разрешённого запроса"""
        if not self.calls.get(user_id):
            return 0
        oldest = min(self.calls[user_id])
        return max(0, self.period - (time.time() - oldest))


# Создать лимитеры
general_limiter = RateLimiter(max_calls=10, period=60)   # 10 сообщений/мин
ai_limiter = RateLimiter(max_calls=3, period=60)          # 3 AI-запроса/мин
```

### Применить в хэндлерах

```python
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message
from aiogram.filters import Command

@dp.message(Command("ask"))
async def cmd_ask(message: Message):
    user_id = message.from_user.id
    
    if not ai_limiter.is_allowed(user_id):
        wait = ai_limiter.time_until_reset(user_id)
        await message.answer(
            f"Слишком много запросов. Попробуй через {wait:.0f} сек."
        )
        return
    
    # AI-запрос
    response = await ask_claude(message.text)
    await message.answer(response)
```

## Rate limiting через Middleware

Чище — через middleware, чтобы не повторять проверку в каждом хэндлере:

```python
from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, Message

class RateLimitMiddleware(BaseMiddleware):
    def __init__(self, max_calls: int = 10, period: float = 60):
        self.limiter = RateLimiter(max_calls, period)
    
    async def __call__(self, handler, event: TelegramObject, data: dict):
        from_user = data.get("event_from_user")
        
        if from_user:
            if not self.limiter.is_allowed(from_user.id):
                wait = self.limiter.time_until_reset(from_user.id)
                # Только для сообщений — ответить
                if isinstance(event, Message):
                    await event.answer(
                        f"⏳ Подожди {wait:.0f} сек. перед следующим сообщением."
                    )
                return  # прервать обработку
        
        return await handler(event, data)

# Подключить
dp.message.middleware(RateLimitMiddleware(max_calls=15, period=60))
```

## Rate limiting в Redis

Для нескольких процессов/серверов — нужен Redis:

```python
import redis.asyncio as aioredis
import time

redis = aioredis.from_url("redis://localhost:6379")


async def is_allowed_redis(user_id: int, max_calls: int = 10, period: int = 60) -> bool:
    """Sliding window rate limiter через Redis"""
    key = f"ratelimit:{user_id}"
    now = time.time()
    pipe = redis.pipeline()
    
    # Убрать устаревшие события
    pipe.zremrangebyscore(key, 0, now - period)
    # Посчитать текущие
    pipe.zcard(key)
    # Добавить новое
    pipe.zadd(key, {str(now): now})
    # Установить TTL
    pipe.expire(key, period)
    
    results = await pipe.execute()
    count = results[1]  # до добавления нового
    
    return count < max_calls
```

## Обработка 429 от внешних API

Когда сам делаешь запросы к внешним API — они могут вернуть 429:

```python
import asyncio
import httpx

async def request_with_retry(
    url: str,
    max_retries: int = 3,
    backoff_factor: float = 1.0
) -> dict:
    """Запрос с экспоненциальным backoff при 429"""
    async with httpx.AsyncClient() as client:
        for attempt in range(max_retries):
            response = await client.get(url)
            
            if response.status_code == 200:
                return response.json()
            
            if response.status_code == 429:
                # Прочитать заголовок Retry-After если есть
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    wait = float(retry_after)
                else:
                    wait = backoff_factor * (2 ** attempt)  # 1, 2, 4 сек
                
                print(f"Rate limited. Ждём {wait:.1f} сек...")
                await asyncio.sleep(wait)
                continue
            
            response.raise_for_status()
    
    raise Exception(f"Превышено кол-во попыток для {url}")
```

### Декоратор для retry

```python
import functools
import asyncio
import httpx

def retry_on_rate_limit(max_retries: int = 3):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429 and attempt < max_retries - 1:
                        wait = 2 ** attempt
                        await asyncio.sleep(wait)
                        continue
                    raise
        return wrapper
    return decorator


@retry_on_rate_limit(max_retries=3)
async def call_api(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
```

## Очередь запросов к API

Если нужно сделать много запросов не нарушая лимит:

```python
import asyncio
from asyncio import Queue

class APIQueue:
    def __init__(self, max_per_second: float = 2.0):
        self.queue = Queue()
        self.interval = 1.0 / max_per_second
        self._running = False
    
    async def add(self, coroutine):
        """Добавить задачу в очередь"""
        future = asyncio.Future()
        await self.queue.put((coroutine, future))
        if not self._running:
            asyncio.create_task(self._process())
        return await future
    
    async def _process(self):
        self._running = True
        while not self.queue.empty():
            coro, future = await self.queue.get()
            try:
                result = await coro
                future.set_result(result)
            except Exception as e:
                future.set_exception(e)
            await asyncio.sleep(self.interval)
        self._running = False


api_queue = APIQueue(max_per_second=2.0)

# Использование — запросы автоматически выполняются с паузой
async def process_users(users: list[int]):
    tasks = [api_queue.add(fetch_user_data(uid)) for uid in users]
    results = await asyncio.gather(*tasks)
    return results
```

## Rate limiting в FastAPI

```python
from fastapi import FastAPI, Request, HTTPException
from collections import defaultdict
import time

app = FastAPI()

request_counts: dict = defaultdict(list)

def check_rate_limit(ip: str, max_calls: int = 100, period: int = 60):
    now = time.time()
    calls = [t for t in request_counts[ip] if now - t < period]
    request_counts[ip] = calls
    
    if len(calls) >= max_calls:
        raise HTTPException(
            status_code=429,
            detail="Too many requests",
            headers={"Retry-After": str(period)}
        )
    request_counts[ip].append(now)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    ip = request.client.host
    try:
        check_rate_limit(ip)
    except HTTPException as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=429, content={"detail": "Too many requests"})
    
    return await call_next(request)
```

---

::: info Выбор подхода
- **In-memory dict**: достаточно для одного процесса, теряется при рестарте
- **Redis**: для нескольких процессов или серверов, персистентный
- **Middleware**: применять ко всем хэндлерам сразу
- **Декоратор**: для конкретных функций с внешними API
:::
