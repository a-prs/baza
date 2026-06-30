# Продвинутые asyncio паттерны

asyncio позволяет делать несколько вещей одновременно — запрашивать несколько API, обрабатывать пакеты задач, управлять таймаутами. Разбираем паттерны которые реально нужны в продакшне.

## gather: несколько задач параллельно

```python
import asyncio
import aiohttp


async def fetch_price(session: aiohttp.ClientSession, symbol: str) -> dict:
    async with session.get(f"https://api.example.com/price/{symbol}") as r:
        return {"symbol": symbol, "price": (await r.json())["price"]}


async def get_all_prices(symbols: list[str]) -> list[dict]:
    async with aiohttp.ClientSession() as session:
        # Все запросы одновременно, результаты в том же порядке
        results = await asyncio.gather(
            *[fetch_price(session, s) for s in symbols]
        )
    return list(results)


# Если один падает — все падают (дефолт)
# return_exceptions=True: каждая ошибка как результат, не исключение
async def get_prices_safe(symbols: list[str]) -> list[dict]:
    async with aiohttp.ClientSession() as session:
        results = await asyncio.gather(
            *[fetch_price(session, s) for s in symbols],
            return_exceptions=True
        )
    
    prices = []
    for symbol, result in zip(symbols, results):
        if isinstance(result, Exception):
            print(f"{symbol}: error {result}")
        else:
            prices.append(result)
    
    return prices
```

## Semaphore: ограничить параллелизм

Если отправить 1000 запросов одновременно — сервер или сеть упадут.

```python
import asyncio
import aiohttp

MAX_CONCURRENT = 10  # не более 10 запросов одновременно

sem = asyncio.Semaphore(MAX_CONCURRENT)


async def fetch_with_limit(session: aiohttp.ClientSession, url: str) -> str:
    async with sem:  # ждать свободного слота
        async with session.get(url) as response:
            return await response.text()


async def batch_fetch(urls: list[str]) -> list[str]:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_with_limit(session, url) for url in urls]
        return await asyncio.gather(*tasks)
```

## TaskGroup (Python 3.11+): отмена при ошибке

```python
import asyncio


async def process_item(item: str) -> str:
    await asyncio.sleep(0.1)
    if item == "bad":
        raise ValueError(f"Failed: {item}")
    return f"OK: {item}"


async def process_batch(items: list[str]) -> list[str]:
    results = []
    
    try:
        async with asyncio.TaskGroup() as tg:
            tasks = [tg.create_task(process_item(item)) for item in items]
        
        # Сюда попадаем только если ВСЕ задачи успешны
        results = [t.result() for t in tasks]
    
    except* ValueError as eg:
        # except* — для ExceptionGroup (может быть несколько ошибок)
        for exc in eg.exceptions:
            print(f"Error: {exc}")
    
    return results
```

## asyncio.wait_for: таймаут

```python
import asyncio


async def slow_api_call() -> str:
    await asyncio.sleep(10)  # медленная операция
    return "result"


async def with_timeout() -> str | None:
    try:
        result = await asyncio.wait_for(slow_api_call(), timeout=3.0)
        return result
    except asyncio.TimeoutError:
        print("Превышен таймаут")
        return None


# Или через asyncio.timeout (Python 3.11+)
async def with_timeout_modern() -> str | None:
    try:
        async with asyncio.timeout(3.0):
            return await slow_api_call()
    except TimeoutError:
        return None
```

## Очередь: producer/consumer

Паттерн для обработки задач с ограниченным числом воркеров:

```python
import asyncio
from anthropic import AsyncAnthropic

claude = AsyncAnthropic()


async def worker(queue: asyncio.Queue, results: list, worker_id: int):
    """Воркер: берёт задачи из очереди, обрабатывает."""
    while True:
        item = await queue.get()
        
        if item is None:  # сигнал завершения
            queue.task_done()
            break
        
        try:
            response = await claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                messages=[{"role": "user", "content": item["prompt"]}]
            )
            results.append({
                "id": item["id"],
                "result": response.content[0].text,
                "worker": worker_id,
            })
        except Exception as e:
            results.append({"id": item["id"], "error": str(e)})
        finally:
            queue.task_done()


async def process_prompts(prompts: list[str], concurrency: int = 5) -> list[dict]:
    """Обработать много промптов с ограниченным параллелизмом."""
    queue: asyncio.Queue = asyncio.Queue()
    results = []
    
    # Наполнить очередь
    for i, prompt in enumerate(prompts):
        await queue.put({"id": i, "prompt": prompt})
    
    # Добавить стоп-сигналы (по одному на воркер)
    for _ in range(concurrency):
        await queue.put(None)
    
    # Запустить воркеров
    workers = [
        asyncio.create_task(worker(queue, results, i))
        for i in range(concurrency)
    ]
    
    # Ждать завершения всех задач
    await queue.join()
    await asyncio.gather(*workers)
    
    return sorted(results, key=lambda x: x.get("id", 0))


# Использование
async def main():
    prompts = [f"Объясни понятие №{i} кратко" for i in range(50)]
    results = await process_prompts(prompts, concurrency=5)
    print(f"Обработано: {len(results)}")
```

## asyncio.Event: ожидание события

```python
import asyncio


ready = asyncio.Event()


async def initialize():
    """Что-то инициализируем."""
    await asyncio.sleep(2)
    ready.set()  # сигнализируем что готово
    print("Инициализация завершена")


async def handler():
    """Ждём пока не готово."""
    print("Жду готовности...")
    await ready.wait()
    print("Начинаю обработку")


async def main():
    await asyncio.gather(initialize(), handler(), handler())
```

## Паттерн: retry с backoff

```python
import asyncio
import random
from functools import wraps


def async_retry(max_attempts: int = 3, base_delay: float = 1.0, exceptions=(Exception,)):
    """Декоратор: повторить при ошибке с экспоненциальной задержкой."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    if attempt == max_attempts - 1:
                        raise
                    
                    delay = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
                    print(f"Попытка {attempt + 1} не удалась: {e}. Повтор через {delay:.1f}с")
                    await asyncio.sleep(delay)
        
        return wrapper
    return decorator


# Использование
@async_retry(max_attempts=3, base_delay=0.5)
async def unstable_api_call(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            response.raise_for_status()
            return await response.json()
```

## Паттерн: кэш с TTL для async

```python
import asyncio
import time
from functools import wraps


def async_ttl_cache(ttl: float = 60.0):
    """Кэш для async-функций с временем жизни."""
    cache: dict = {}
    
    def decorator(func):
        @wraps(func)
        async def wrapper(*args):
            now = time.monotonic()
            
            if args in cache:
                value, expires_at = cache[args]
                if now < expires_at:
                    return value
            
            value = await func(*args)
            cache[args] = (value, now + ttl)
            return value
        
        return wrapper
    return decorator


@async_ttl_cache(ttl=300.0)  # кэш на 5 минут
async def get_user_from_db(user_id: int) -> dict:
    # дорогой запрос к БД
    async with aiosqlite.connect("db.sqlite") as db:
        row = await db.execute_fetchall(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        )
        return dict(row[0]) if row else None
```

## Паттерн: batch с флашем

Копить события, флашить пачкой (например, bulk-insert в БД):

```python
import asyncio
from collections import defaultdict


class BatchProcessor:
    def __init__(self, max_size: int = 100, flush_interval: float = 5.0):
        self.max_size = max_size
        self.flush_interval = flush_interval
        self.batch: list = []
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
    
    async def add(self, item):
        async with self._lock:
            self.batch.append(item)
            
            if len(self.batch) >= self.max_size:
                await self._flush_now()
            elif self._flush_task is None or self._flush_task.done():
                self._flush_task = asyncio.create_task(self._schedule_flush())
    
    async def _schedule_flush(self):
        await asyncio.sleep(self.flush_interval)
        async with self._lock:
            if self.batch:
                await self._flush_now()
    
    async def _flush_now(self):
        if not self.batch:
            return
        
        items = self.batch.copy()
        self.batch.clear()
        
        await self._process_batch(items)
    
    async def _process_batch(self, items: list):
        # Реализовать: bulk insert, API call и т.д.
        print(f"Обработка {len(items)} элементов")


# Использование: логировать события пачками
event_processor = BatchProcessor(max_size=50, flush_interval=10.0)

async def log_event(event_type: str, data: dict):
    await event_processor.add({"type": event_type, "data": data})
```

---

::: tip asyncio.run() — точка входа
`asyncio.run(main())` создаёт новый event loop и закрывает его в конце. Используй только один раз на верхнем уровне. Внутри async-кода — только `await`, `asyncio.create_task()`, `asyncio.gather()`. Никогда не создавай новый event loop внутри работающего — это ошибка.
:::
