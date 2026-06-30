# Автопостинг в Telegram из Google Sheets

Ведёшь контент-план в Google Таблицах — скрипт сам берёт посты по расписанию и публикует в Telegram-канал. Удобно для команды: редактор заполняет таблицу, публикация происходит автоматически.

**Время настройки:** 30–40 минут  
**Стек:** Python + gspread + Telegram Bot API + systemd  
**Нужен:** VPS, Google-аккаунт, Telegram-канал/группа

## Что получится

В Google Таблице создаёшь строки с постами:

| Дата | Время | Текст | Статус |
|------|-------|-------|--------|
| 2025-06-01 | 10:00 | Привет! Новый пост. | |
| 2025-06-01 | 18:00 | Вечерний контент... | |
| 2025-06-02 | 09:00 | Пост на завтра | Опубликовано |

Скрипт запускается каждые 5 минут, находит строки с наступившим временем и ещё не опубликованные — публикует и ставит статус «Опубликовано».

## Шаг 1: Настрой Google Sheets API

Нужен сервисный аккаунт — это «технический» пользователь Google которому дашь доступ к таблице.

1. Открой [console.cloud.google.com](https://console.cloud.google.com/)
2. **Создай проект** (или выбери существующий)
3. Включи API: **Библиотека** → найди «Google Sheets API» → Включить
4. Включи API: **Библиотека** → найди «Google Drive API» → Включить
5. **Credentials** → **Create Credentials** → **Service Account**
6. Имя: `sheets-bot`, нажми **Done**
7. Открой созданный сервис-аккаунт → **Keys** → **Add Key** → **JSON**
8. Скачается файл `project-id-xxxxx.json` — это твои credentials

## Шаг 2: Создай Google Таблицу

1. Создай новую таблицу на [sheets.google.com](https://sheets.google.com/)
2. Первая строка — заголовки: `Дата | Время | Текст | Статус`
3. Скопируй ID таблицы из URL: `https://docs.google.com/spreadsheets/d/**ЭТОТ_ID**/edit`
4. Дай доступ сервис-аккаунту: **Поделиться** → вставь email сервис-аккаунта (из JSON-файла, поле `client_email`) → роль «Редактор»

## Шаг 3: Создай Telegram-бота

Если бот уже есть — пропусти. Для публикации в канал бот должен быть добавлен в канал как **администратор** с правом публикации.

Узнать ID канала: перешли любое сообщение из канала боту `@userinfobot`. Или используй `-100123456789` формат (в API негативный ID с префиксом -100).

## Шаг 4: Разверни скрипт

```bash
mkdir -p /opt/sheets-bot
cd /opt/sheets-bot
```

Скопируй credentials JSON-файл:

```bash
# На своей машине:
scp project-id-xxxxx.json user@server:/opt/sheets-bot/credentials.json
```

Создай скрипт:

```bash
nano /opt/sheets-bot/bot.py
```

```python
import gspread
from google.oauth2.service_account import Credentials
import requests
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID")
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID")
CREDENTIALS_FILE = "/opt/sheets-bot/credentials.json"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

def get_sheet():
    creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID).sheet1

def send_message(text: str) -> bool:
    response = requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        json={
            "chat_id": CHANNEL_ID,
            "text": text,
            "parse_mode": "HTML",
        },
        timeout=15,
    )
    return response.ok

def main():
    sheet = get_sheet()
    rows = sheet.get_all_records()
    now = datetime.now()
    
    for i, row in enumerate(rows, start=2):  # строки начинаются с 2 (1 = заголовок)
        if row.get("Статус") == "Опубликовано":
            continue
        
        try:
            post_time = datetime.strptime(
                f"{row['Дата']} {row['Время']}", "%Y-%m-%d %H:%M"
            )
        except (ValueError, KeyError):
            continue  # пропускаем строки с неверным форматом
        
        if now >= post_time:
            text = row.get("Текст", "").strip()
            if not text:
                continue
            
            if send_message(text):
                sheet.update_cell(i, 4, "Опубликовано")  # колонка 4 = Статус
                print(f"Опубликовано: {text[:50]}...")
            else:
                print(f"Ошибка публикации строки {i}")

if __name__ == "__main__":
    main()
```

## Шаг 5: Установи зависимости и настрой окружение

```bash
cd /opt/sheets-bot
python3 -m venv .venv
source .venv/bin/activate
pip install gspread google-auth requests python-dotenv
```

Создай `.env`:

```bash
nano /opt/sheets-bot/.env
```

```
SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_CHANNEL_ID=-1001234567890
```

Протестируй:

```bash
source .venv/bin/activate
python bot.py
```

Добавь строку в таблицу с прошедшим временем — должно опубликовать.

## Шаг 6: Запуск по расписанию

```bash
sudo nano /etc/systemd/system/sheets-bot.service
```

```ini
[Unit]
Description=Google Sheets Telegram Bot
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/opt/sheets-bot
ExecStart=/opt/sheets-bot/.venv/bin/python bot.py
EnvironmentFile=/opt/sheets-bot/.env
```

```bash
sudo nano /etc/systemd/system/sheets-bot.timer
```

```ini
[Unit]
Description=Sheets Bot Timer

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable sheets-bot.timer
sudo systemctl start sheets-bot.timer
systemctl list-timers sheets-bot.timer
```

## Расширения

### Публикация с медиа

Добавь колонку «Фото» в таблицу (URL картинки):

```python
photo_url = row.get("Фото", "").strip()

if photo_url:
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto",
        json={
            "chat_id": CHANNEL_ID,
            "photo": photo_url,
            "caption": text,
            "parse_mode": "HTML",
        }
    )
else:
    send_message(text)
```

### Несколько каналов

Добавь колонку «Канал» в таблицу с разными channel_id. Скрипт смотрит куда публиковать каждый пост.

### Черновики

Добавь статус «Готово» — скрипт публикует только строки со статусом «Готово» (а не все пустые).

```python
if row.get("Статус") != "Готово":
    continue
```

Меняешь статус на «Готово» — подтверждаешь что пост проверен и готов к публикации.

## Устранение проблем

**`gspread.exceptions.SpreadsheetNotFound`** — неверный ID таблицы или не дал доступ сервис-аккаунту. Проверь: таблица → Поделиться → там должен быть email из credentials.json.

**`403 Forbidden` от Telegram** — бот не является администратором канала. Зайди в настройки канала → Администраторы → добавь бота.

**Дата/время парсится неверно** — проверь формат в таблице. Скрипт ожидает `YYYY-MM-DD` и `HH:MM`. Если в таблице другой формат — измени строку `datetime.strptime(...)`.

---

::: info Связанные темы
- [Python-скрипты](/practice/17-python-scripts) — паттерны и шаблоны
- [Мониторинг](/practice/16-monitoring) — следить что скрипт работает
- [Внешние API](/practice/21-external-apis) — как работать с API в общем
:::
