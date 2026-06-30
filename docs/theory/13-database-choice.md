# Какую базу данных выбрать

Один из самых частых вопросов новичков — и один из самых переоценённых. Хорошая новость: для большинства проектов разница невелика, а ошибиться сложно.

## Базовое правило

**SQLite для начала.** Почти всегда. Вплоть до 10 000 пользователей и 1 GB данных SQLite справляется без проблем. Это один файл — не нужен сервер, не нужна настройка, отлично работает на VPS.

Переходи на PostgreSQL когда: нужно больше одного пишущего процесса, данных > 1 GB, нужна репликация, или есть конкретная причина.

## Виды баз данных

### SQLite — файловая реляционная

```python
import sqlite3

conn = sqlite3.connect("app.db")
conn.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER UNIQUE,
        username TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")
conn.commit()
```

**Когда:** боты, CLI-инструменты, небольшие сервисы, прототипы.

**Плюсы:** нет сервера, один файл, встроен в Python, бэкап = cp file.  
**Минусы:** один пишущий процесс, нет сетевого доступа, не для высоких нагрузок.

### PostgreSQL — полноценная реляционная

```python
import psycopg2

conn = psycopg2.connect(
    host="localhost", database="myapp",
    user="postgres", password="secret"
)
cursor = conn.cursor()
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

Через SQLAlchemy (ORM):
```python
from sqlalchemy import create_engine, text

engine = create_engine("postgresql://user:pass@localhost/db")
with engine.connect() as conn:
    result = conn.execute(text("SELECT * FROM users"))
```

**Когда:** несколько сервисов пишут в одну БД, > 10 000 пользователей, нужны транзакции с изоляцией, JSON-поля (jsonb), полнотекстовый поиск.

**Плюсы:** ACID, типы данных богаче SQLite, расширения (pgvector, PostGIS), горизонтальное масштабирование.  
**Минусы:** нужен сервер (Docker или managed), сложнее настраивать.

### MongoDB — документная

```python
from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
db = client["myapp"]

# Вставить документ (как dict)
db.users.insert_one({
    "telegram_id": 123456,
    "data": {"name": "Андрей", "settings": {"notify": True}}
})

# Найти
user = db.users.find_one({"telegram_id": 123456})
```

**Когда:** структура данных часто меняется, данные — произвольные JSON-объекты, нет чётких связей.

**Плюсы:** схема гибкая, горизонтальное масштабирование, хорошо для вложенных структур.  
**Минусы:** нет ACID-транзакций (частично есть с 4.0), JOIN сложнее, больше памяти.

### Redis — в памяти

```python
import redis

r = redis.Redis(host="localhost", port=6379)

r.set("user:123:session", "token_value", ex=3600)  # TTL 1 час
session = r.get("user:123:session")
```

**Когда:** кэш, сессии, очереди, счётчики, rate limiting. Не как основная БД для постоянных данных.

**Плюсы:** сверхбыстрый (всё в RAM), атомарные операции, pub/sub.  
**Минусы:** данные в памяти (дорого для больших объёмов), персистентность настраивать отдельно.

## Таблица выбора

| Задача | База |
|--------|------|
| Telegram-бот до 10к пользователей | SQLite |
| SaaS-продукт с командой | PostgreSQL |
| Каталог с гибкой структурой | MongoDB |
| Кэш, сессии, очереди | Redis |
| Векторный поиск, RAG | pgvector (расширение Postgres) или Chroma |
| Аналитика, OLAP | ClickHouse |

## ORM vs raw SQL

**ORM (SQLAlchemy, tortoise-orm)** — пишешь Python, не SQL. Проще для CRUD, сложнее для сложных запросов.

**Raw SQL** — полный контроль, иногда быстрее, всегда ясно что происходит.

Для новичков: начни с raw SQL + sqlite3 → перейди к SQLAlchemy когда проект вырастет. ORM имеет смысл с 3+ таблицами и сложными связями.

## Миграции схемы

Когда нужно изменить структуру БД — не меняй вручную. Используй миграции:

```python
# alembic для SQLAlchemy
pip install alembic
alembic init migrations
alembic revision --autogenerate -m "add users table"
alembic upgrade head
```

Для простых проектов — просто версионируй SQL-скрипты:
```
migrations/
├── 001_create_users.sql
├── 002_add_premium_field.sql
└── 003_create_orders.sql
```

## Бэкап

**SQLite:**
```bash
cp app.db app.db.backup-$(date +%Y%m%d)
```

**PostgreSQL:**
```bash
pg_dump myapp > backup-$(date +%Y%m%d).sql
```

**MongoDB:**
```bash
mongodump --db myapp --out /backup/$(date +%Y%m%d)
```

---

::: info Главный совет
Не выбирай «лучшую» базу абстрактно — выбирай ту, которую уже знаешь и которая решает твою задачу. SQLite + Python = работающий продукт сегодня. Оптимизация — потом, когда будет что оптимизировать.
:::
