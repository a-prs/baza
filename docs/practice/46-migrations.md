# Миграции базы данных

Миграция — это скрипт, который изменяет схему БД (добавить колонку, переименовать таблицу, создать индекс). Без миграций — ручные ALTER TABLE на проде или потеря данных при пересоздании таблиц.

## Почему это важно

Когда проект живёт — схема меняется. `users` получает колонку `is_premium`, `posts` — новый индекс. Менять `CREATE TABLE` в коде и пересоздавать таблицу нельзя: потеряешь все данные. Нужны миграции.

## Путь 1: ручные SQL-скрипты (для SQLite, простые проекты)

Самый простой способ: папка `migrations/` с нумерованными файлами.

```
migrations/
├── 001_init.sql
├── 002_add_premium.sql
└── 003_add_index.sql
```

```sql
-- 001_init.sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

```sql
-- 002_add_premium.sql
ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN premium_until TIMESTAMP;
```

```sql
-- 003_add_index.sql
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
```

Менеджер миграций (Python):

```python
import sqlite3
import os
import logging

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def run_migrations(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    applied = {row[0] for row in conn.execute("SELECT filename FROM _migrations")}

    files = sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))
    
    for filename in files:
        if filename in applied:
            continue
        
        path = os.path.join(MIGRATIONS_DIR, filename)
        with open(path) as f:
            sql = f.read()
        
        try:
            conn.executescript(sql)
            conn.execute("INSERT INTO _migrations (filename) VALUES (?)", (filename,))
            conn.commit()
            logger.info(f"Migration applied: {filename}")
        except Exception as e:
            conn.rollback()
            raise RuntimeError(f"Migration failed: {filename}") from e
    
    conn.close()
```

Запуск в `main()`:

```python
async def main():
    run_migrations("bot.db")  # до init_db / dp.start_polling
    await init_db()
    await dp.start_polling(bot)
```

## Путь 2: Alembic (для PostgreSQL, SQLAlchemy)

Alembic — стандарт для PostgreSQL + SQLAlchemy. Создаёт файлы миграций автоматически по изменениям в моделях.

### Установка

```bash
pip install alembic sqlalchemy psycopg2-binary
alembic init alembic
```

Структура после `init`:
```
alembic/
├── env.py          # конфиг окружения
├── versions/       # файлы миграций
└── alembic.ini     # путь к БД
```

### Настройка

`alembic/env.py` — указать URL БД и модели:

```python
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context

# Импортировать свои модели
from models import Base  # твои SQLAlchemy-модели

config = context.config

# URL из переменной окружения
import os
config.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL"))

target_metadata = Base.metadata  # для autogenerate
```

Твои модели (`models.py`):

```python
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True)
    telegram_id = Column(Integer, unique=True, nullable=False)
    username = Column(String)
    is_premium = Column(Boolean, default=False)
    premium_until = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
```

### Создать и применить миграцию

```bash
# Создать миграцию автоматически (alembic сравнит модели с текущей схемой)
alembic revision --autogenerate -m "add premium columns"

# Применить все новые миграции
alembic upgrade head

# Откатить последнюю
alembic downgrade -1

# Статус: что применено, что нет
alembic history --verbose
alembic current
```

Сгенерированный файл миграции (`versions/xxxx_add_premium_columns.py`):

```python
def upgrade() -> None:
    op.add_column('users', sa.Column('is_premium', sa.Boolean(), nullable=True))
    op.add_column('users', sa.Column('premium_until', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'premium_until')
    op.drop_column('users', 'is_premium')
```

### Применять при старте приложения

```python
# main.py
from alembic import command
from alembic.config import Config


def run_migrations():
    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")


if __name__ == "__main__":
    run_migrations()
    # запустить FastAPI/бота
```

## Частые паттерны

### Добавить колонку с дефолтом

```sql
-- SQLite: NULL по умолчанию, потом UPDATE
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';
UPDATE users SET plan = 'free' WHERE plan IS NULL;
```

```python
# Alembic
op.add_column('users', sa.Column('plan', sa.String(), server_default='free'))
```

### Переименовать колонку

```sql
-- SQLite не поддерживает RENAME COLUMN до версии 3.25.0
-- Если нужно — пересоздать таблицу:
CREATE TABLE users_new AS SELECT id, telegram_id, username AS tg_username FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
```

```python
# Alembic (PostgreSQL)
op.alter_column('users', 'username', new_column_name='tg_username')
```

### Создать индекс на большой таблице

PostgreSQL: без `CONCURRENTLY` — таблица лочится до завершения.

```sql
-- Без блокировки (только PostgreSQL)
CREATE INDEX CONCURRENTLY idx_users_created ON users(created_at);
```

В Alembic:

```python
# Обычная миграция не поддерживает CONCURRENTLY — вынести за транзакцию
def upgrade() -> None:
    op.execute("COMMIT")  # выйти из транзакции
    op.execute("CREATE INDEX CONCURRENTLY idx_users_created ON users(created_at)")
```

## В CI/CD

```yaml
# GitHub Actions
- name: Run migrations
  run: alembic upgrade head
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

---

::: tip Золотое правило
Никогда не пиши миграцию которую нельзя откатить (`downgrade`). Если `downgrade` потерял бы данные — сначала убедись, что старое поведение приложения не зависит от старых данных.
:::

::: warning SQLite и ALTER TABLE
SQLite поддерживает только `ADD COLUMN` и `RENAME TABLE/COLUMN` (начиная с 3.25). Для всего остального — пересоздание таблицы. Если много таких изменений — подумай о переходе на PostgreSQL.
:::
