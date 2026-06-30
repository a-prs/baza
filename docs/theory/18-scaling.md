# Масштабирование: что делать когда MVP вырос

Первые 100 пользователей — не нужно ничего. 10 000 — надо думать. 100 000 — надо было думать раньше. Разберём признаки и решения.

## Когда начинать думать о масштабировании

Не сразу. Преждевременная оптимизация — враг. Масштабировать нужно когда:
- Запросы начинают падать с timeout
- БД тормозит (запросы > 100ms)
- Память/CPU сервера стабильно > 80%
- Пользователи жалуются на скорость

До этого — доставляй ценность, не оптимизируй.

## Уровень 1: оптимизация того что есть

Часто не нужен второй сервер — нужно убрать N+1 запросы и добавить индексы.

### N+1 запросы

```python
# Плохо: 1 запрос на список + N запросов на пользователей
posts = await db.execute("SELECT * FROM posts")
for post in posts:
    user = await db.execute("SELECT * FROM users WHERE id = ?", (post["user_id"],))
    # N дополнительных запросов!

# Хорошо: 1 запрос с JOIN
posts = await db.execute("""
    SELECT p.*, u.username, u.avatar 
    FROM posts p
    JOIN users u ON p.user_id = u.id
""")
```

### Индексы

```sql
-- Проверить медленные запросы
EXPLAIN QUERY PLAN SELECT * FROM posts WHERE user_id = 123 AND created_at > '2024-01-01';

-- Добавить составной индекс
CREATE INDEX idx_posts_user_date ON posts(user_id, created_at DESC);
```

### Кэш на уровне приложения

```python
from functools import lru_cache
import time

_cache = {}

async def get_settings(key: str) -> str:
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < 300:  # TTL 5 минут
        return _cache[key]["value"]
    
    value = await db.execute_fetchone("SELECT value FROM settings WHERE key = ?", (key,))
    _cache[key] = {"value": value[0], "ts": now}
    return value[0]
```

## Уровень 2: вертикальное масштабирование

Самый простой шаг — купить сервер мощнее. Часто хватает надолго.

| Нагрузка | Рекомендация |
|---|---|
| < 1000 MAU | VPS 2 CPU / 4 GB RAM (~$10/мес) |
| < 10 000 MAU | VPS 4 CPU / 8 GB RAM (~$20/мес) |
| < 50 000 MAU | VPS 8 CPU / 16 GB RAM (~$40/мес) |
| > 50 000 MAU | Пора горизонтальное масштабирование |

Для большинства indie-проектов вертикальное масштабирование — всё что нужно.

## Уровень 3: разделение слоёв

Когда один сервер не справляется — разделяй ответственность:

```
Было:                  Стало:
┌─────────────────┐   ┌─────────┐  ┌──────────┐
│  Всё на одном   │   │  App    │  │   БД     │
│  сервере        │   │  сервер │  │  сервер  │
│  (app + БД +    │   └─────────┘  └──────────┘
│   файлы)        │   ┌─────────┐
└─────────────────┘   │  Redis  │
                      └─────────┘
```

### PostgreSQL на отдельном сервере

```python
# Подключение с пулом соединений
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

engine = create_async_engine(
    os.getenv("DATABASE_URL"),
    pool_size=10,      # минимум соединений в пуле
    max_overflow=20,   # дополнительные при пике
    pool_timeout=30,
    pool_pre_ping=True  # проверять соединение перед использованием
)
```

### Redis для сессий и кэша

```python
import redis.asyncio as redis

# Кэш на Redis вместо in-memory dict
r = redis.from_url(os.getenv("REDIS_URL"))

async def get_user_cached(user_id: int) -> dict:
    key = f"user:{user_id}"
    cached = await r.get(key)
    if cached:
        return json.loads(cached)
    
    user = await db_get_user(user_id)
    await r.setex(key, 300, json.dumps(user))  # TTL 5 минут
    return user
```

## Уровень 4: горизонтальное масштабирование

Несколько инстансов приложения за балансировщиком.

### Nginx как балансировщик

```nginx
upstream app_servers {
    least_conn;  # отправлять на наименее загруженный
    server 127.0.0.1:8001;
    server 127.0.0.1:8002;
    server 127.0.0.1:8003;
}

server {
    location / {
        proxy_pass http://app_servers;
    }
}
```

### Несколько воркеров с Gunicorn

```bash
# FastAPI/uvicorn с несколькими воркерами
gunicorn main:app \
    -w 4 \                  # 4 воркера
    -k uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000
```

### Stateless приложение — обязательное условие

Горизонтальное масштабирование работает только если приложение не хранит состояние локально:

```python
# Плохо: состояние в памяти одного инстанса
SESSIONS = {}  # только один из 4 воркеров его видит

# Хорошо: состояние в Redis (видят все)
async def get_session(session_id: str) -> dict:
    data = await r.get(f"session:{session_id}")
    return json.loads(data) if data else None
```

## Уровень 5: очереди задач

Тяжёлые операции (AI-генерация, email-рассылка, обработка файлов) — не в HTTP-запросе, а в очереди:

```python
# Паттерн: принять задачу → вернуть task_id → выполнить асинхронно
from celery import Celery

celery = Celery("tasks", broker="redis://localhost:6379/0")

@celery.task
def generate_report(user_id: int, date_range: str):
    # Долгая операция — несколько минут
    report = create_pdf_report(user_id, date_range)
    send_to_user(user_id, report)
    return report.path

# FastAPI endpoint
@app.post("/reports/generate")
async def request_report(user_id: int, date_range: str):
    task = generate_report.delay(user_id, date_range)
    return {"task_id": task.id, "status": "queued"}

@app.get("/reports/status/{task_id}")
async def check_status(task_id: str):
    task = celery.AsyncResult(task_id)
    return {"status": task.status, "result": task.result}
```

## Мониторинг при масштабировании

Нельзя масштабировать вслепую. Минимальный стек:

```python
# Prometheus-метрики для FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator().instrument(app).expose(app)
# Метрики доступны на /metrics
```

Ключевые метрики:
- **Latency P99** — 99-й перцентиль времени ответа (не среднее!)
- **Error rate** — % 5xx ошибок
- **Active connections** — текущие соединения
- **DB query time** — время запросов к БД

## Правило для вайб-кодера

```
Монолит → Индексы/кэш → Вертикальное → Разделение слоёв → Горизонтальное
```

Не прыгай сразу к горизонтальному масштабированию. 80% проектов навсегда останутся на уровне «индексы + вертикальное» — и это нормально.

---

::: info Дорогая оптимизация
Горизонтальное масштабирование стоит дорого: сложность ops, DevOps-время, конфигурация. Для проекта с 10 000 MAU это может быть оверкилл. Сначала проверь: правильные ли индексы, нет ли N+1, не нужно ли просто поднять тариф VPS.
:::
