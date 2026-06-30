# Монитор цен и изменений

Скрипт, который проверяет цену (или любые данные на сайте) по расписанию и присылает уведомление в Telegram когда что-то изменилось. Подходит для:

- Отслеживания цен на товары
- Мониторинга вакансий или объявлений
- Уведомлений при появлении новых статей/новостей
- Проверки доступности услуги

**Время настройки:** 20–30 минут  
**Стек:** Python + BeautifulSoup + systemd timer  
**Нужен:** VPS с Python 3.10+, Telegram-бот

## Что получится

Каждые N минут скрипт:
1. Загружает страницу
2. Вытаскивает нужные данные (цену, текст, количество)
3. Сравнивает с предыдущим значением
4. Если изменилось — шлёт уведомление в Telegram

## Шаг 1: Создай Telegram-бота

Если бот уже есть — пропусти. Если нет — открой `@BotFather` в Telegram:

```
/newbot
Имя: Price Monitor
Username: my_price_monitor_bot
```

Получишь токен. Также нужен твой Chat ID — его можно узнать, написав `/start` боту `@userinfobot`.

## Шаг 2: Изучи что парсить

Открой нужную страницу в браузере. Нажми **F12** → **Elements** → найди нужный элемент (цена, текст). Посмотри какой у него класс или ID.

Пример: цена в элементе `<span class="price">2 990 ₽</span>` → `selector = ".price"`.

Или попроси ИИ:

```
Вот HTML страницы [вставь 30-50 строк вокруг нужного элемента].
Напиши CSS-селектор для извлечения цены.
```

## Шаг 3: Создай скрипт

Создай файл на сервере:

```bash
mkdir -p /opt/price-monitor
nano /opt/price-monitor/monitor.py
```

```python
import requests
from bs4 import BeautifulSoup
import os
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Настройки
URL = os.getenv("TARGET_URL")
SELECTOR = os.getenv("CSS_SELECTOR")  # например: ".price"
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
STATE_FILE = Path("/opt/price-monitor/state.json")

def get_current_value() -> str:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; PriceBot/1.0)"}
    response = requests.get(URL, headers=headers, timeout=15)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.text, "html.parser")
    element = soup.select_one(SELECTOR)
    
    if not element:
        raise ValueError(f"Элемент '{SELECTOR}' не найден на странице")
    
    return element.get_text(strip=True)

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}

def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))

def notify(message: str):
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        json={"chat_id": CHAT_ID, "text": message, "parse_mode": "HTML"},
        timeout=10,
    )

def main():
    state = load_state()
    prev_value = state.get("value")
    
    current_value = get_current_value()
    
    if prev_value is None:
        notify(f"✅ Мониторинг запущен\n\nURL: {URL}\nТекущее значение: <b>{current_value}</b>")
    elif current_value != prev_value:
        notify(
            f"⚡ Изменение!\n\n"
            f"URL: {URL}\n"
            f"Было: <s>{prev_value}</s>\n"
            f"Стало: <b>{current_value}</b>"
        )
    
    save_state({"value": current_value})
    print(f"Проверено: {current_value}")

if __name__ == "__main__":
    main()
```

## Шаг 4: Установи зависимости

```bash
cd /opt/price-monitor
python3 -m venv .venv
source .venv/bin/activate
pip install requests beautifulsoup4 python-dotenv
```

## Шаг 5: Настрой переменные

```bash
nano /opt/price-monitor/.env
```

```
TARGET_URL=https://example.com/product/iphone-16
CSS_SELECTOR=.price
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=123456789
```

## Шаг 6: Протестируй

```bash
cd /opt/price-monitor
source .venv/bin/activate
python monitor.py
```

Должно прийти сообщение «Мониторинг запущен» с текущим значением. Если ошибка — проверь CSS-селектор.

## Шаг 7: Автозапуск по расписанию

Создай systemd timer для запуска каждые 30 минут:

```bash
sudo nano /etc/systemd/system/price-monitor.service
```

```ini
[Unit]
Description=Price Monitor

[Service]
Type=oneshot
WorkingDirectory=/opt/price-monitor
ExecStart=/opt/price-monitor/.venv/bin/python monitor.py
EnvironmentFile=/opt/price-monitor/.env
```

```bash
sudo nano /etc/systemd/system/price-monitor.timer
```

```ini
[Unit]
Description=Price Monitor Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable price-monitor.timer
sudo systemctl start price-monitor.timer
```

Проверить что работает:

```bash
systemctl list-timers price-monitor.timer
journalctl -u price-monitor.service -n 20
```

## Расширенные возможности

### Несколько URL в одном скрипте

```python
TARGETS = [
    {"name": "iPhone 16", "url": "...", "selector": ".price"},
    {"name": "MacBook Air", "url": "...", "selector": "#product-price"},
]
```

Измени `main()` чтобы проходить по списку и для каждого проверять и сохранять в `state[name]`.

### Отслеживать число (сравнивать как число, не строку)

Если цена `2 990 ₽` — извлечи только цифры:

```python
import re

def parse_price(text: str) -> int:
    digits = re.sub(r"\D", "", text)
    return int(digits)
```

Сравнивай числа — и добавляй в уведомление разницу: `+200 ₽` / `-500 ₽`.

### Мониторить API вместо сайта

```python
def get_current_value() -> str:
    response = requests.get(
        "https://api.example.com/price",
        headers={"Authorization": f"Bearer {os.getenv('API_KEY')}"},
        timeout=15,
    )
    data = response.json()
    return str(data["price"])
```

### Попросить ИИ адаптировать под твой сайт

```
Вот скрипт мониторинга цен (вставь код выше).
Адаптируй под сайт [URL]:
- страница [URL конкретного товара]
- нужно отслеживать: цену и наличие ("в наличии" / "нет в наличии")
- CSS-селектор цены: [из DevTools]
- CSS-селектор наличия: [из DevTools]
Если товар появился в наличии — это приоритетное уведомление 🔥
```

## Устранение проблем

**`ValueError: Элемент не найден`** — неправильный CSS-селектор. Открой страницу в браузере → F12 → Console → введи `document.querySelector(".твой-селектор")`. Если `null` — селектор неверный.

**`requests.exceptions.HTTPError: 403`** — сайт блокирует ботов. Попробуй изменить `User-Agent` или добавить задержку между запросами.

**Данные устарели** — некоторые сайты рендерят контент через JavaScript. Обычный requests не выполняет JS. В этом случае нужен Playwright:

```
Перепиши скрипт парсинга с requests на Playwright,
так как страница рендерится через JavaScript.
```

---

::: info Связанные главы
- [Python-скрипты](/practice/17-python-scripts) — шаблоны и паттерны
- [Мониторинг](/practice/16-monitoring) — контроль что скрипт работает
- [Что делать когда сломалось](/practice/10-errors-debugging) — отладка
:::
