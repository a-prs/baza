# Python-скрипты и автоматизации

Python — главный язык вайб-кодера для всего что «работает в фоне»: скрипты, парсеры, автоматизации, обработка данных. В этой главе разберём практические паттерны, которые встречаются в 80% задач.

## Почему Python

- Читается почти как обычный текст — ИИ объясняет код понятно
- Огромная экосистема библиотек (парсинг, работа с API, файлами, таблицами)
- Работает на любом сервере без настройки
- aiogram (боты), FastAPI (веб), pandas (данные), requests (HTTP) — всё есть

## Структура любого скрипта

Попроси ИИ написать скрипт по этой структуре — получишь аккуратный код:

```python
import os
from dotenv import load_dotenv

load_dotenv()

# Настройки
API_KEY = os.getenv("API_KEY")
OUTPUT_FILE = "data/result.json"

def main():
    # Основная логика здесь
    data = fetch_data()
    save_result(data)
    print("Готово!")

def fetch_data():
    # Получить данные
    pass

def save_result(data):
    # Сохранить результат
    pass

if __name__ == "__main__":
    main()
```

## Частые задачи и промпты

### Скачать данные из API

```
Напиши скрипт, который:
1. Делает GET-запрос на https://api.example.com/data
   с заголовком Authorization: Bearer {API_KEY из .env}
2. Парсит JSON-ответ
3. Сохраняет в файл data/result.json
4. Печатает сколько записей получил
```

Шаблон кода:

```python
import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

def fetch_data():
    headers = {"Authorization": f"Bearer {os.getenv('API_KEY')}"}
    response = requests.get("https://api.example.com/data", headers=headers)
    response.raise_for_status()  # падает если не 200
    return response.json()

def save_data(data):
    os.makedirs("data", exist_ok=True)
    with open("data/result.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    data = fetch_data()
    save_data(data)
    print(f"Сохранено {len(data)} записей")
```

### Парсинг сайта

```
Напиши скрипт парсинга сайта https://example.com/news:
- Найди все статьи (теги article или .news-item)
- Из каждой возьми: заголовок, ссылку, дату
- Сохрани в data/articles.json
- Используй библиотеку requests + BeautifulSoup
```

```bash
pip install requests beautifulsoup4
```

```python
import requests
from bs4 import BeautifulSoup
import json

def parse_articles():
    response = requests.get("https://example.com/news")
    soup = BeautifulSoup(response.text, "html.parser")
    
    articles = []
    for item in soup.select(".news-item"):
        articles.append({
            "title": item.select_one("h2").text.strip(),
            "link": item.select_one("a")["href"],
            "date": item.select_one(".date").text.strip(),
        })
    return articles
```

::: warning Парсинг и законность
Перед парсингом проверь `robots.txt` сайта (`site.com/robots.txt`). Если там `Disallow: /` — сайт запрещает парсинг. Многие сайты блокируют частые запросы — делай паузы между запросами: `time.sleep(1)`.
:::

### Работа с файлами

```
Напиши скрипт, который:
- Читает все .txt файлы из папки input/
- Объединяет их в один файл output/combined.txt
- Между файлами добавляет разделитель "---"
```

```python
import os
from pathlib import Path

def combine_files(input_dir="input", output_file="output/combined.txt"):
    os.makedirs("output", exist_ok=True)
    files = sorted(Path(input_dir).glob("*.txt"))
    
    with open(output_file, "w", encoding="utf-8") as out:
        for i, file in enumerate(files):
            if i > 0:
                out.write("\n---\n\n")
            out.write(file.read_text(encoding="utf-8"))
    
    print(f"Объединено {len(files)} файлов → {output_file}")
```

### Работа с Google Таблицами

```
Напиши скрипт, который читает данные из Google Таблицы
и добавляет новую строку с текущей датой и [данные].
Используй библиотеку gspread с сервис-аккаунтом.
```

```bash
pip install gspread google-auth
```

### Отправка уведомлений

Добавить уведомление в Telegram в любой скрипт:

```python
import requests
import os

def notify(message: str):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": message}
    )
```

Вставь в любое место скрипта:

```python
notify("✅ Парсинг завершён, собрано 47 статей")
notify(f"⚠️ Ошибка: {str(e)}")
```

## Запуск по расписанию

### Через cron (на сервере)

```bash
crontab -e
```

Синтаксис: `минута час день месяц день_недели команда`

```bash
# Каждый день в 9:00
0 9 * * * /opt/scripts/.venv/bin/python /opt/scripts/daily_report.py

# Каждый час
0 * * * * /opt/scripts/.venv/bin/python /opt/scripts/check_prices.py

# Каждые 15 минут с 9 до 18
*/15 9-18 * * 1-5 /opt/scripts/.venv/bin/python /opt/scripts/monitor.py
```

::: tip Генератор cron-выражений
Если не помнишь синтаксис — спроси ИИ: «напиши cron-выражение для запуска каждую пятницу в 18:00». Или используй [crontab.guru](https://crontab.guru) — визуальный редактор.
:::

### Через systemd timer (надёжнее cron)

Создай два файла: `.service` (что запускать) и `.timer` (когда):

```bash
nano /etc/systemd/system/my-script.service
```

```ini
[Unit]
Description=My Script

[Service]
Type=oneshot
WorkingDirectory=/opt/scripts
ExecStart=/opt/scripts/.venv/bin/python daily_report.py
```

```bash
nano /etc/systemd/system/my-script.timer
```

```ini
[Unit]
Description=Run my-script daily

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl daemon-reload
systemctl enable my-script.timer
systemctl start my-script.timer
# проверить:
systemctl list-timers
```

**Преимущество перед cron:** если сервер был выключен в момент запуска — timer выполнится при следующем включении (`Persistent=true`).

## Виртуальное окружение на сервере

Всегда используй venv на сервере — разные проекты не конфликтуют:

```bash
cd /opt/my-script
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Создать `requirements.txt` из текущего окружения:

```bash
pip freeze > requirements.txt
```

## Типовой промпт для скрипта

```
Напиши Python-скрипт [название задачи].

Что делает:
1. [шаг 1]
2. [шаг 2]
3. [шаг 3]

Входные данные: [откуда берёт: файл / API / аргументы командной строки]
Результат: [куда пишет: файл / в Telegram / в консоль]
Ошибки: логировать в консоль и отправлять уведомление в Telegram

Конфигурация через .env:
- [ПЕРЕМЕННАЯ_1] — [описание]
- [ПЕРЕМЕННАЯ_2] — [описание]

Файл: script.py
Зависимости: перечисли pip-пакеты в requirements.txt
```

---

::: info Что дальше?
Python-автоматизации — мощный инструмент. Добавь [мониторинг](/practice/16-monitoring), чтобы знать если скрипт упал. Или посмотри [Telegram-бот с нуля](/practice/11-telegram-bot) — там Python используется для создания полноценного бота.
:::
