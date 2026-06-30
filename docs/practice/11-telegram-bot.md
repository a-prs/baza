# Telegram-бот с нуля

Telegram-боты — один из самых полезных проектов для вайб-кодера. Бот может отвечать на вопросы, присылать уведомления, принимать заявки, автоматически что-то делать. В этой главе создадим своего первого бота и выложим его на сервер.

## Что нужно перед стартом

- ✅ Python установлен (`python --version`)
- ✅ Аккаунт в Telegram
- ✅ VPS-сервер (для бота, который работает 24/7) — или для теста можно запустить локально

## Шаг 1: Создай бота в Telegram

1. Открой Telegram, найди **[@BotFather](https://t.me/BotFather)**
2. Напиши `/newbot`
3. BotFather спросит имя (любое, например «Мой первый бот»)
4. Потом username — должен заканчиваться на `bot` (например `my_first_123bot`)
5. BotFather даст тебе **токен** — длинная строка вида `7123456789:AAHxxx...`

::: warning Сохрани токен!
Токен — это ключ доступа к боту. Храни его в `.env` файле (см. предыдущую главу), никогда не вставляй в код напрямую и не публикуй в открытый доступ.
:::

## Шаг 2: Создай проект

```bash
mkdir Projects/my-bot
cd Projects/my-bot
```

> 💬 «Создай папку для нового Telegram-бота в Projects/my-bot»

Создай файл `.env`:

```
BOT_TOKEN=7123456789:AAHxxx...
```

Создай `.gitignore`:

```
.env
__pycache__/
*.pyc
.venv/
```

## Шаг 3: Установи библиотеку

Используем **aiogram** — самую популярную Python-библиотеку для Telegram-ботов.

```bash
python -m venv .venv              # создать виртуальное окружение
source .venv/bin/activate          # активировать (Mac/Linux)
# .venv\Scripts\activate           # активировать (Windows)

pip install aiogram python-dotenv
```

> 💬 «Создай виртуальное окружение и установи aiogram и python-dotenv»

::: tip Что такое виртуальное окружение
Это изолированная папка с библиотеками для конкретного проекта. Как отдельная полка для каждого проекта — библиотеки проектов не мешают друг другу. `.venv/` создаётся в папке проекта и не попадает в git.
:::

## Шаг 4: Напиши бота через ИИ

Запусти Claude Code или Qwen Code:

```bash
claude
# или
qwen
```

Напиши:

```
Создай Telegram-бота на aiogram 3 с такими возможностями:
1. Команда /start — приветствие "Привет! Я бот-помощник. Что хочешь сделать?"
2. Команда /help — список команд
3. На любое текстовое сообщение — отвечает "Ты написал: [сообщение]" (эхо)
4. Токен берёт из переменной окружения BOT_TOKEN через python-dotenv

Файл: bot.py
```

ИИ создаст файл `bot.py`. Примерно так он будет выглядеть:

```python
import asyncio
import os
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message
from aiogram.filters import Command

load_dotenv()

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer("Привет! Я бот-помощник. Что хочешь сделать?")

@dp.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer("/start — начало\n/help — это сообщение")

@dp.message(F.text)
async def echo(message: Message):
    await message.answer(f"Ты написал: {message.text}")

async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
```

## Шаг 5: Запусти локально

```bash
python bot.py
```

> 💬 «Запусти Telegram-бота локально для тестирования»

Открой Telegram, найди своего бота (по username из Шага 1) и напиши ему. Бот должен ответить.

Для остановки — нажми `Ctrl+C`.

## Шаг 6: Добавь полезную логику

Теперь проси ИИ добавлять фичи. Примеры промптов:

**Кнопки:**
```
Добавь кнопки под сообщение /start:
"Узнать погоду" и "Помощь"
При нажатии "Помощь" — выводи /help
```

**Запоминать пользователей:**
```
При команде /start сохраняй user_id и имя пользователя в файл users.json
При команде /users (только для меня, мой user_id = XXXXXXXXX) — 
показывай список всех пользователей
```

**Отправлять файлы:**
```
При команде /report — отправляй файл report.pdf из текущей папки
```

## Шаг 7: Задеплой на сервер

Чтобы бот работал 24/7 — нужен сервер. Без сервера бот работает только пока открыт терминал.

### Копируй файлы на сервер

```bash
scp -r Projects/my-bot root@185.143.72.31:/opt/my-bot
```

> 💬 «Скопируй папку с ботом на сервер 185.143.72.31 в /opt/my-bot»

### Создай .env на сервере

```bash
ssh root@185.143.72.31
nano /opt/my-bot/.env
# вставь BOT_TOKEN=...
```

> 💬 «Подключись к серверу 185.143.72.31 и создай .env файл в /opt/my-bot с переменной BOT_TOKEN»

### Установи зависимости на сервере

```bash
cd /opt/my-bot
python3 -m venv .venv
source .venv/bin/activate
pip install aiogram python-dotenv
```

> 💬 «Создай виртуальное окружение и установи зависимости бота на сервере в /opt/my-bot»

### Настрой автозапуск через systemd

Создай файл сервиса:

```bash
nano /etc/systemd/system/my-bot.service
```

> 💬 «Создай systemd-сервис для автозапуска Telegram-бота из /opt/my-bot — запускать bot.py через venv, рестарт при падении»

Вставь:

```ini
[Unit]
Description=My Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/my-bot
ExecStart=/opt/my-bot/.venv/bin/python bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Активируй и запусти:

```bash
systemctl daemon-reload
systemctl enable my-bot
systemctl start my-bot
```

> 💬 «Зарегистрируй и запусти сервис my-bot через systemd»

Проверь статус:

```bash
systemctl status my-bot
```

> 💬 «Проверь статус бота my-bot — запущен ли он»

Должно показать `active (running)`.

## Обновление бота

Когда внесёшь изменения локально — скопируй на сервер и перезапусти:

```bash
scp Projects/my-bot/bot.py root@185.143.72.31:/opt/my-bot/
ssh root@185.143.72.31 "systemctl restart my-bot"
```

> 💬 «Обнови bot.py на сервере и перезапусти сервис»

Или настрой деплой через GitHub — после каждого `git push` бот обновляется автоматически (тема для отдельной главы).

## Чеклист

- [ ] Бот создан в BotFather, токен получен
- [ ] Токен в `.env`, не в коде
- [ ] `python bot.py` — бот отвечает локально
- [ ] Бот добавлен на сервер и работает через systemd
- [ ] `systemctl status my-bot` — показывает `active`

---

::: info Что дальше?
Бот работает 24/7! Следующий шаг — добавить больше логики: подключить базу данных, интегрировать с n8n, добавить ИИ-ответы. Загляни в раздел [Готовые решения](/solutions/) — там есть готовые боты с инструкциями.
:::
