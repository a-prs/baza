# Несколько ботов из одного кода

Делаешь похожий продукт для разных клиентов? Хочешь запустить несколько брендов одним кодом? Или нужны dev/prod среды? Разберём как управлять несколькими ботами не дублируя код.

## Один файл, два токена

Простейший вариант — запуск с разными `.env`:

```bash
# .env.prod
BOT_TOKEN=prod_token
CHANNEL_ID=-1001234567890
BOT_NAME=Production Bot

# .env.dev  
BOT_TOKEN=dev_token
CHANNEL_ID=-1009876543210
BOT_NAME=Dev Bot
```

```bash
# Запуск с конкретным .env
ENV_FILE=.env.prod python bot.py
ENV_FILE=.env.dev python bot.py
```

В коде:
```python
import os
from dotenv import load_dotenv

env_file = os.getenv("ENV_FILE", ".env")
load_dotenv(env_file)
```

Теперь один код — разные конфиги.

## Несколько systemd-юнитов

Для VPS — запустить разные инстансы как отдельные сервисы:

```bash
# /etc/systemd/system/mybot@.service — шаблонный юнит
[Unit]
Description=My Bot %i instance
After=network.target

[Service]
User=office
WorkingDirectory=/home/office/mybot
ExecStart=/home/office/mybot/.venv/bin/python bot.py
Restart=always
EnvironmentFile=/home/office/mybot/.env.%i   # .env.prod, .env.dev, .env.client1

[Install]
WantedBy=multi-user.target
```

```bash
# Запустить инстансы
sudo systemctl enable --now mybot@prod
sudo systemctl enable --now mybot@dev
sudo systemctl enable --now mybot@client1

# Проверить все
systemctl status "mybot@*"
```

## Мультитенантность (один бот, много клиентов)

Если у всех клиентов разные настройки но одна логика — лучше один бот с таблицей клиентов:

```python
import sqlite3

def init_db():
    conn = sqlite3.connect("multibot.db")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY,
            bot_token TEXT UNIQUE NOT NULL,
            name TEXT,
            channel_id TEXT,
            welcome_text TEXT DEFAULT 'Привет!',
            active BOOLEAN DEFAULT 1
        )
    """)
    conn.commit()
    conn.close()

def get_tenant_by_bot(bot_id: int) -> dict | None:
    """Найти конфиг клиента по bot_id"""
    conn = sqlite3.connect("multibot.db")
    row = conn.execute(
        "SELECT * FROM tenants WHERE id = ? AND active = 1",
        (bot_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None
```

### Запуск нескольких Bot-объектов

aiogram позволяет запускать несколько ботов в одном процессе:

```python
import asyncio
import sqlite3
import os
from aiogram import Bot, Dispatcher
from aiogram.types import Message
from aiogram.filters import Command

routers_cache: dict[int, tuple[Bot, Dispatcher]] = {}

def get_tenants() -> list[dict]:
    conn = sqlite3.connect("multibot.db")
    rows = conn.execute(
        "SELECT * FROM tenants WHERE active = 1"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def make_dispatcher(tenant: dict) -> Dispatcher:
    """Создать dispatcher с хэндлерами для конкретного тенанта"""
    dp = Dispatcher()
    
    welcome_text = tenant["welcome_text"]
    channel_id = tenant["channel_id"]
    
    @dp.message(Command("start"))
    async def start(message: Message):
        await message.answer(welcome_text)
    
    @dp.message(Command("post"))
    async def post(message: Message, bot: Bot):
        text = message.text.removeprefix("/post").strip()
        await bot.send_message(channel_id, text)
        await message.answer("Опубликовано!")
    
    return dp

async def run_tenant(tenant: dict):
    """Запустить одного бота"""
    bot = Bot(token=tenant["bot_token"])
    dp = make_dispatcher(tenant)
    
    print(f"Запускаю бота: {tenant['name']}")
    await dp.start_polling(bot)

async def main():
    tenants = get_tenants()
    if not tenants:
        print("Нет активных тенантов!")
        return
    
    # Запустить всех ботов параллельно
    await asyncio.gather(*[run_tenant(t) for t in tenants])

if __name__ == "__main__":
    asyncio.run(main())
```

## Разделение по файлам конфигурации

Для крупных проектов — папка `tenants/` с конфигом каждого:

```
tenants/
├── client_acme/
│   ├── config.yaml
│   └── prompts/
│       └── system.txt
├── client_beta/
│   ├── config.yaml
│   └── prompts/
│       └── system.txt
└── dev/
    └── config.yaml
```

```yaml
# tenants/client_acme/config.yaml
name: "ACME Corp Bot"
bot_token: "${ACME_BOT_TOKEN}"  # из .env
channel_id: "-1001234567890"
welcome_text: "Добро пожаловать в ACME!"
ai_model: "claude-haiku-4-5-20251001"
max_tokens: 500
```

```python
import yaml
import os
import glob

def load_tenants(tenants_dir: str = "tenants") -> list[dict]:
    tenants = []
    for config_path in glob.glob(f"{tenants_dir}/*/config.yaml"):
        with open(config_path) as f:
            content = f.read()
        # Подставить переменные окружения
        for key, value in os.environ.items():
            content = content.replace(f"${{{key}}}", value)
        config = yaml.safe_load(content)
        config["_dir"] = os.path.dirname(config_path)
        tenants.append(config)
    return tenants
```

## Dev/Prod разделение

Простая практика: два бота в BotFather, два `.env` файла:

```
.env          # dev (по умолчанию)
.env.prod     # production
```

```bash
# Локально (dev)
python bot.py

# На сервере (prod)
ENV_FILE=.env.prod python bot.py

# Или в systemd
EnvironmentFile=/home/office/mybot/.env.prod
```

В боте можно показывать метку среды:

```python
is_prod = os.getenv("ENV", "dev") == "prod"
env_label = "🟢" if is_prod else "🟡 DEV"

@dp.message(Command("status"))
async def status(message: Message):
    await message.answer(f"{env_label} Bot — {os.getenv('BOT_NAME', 'unnamed')}")
```

## Промпт для создания мультибота

```
Создай систему запуска нескольких Telegram-ботов из одного кода.
Каждый бот — отдельная запись в SQLite таблице `bots`:
id, token, name, owner_chat_id, welcome_message, active.

Один процесс запускает все активные боты параллельно через asyncio.gather.
Хэндлеры одинаковые для всех, но тексты берутся из конфига.

Команда /add <token> <name> добавляет нового бота (только owner_chat_id=ADMIN_ID).
Команда /list показывает все боты и их статус.
```

---

::: info Ограничение Telegram
Один токен = один запущенный бот. Нельзя запустить двух полеров с одним токеном — второй не получит обновления. Для нескольких инстансов — нужно несколько токенов.
:::
