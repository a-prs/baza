# Работа с внешними API

Почти любой проект рано или поздно использует внешний API: отправляет уведомление, получает курс валют, работает с файлами в облаке. Разберём как это устроено и как не наступить на типичные грабли.

## Что такое API

API (Application Programming Interface) — это способ попросить чужой сервис сделать что-то за тебя. Ты отправляешь HTTP-запрос, сервис возвращает данные или выполняет действие.

Аналогия: API — это меню в ресторане. Ты не знаешь как готовят, но знаешь что можно заказать и что получишь.

## Типы аутентификации

Перед работой с API нужно доказать что ты — это ты. Три основных способа:

### API Key (самый простой)

Ключ в заголовке или параметре запроса:

```python
import requests

# В заголовке
response = requests.get(
    "https://api.openweathermap.org/data/2.5/weather",
    params={"q": "Moscow", "appid": "твой-api-key", "lang": "ru"}
)

# Или в заголовке Authorization
headers = {"Authorization": "Bearer твой-api-key"}
response = requests.get("https://api.example.com/data", headers=headers)
```

API Key храни в `.env` — никогда не хардкодь в коде.

### OAuth 2.0 (Google, GitHub, Facebook)

Пользователь разрешает твоему приложению доступ к своим данным. Ты получаешь токен. Токен истекает — обновляешь через refresh_token.

```python
# Обычно используют готовые библиотеки:
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

creds = Credentials.from_authorized_user_file("token.json")
service = build("drive", "v3", credentials=creds)
```

### Basic Auth (устаревший, но встречается)

```python
response = requests.get(
    "https://api.example.com/data",
    auth=("username", "password")
)
```

## Базовый шаблон запроса

```python
import requests
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = "https://api.openai.com/v1"

def api_request(endpoint: str, payload: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    
    response = requests.post(
        f"{BASE_URL}/{endpoint}",
        json=payload,
        headers=headers,
        timeout=30,  # важно!
    )
    response.raise_for_status()  # выбросит исключение если не 2xx
    return response.json()
```

**Всегда ставь timeout** — без него запрос может висеть вечно если сервис недоступен.

## Обработка ошибок

API возвращает разные HTTP-статусы:

| Статус | Значение | Что делать |
|--------|----------|------------|
| 200-299 | Успех | Обрабатывать ответ |
| 400 | Неверный запрос | Проверь параметры |
| 401 | Не авторизован | Проверь токен/ключ |
| 403 | Доступ запрещён | Нет прав или превышен лимит |
| 404 | Не найдено | Неверный URL или ID |
| 429 | Слишком много запросов | Нужна пауза (rate limit) |
| 500 | Ошибка сервера | Повтори позже |

```python
from requests.exceptions import HTTPError, Timeout, ConnectionError

def safe_api_call(url: str, **kwargs) -> dict | None:
    try:
        response = requests.get(url, timeout=15, **kwargs)
        response.raise_for_status()
        return response.json()
    except HTTPError as e:
        status = e.response.status_code
        if status == 429:
            print("Rate limit — жди перед следующим запросом")
        elif status == 401:
            print("Неверный API key — проверь .env")
        else:
            print(f"HTTP ошибка {status}: {e.response.text}")
    except Timeout:
        print("Запрос завис — timeout")
    except ConnectionError:
        print("Нет подключения к сервису")
    return None
```

## Rate Limits: как не получить бан

Rate limit — ограничение на количество запросов в единицу времени. Превышение → 429 ошибка или временная блокировка.

### Проверить лимиты

Обычно они в заголовках ответа:

```python
response = requests.get(url, headers=headers)
print(response.headers.get("X-RateLimit-Limit"))      # всего в минуту
print(response.headers.get("X-RateLimit-Remaining"))  # осталось
print(response.headers.get("X-RateLimit-Reset"))      # когда обновится
```

### Добавить паузы между запросами

```python
import time

for item in items:
    result = api_request(item)
    process(result)
    time.sleep(0.5)  # 0.5 секунды между запросами
```

### Повтор с экспоненциальной паузой

```python
import time

def retry_request(url: str, max_retries: int = 3) -> dict | None:
    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            return response.json()
        except requests.HTTPError as e:
            if e.response.status_code == 429:
                wait = 2 ** attempt  # 1, 2, 4 секунды
                print(f"Rate limit. Жду {wait}с...")
                time.sleep(wait)
            else:
                raise
    return None
```

## Пагинация: получить все данные

Многие API не отдают все данные сразу — разбивают на страницы.

### Курсорная пагинация (Twitter, Instagram)

```python
def get_all_items(base_url: str) -> list:
    items = []
    cursor = None
    
    while True:
        params = {"limit": 100}
        if cursor:
            params["cursor"] = cursor
        
        data = api_request(base_url, params=params)
        items.extend(data["items"])
        
        cursor = data.get("next_cursor")
        if not cursor:
            break
    
    return items
```

### Страничная пагинация (page=1, page=2, ...)

```python
def get_all_pages(base_url: str) -> list:
    items = []
    page = 1
    
    while True:
        data = api_request(base_url, params={"page": page, "per_page": 100})
        if not data["items"]:
            break
        items.extend(data["items"])
        page += 1
    
    return items
```

## Кэширование: не делай лишних запросов

Если данные не меняются часто — сохраняй результат и используй повторно:

```python
import json
from pathlib import Path
from datetime import datetime, timedelta

CACHE_FILE = Path("cache/data.json")
CACHE_TTL = timedelta(hours=1)  # кэш живёт 1 час

def get_with_cache(url: str) -> dict:
    if CACHE_FILE.exists():
        cache = json.loads(CACHE_FILE.read_text())
        cached_at = datetime.fromisoformat(cache["cached_at"])
        if datetime.now() - cached_at < CACHE_TTL:
            return cache["data"]
    
    data = api_request(url)
    
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps({
        "data": data,
        "cached_at": datetime.now().isoformat()
    }))
    
    return data
```

## Промпты для работы с API

### Подключить новый API

```
Напиши Python-функцию для работы с API [название сервиса].
Документация: [ссылка или вставь нужные эндпоинты]
Что нужно: [описание операции]
Аутентификация: API Key в заголовке Authorization: Bearer
Токен: из .env переменной [НАЗВАНИЕ]
Добавь обработку ошибок и timeout.
```

### Исправить ошибку

```
Получаю ошибку при запросе к API:
[вставь полный traceback]

Вот мой код:
[вставь код]

Что не так?
```

### Понять документацию API

```
Вот часть документации API [сервис]:
[вставь раздел документации]

Переведи на простой язык:
1. Что делает этот эндпоинт
2. Какие параметры обязательные
3. Что вернёт в ответе
4. Напиши пример запроса на Python
```

## Популярные API и библиотеки

| Сервис | Библиотека | Установка |
|--------|-----------|-----------|
| OpenAI | `openai` | `pip install openai` |
| Telegram Bot | `aiogram` | `pip install aiogram` |
| Google Sheets | `gspread` | `pip install gspread` |
| Google Drive | `google-api-python-client` | `pip install google-api-python-client` |
| Notion | `notion-client` | `pip install notion-client` |
| GitHub | `PyGithub` | `pip install PyGithub` |
| Twitter/X | `tweepy` | `pip install tweepy` |
| Яндекс.Директ | `requests` | встроен |

Готовые библиотеки лучше голых `requests` — они уже обрабатывают аутентификацию, пагинацию и ошибки.

---

::: info Что дальше?
Умеешь работать с API — можешь подключить любой сервис. Следующий уровень: [вебхуки](/practice/19-webhooks) — это когда API сам тебе шлёт данные, без polling.
:::
