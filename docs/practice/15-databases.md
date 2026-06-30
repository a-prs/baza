# Базы данных для вайб-кодера

Как только проект начинает что-то «помнить» — пользователей, заказы, настройки, историю — нужна база данных. Выбор правильной базы экономит часы работы. Разберём три варианта: от простого к сложному.

## Три варианта и когда что выбирать

| База | Когда использовать | Где хранится |
|------|--------------------|--------------|
| **SQLite** | 1 приложение, небольшой объём | Файл на сервере |
| **PostgreSQL** | Много пользователей, сложные запросы | Сервер или облако |
| **Supabase** | Хочу готовое без настройки | Облако (чужой сервер) |

::: tip Проще говоря
SQLite — это Excel-файл. Открыл, записал, закрыл. PostgreSQL — это полноценная СУБД, как 1С, с отдельным сервером. Supabase — это Google Sheets: всё в облаке, просто пользуешься.
:::

## SQLite — начни с него

SQLite — файловая база данных. Вся база — один файл `database.db`. Не нужно ничего устанавливать дополнительно (встроена в Python).

**Подходит когда:**
- Telegram-бот для личного использования
- Хранение настроек, истории, небольших списков
- Один пользователь или небольшое число пользователей

### Python + SQLite

```python
import sqlite3

# Подключиться (создаст файл если нет)
conn = sqlite3.connect("data/app.db")
cursor = conn.cursor()

# Создать таблицу
cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER UNIQUE,
        name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")
conn.commit()

# Добавить запись
cursor.execute(
    "INSERT OR IGNORE INTO users (telegram_id, name) VALUES (?, ?)",
    (123456789, "Андрей")
)
conn.commit()

# Прочитать
cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (123456789,))
user = cursor.fetchone()
print(user)  # (1, 123456789, 'Андрей', '2025-01-01 10:00:00')

conn.close()
```

### Через ИИ

Скажи ИИ что именно хочешь хранить, и он напишет всё сам:

```
Добавь SQLite базу данных в бота.
Таблица users: telegram_id, имя, дата регистрации.
При команде /start — сохранять пользователя если ещё не сохранён.
При команде /stats — выводить количество пользователей.
Используй aiosqlite (для async).
```

## PostgreSQL — когда SQLite мало

PostgreSQL — полноценная реляционная база данных. Нужна когда:
- Несколько приложений работают с одной базой
- Много одновременных пользователей
- Нужны сложные запросы и связи между таблицами

### Установка на сервере

```bash
apt install postgresql -y
systemctl start postgresql
systemctl enable postgresql
```

Создать базу и пользователя:

```bash
sudo -u postgres psql

CREATE DATABASE myapp;
CREATE USER myuser WITH PASSWORD 'пароль';
GRANT ALL PRIVILEGES ON DATABASE myapp TO myuser;
\q
```

### Python + PostgreSQL

```bash
pip install psycopg2-binary
```

```python
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(
    host="localhost",
    database="myapp",
    user="myuser",
    password=os.getenv("DB_PASSWORD")
)
```

Строку подключения удобно хранить в `.env`:

```
DATABASE_URL=postgresql://myuser:пароль@localhost:5432/myapp
```

## Supabase — база без сервера

**Supabase** — это PostgreSQL в облаке с удобным интерфейсом, авторизацией и API из коробки. Бесплатный тариф — 500MB базы, хватит для личных проектов.

**Подходит когда:**
- Нет своего сервера
- Нужна авторизация пользователей
- Хочешь работать с базой прямо из JavaScript без backend

### Подключение

1. Зайди на [supabase.com](https://supabase.com/) → создай проект
2. Перейди в **Settings → API** — скопируй URL и ключ
3. Добавь в `.env`:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=твой-anon-key
```

### JavaScript

```bash
npm install @supabase/supabase-js
```

```javascript
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Добавить запись
const { error } = await supabase
  .from('users')
  .insert({ name: 'Андрей', email: 'a@example.com' })

// Прочитать
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('name', 'Андрей')
```

### Python

```bash
pip install supabase
```

```python
from supabase import create_client
import os

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

# Добавить
supabase.table("users").insert({"name": "Андрей"}).execute()

# Прочитать
result = supabase.table("users").select("*").execute()
```

## Как попросить ИИ добавить базу данных

### SQLite в бот

```
Добавь SQLite базу данных в файле data/bot.db.
Таблица: [название] с полями [поля и типы].
При [событии] — сохранять [что].
При команде [команда] — читать и выводить [что].
```

### PostgreSQL

```
Подключи PostgreSQL к проекту.
Строку подключения брать из .env переменной DATABASE_URL.
Таблица: [название и структура].
Операции: [что нужно делать с данными].
```

### Supabase

```
Подключи Supabase к проекту.
URL и ключ из .env (SUPABASE_URL и SUPABASE_KEY).
Таблица '[название]' уже создана в Supabase.
Нужно: [операции — читать, писать, обновлять].
```

## Инструменты для работы с базой

### Просмотреть SQLite без кода

**DB Browser for SQLite** — бесплатная программа для просмотра и редактирования SQLite-файлов. Скачай на [sqlitebrowser.org](https://sqlitebrowser.org/).

Открываешь файл `app.db` — видишь таблицы, данные, можешь редактировать руками.

### Просмотреть PostgreSQL

**DBeaver** — бесплатный клиент для любых баз данных. Подключился по хосту/порту/пароля — и видишь все таблицы.

---

::: info Что дальше?
База данных есть — проект запоминает данные. Следующий уровень: [несколько проектов на одном сервере](/practice/13-multiple-projects) или [Telegram-бот с нуля](/practice/11-telegram-bot) с базой данных.
:::
