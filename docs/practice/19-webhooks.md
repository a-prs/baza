# Вебхуки: принимаем входящие запросы

Вебхук — это URL на твоём сервере, куда внешние сервисы отправляют данные автоматически. Stripe сообщает об оплате. Telegram шлёт сообщения. n8n запускает workflow. Разберём как это устроено и как принять такой запрос.

## Как работает вебхук

Без вебхука ты сам спрашиваешь: «Есть ли новые данные?» — это называется polling. С вебхуком сервис сам присылает: «Вот новые данные» — это push.

```
Polling:                    Webhook:
ты → API «есть новое?»      сервис → твой URL «вот новое!»
ты → API «есть новое?»      
ты → API «есть новое?»      
```

Преимущества вебхука:
- Данные приходят мгновенно (не с задержкой polling)
- Не нагружаешь API лишними запросами
- Не нужен фоновый цикл проверки

## Минимальный вебхук-сервер

Для приёма вебхуков нужен HTTP-сервер с публичным URL. Удобнее всего на FastAPI.

```python
from fastapi import FastAPI, Request
import uvicorn

app = FastAPI()

@app.post("/webhook")
async def receive_webhook(request: Request):
    data = await request.json()
    print(f"Получили: {data}")
    # Обработка данных здесь
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Запускаешь на сервере — URL вебхука: `https://твой-домен.com/webhook`

Промпт для создания:

```
Создай FastAPI-сервер для приёма вебхуков.
Endpoint POST /webhook:
- принимает JSON
- логирует входящие данные в файл logs/webhook.log
- возвращает {"ok": true}
Порт: 8080
Запуск как systemd-сервис.
```

## Примеры: вебхуки конкретных сервисов

### Telegram Bot Webhook

По умолчанию Telegram-боты работают через polling (бот сам спрашивает «есть ли сообщения»). Вебхук эффективнее — Telegram сам шлёт каждое сообщение.

Включить вебхук:

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://mysite.com/tg-webhook"
```

Принять в aiogram 3:

```python
from aiogram import Bot, Dispatcher
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

WEBHOOK_URL = "https://mysite.com/tg-webhook"

async def on_startup(bot: Bot):
    await bot.set_webhook(WEBHOOK_URL)

dp = Dispatcher()

# ... хендлеры как обычно ...

app = web.Application()
SimpleRequestHandler(dispatcher=dp, bot=bot).register(app, path="/tg-webhook")
setup_application(app, dp, bot=bot)

web.run_app(app, host="0.0.0.0", port=8080)
```

### GitHub Webhook

GitHub присылает уведомление при каждом push, PR, issue. Удобно для автоматического деплоя.

В настройках репозитория: Settings → Webhooks → Add webhook.

Пример получения:

```python
from fastapi import FastAPI, Request, HTTPException
import hmac, hashlib, os

app = FastAPI()
SECRET = os.getenv("GITHUB_WEBHOOK_SECRET")

@app.post("/github")
async def github_webhook(request: Request):
    body = await request.body()
    
    # Проверяем подпись
    signature = request.headers.get("X-Hub-Signature-256", "")
    expected = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=403, detail="Invalid signature")
    
    event = request.headers.get("X-GitHub-Event")
    data = await request.json()
    
    if event == "push":
        branch = data["ref"].split("/")[-1]
        print(f"Push в ветку {branch}")
        # здесь запустить деплой
    
    return {"ok": True}
```

### Stripe Webhook

Stripe уведомляет об оплатах, отменах, возвратах.

```python
import stripe
import os

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

@app.post("/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(body, sig, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400)
    
    if event["type"] == "payment_intent.succeeded":
        payment = event["data"]["object"]
        amount = payment["amount"] / 100
        print(f"Оплата {amount} ₽ прошла!")
        # записать в базу, отправить email/telegram
    
    return {"received": True}
```

## Безопасность: проверяй подпись

Вебхук — это публичный URL. Кто угодно может отправить туда запрос. Сервисы решают это через подписи: вместе с данными шлют HMAC-подпись, ты проверяешь что она правильная.

**Никогда не обрабатывай вебхук без проверки подписи** если дело касается денег или критичных действий.

```python
import hmac, hashlib

def verify_signature(body: bytes, received_sig: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(received_sig, expected)
```

Секрет вебхука хранишь в `.env` — его даёт сервис при настройке.

## Тестирование вебхука локально

Когда разрабатываешь — сервер у тебя на локальной машине, а Telegram или Stripe не могут достучаться до `localhost`. Используй **ngrok**:

```bash
# Установить
brew install ngrok  # macOS
# или скачать с ngrok.com

# Запустить туннель
ngrok http 8080
```

ngrok даёт тебе временный публичный URL: `https://abc123.ngrok.io` — перенаправляет на твой `localhost:8080`. Указываешь этот URL как вебхук в сервисе и видишь входящие запросы в реальном времени.

::: tip Для постоянной разработки
ngrok бесплатен для тестирования, но URL меняется при каждом запуске. Для стабильного URL — используй свой сервер.
:::

## Логирование входящих запросов

При отладке вебхуков полезно видеть всё что приходит:

```python
import json
from datetime import datetime
from pathlib import Path

async def log_webhook(request: Request, name: str):
    body = await request.json()
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    
    entry = {
        "time": datetime.now().isoformat(),
        "headers": dict(request.headers),
        "body": body,
    }
    
    with open(f"logs/{name}.jsonl", "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
```

JSONL-формат (одна строка = один запрос) удобно читать и фильтровать через `grep`.

## Деплой на сервере

Вебхук-сервер должен работать постоянно — оформи его в systemd:

```ini
[Unit]
Description=Webhook Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/webhook-server
ExecStart=/opt/webhook-server/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8080
Restart=always
EnvironmentFile=/opt/webhook-server/.env

[Install]
WantedBy=multi-user.target
```

В nginx проксируй публичный URL на порт:

```nginx
location /webhook {
    proxy_pass http://localhost:8080/webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

::: info Что дальше?
Вебхуки + [Python-скрипты](/practice/17-python-scripts) = мощная автоматизация: получаешь событие → обрабатываешь → пишешь в базу, шлёшь уведомление, запускаешь скрипт. Для сложных workflow используй [n8n](/practice/05-install-n8n) — там вебхук-нода встроена.
:::
