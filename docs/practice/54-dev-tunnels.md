# Туннели для разработки: тестирование вебхуков локально

Вебхуки (Telegram, Stripe, GitHub) требуют публичный URL. Когда разрабатываешь локально — нужен туннель: временный публичный адрес, проксирующий трафик на localhost.

## ngrok (самый популярный)

```bash
# Установить
brew install ngrok  # macOS
# или скачать с ngrok.com/download

# Зарегистрироваться бесплатно, получить auth token
ngrok config add-authtoken <TOKEN>

# Открыть туннель на порт 8000
ngrok http 8000
```

> 💬 «Установи ngrok и открой туннель на порт 8000 для тестирования вебхуков»

Вывод:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:8000
```

Теперь `https://abc123.ngrok-free.app` доступен из интернета и проксирует на localhost:8000.

### Telegram + ngrok

```python
# Установить вебхук на ngrok-адрес
import httpx
import os

async def set_webhook(ngrok_url: str):
    token = os.getenv("BOT_TOKEN")
    webhook_url = f"{ngrok_url}/webhook"
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json={"url": webhook_url}
        )
        return response.json()

# FastAPI хендлер
from fastapi import FastAPI, Request
from aiogram import Bot, Dispatcher
from aiogram.types import Update

app = FastAPI()
bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

@app.post("/webhook")
async def webhook(request: Request):
    update = Update(**await request.json())
    await dp.feed_update(bot, update)
    return {"ok": True}
```

### ngrok Inspector

Открой `http://localhost:4040` — там веб-интерфейс ngrok с историей запросов. Видишь что пришло, можешь реплеить запросы.

## Cloudflare Tunnel (постоянный URL)

ngrok-free даёт случайный URL при каждом запуске. Cloudflare Tunnel даёт постоянный субдомен на твоём домене — бесплатно.

```bash
# Установить cloudflared
brew install cloudflare/cloudflare/cloudflared

# Авторизоваться
cloudflared tunnel login

# Создать туннель
cloudflared tunnel create dev

# Запустить с конфигом
cat > ~/.cloudflared/config.yaml << EOF
tunnel: <tunnel-id>
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: dev.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
EOF

cloudflared tunnel route dns dev dev.yourdomain.com
cloudflared tunnel run dev
```

> 💬 «Настрой Cloudflare Tunnel с постоянным субдоменом dev.yourdomain.com на localhost:8000»

Теперь `https://dev.yourdomain.com` → localhost:8000, всегда один и тот же адрес.

## localtunnel (без регистрации)

```bash
npm install -g localtunnel
lt --port 8000 --subdomain mybot  # https://mybot.loca.lt
```

> 💬 «Установи localtunnel и открой туннель с постоянным субдоменом»

Бесплатно, без регистрации, но нестабильно.

## Stripe + туннель

```bash
# Лучший вариант для Stripe — Stripe CLI
brew install stripe/stripe-cli/stripe
stripe login

# Форвардить Stripe-события на localhost
stripe listen --forward-to localhost:8000/webhook/stripe

# Тест конкретного события
stripe trigger payment_intent.succeeded
```

> 💬 «Запусти Stripe CLI и форвардируй вебхуки на localhost для тестирования»

Stripe CLI сам создаёт WEBHOOK_SECRET для локальной разработки:
```
Ready! Your webhook signing secret is 'whsec_test_xxx' (^C to quit)
```

## Скрипт для быстрого старта (dev.sh)

```bash
#!/bin/bash
# Запустить бота с туннелем

# Запустить ngrok в фоне
ngrok http 8000 --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Подождать пока ngrok запустится
sleep 2

# Получить публичный URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)['tunnels']
print(next(t['public_url'] for t in tunnels if t['proto'] == 'https'))
")

echo "Tunnel URL: $NGROK_URL"

# Установить вебхук
python3 -c "
import asyncio, httpx, os
from dotenv import load_dotenv
load_dotenv()

async def main():
    token = os.getenv('BOT_TOKEN')
    r = await httpx.AsyncClient().post(
        f'https://api.telegram.org/bot{token}/setWebhook',
        json={'url': '${NGROK_URL}/webhook'}
    )
    print(r.json())

asyncio.run(main())
"

# Запустить бота
python bot.py

# При выходе — убить ngrok
kill $NGROK_PID
```

> 💬 «Создай скрипт dev.sh который запускает ngrok, ставит вебхук и запускает бота»

## .env для разработки

```bash
# .env.dev — для локальной разработки
BOT_TOKEN=your_token
WEBHOOK_MODE=false  # использовать long polling локально

# Или
WEBHOOK_URL=https://your-ngrok-url.ngrok-free.app
```

> 💬 «Добавь переключение между webhook и long polling через переменную WEBHOOK_MODE в .env»

```python
# bot.py — выбор режима по env
import os

WEBHOOK_MODE = os.getenv("WEBHOOK_MODE", "false").lower() == "true"

async def main():
    if WEBHOOK_MODE:
        # Продакшн: вебхук
        app = create_fastapi_app()
        await set_webhook(os.getenv("WEBHOOK_URL"))
        uvicorn.run(app, host="0.0.0.0", port=8000)
    else:
        # Разработка: long polling
        await dp.start_polling(bot)
```

## Сравнение инструментов

| Инструмент | Постоянный URL | Без регистрации | Stripe-интеграция | Платно |
|---|---|---|---|---|
| ngrok free | ❌ (меняется) | ❌ | ✅ | ✅ (pro) |
| ngrok paid | ✅ | ❌ | ✅ | $8/мес |
| Cloudflare Tunnel | ✅ | ❌ | ⚠️ настройка | Бесплатно |
| localtunnel | ❌ | ✅ | ✅ | Бесплатно |
| Stripe CLI | — | ❌ | ✅ | Бесплатно |

**Рекомендация:**
- Telegram-бот: ngrok free (URL меняется — скрипт переустанавливает вебхук)
- Stripe: Stripe CLI (самый удобный)
- Постоянный dev-URL: Cloudflare Tunnel на своём домене

---

::: tip Long polling для боботов
Для Telegram-бота в разработке проще использовать long polling (`dp.start_polling()`), а не вебхук. Long polling не требует публичного URL и работает из любой сети. Переключай на вебхук только на проде.
:::
