# Безопасные вебхуки: HMAC-верификация

Вебхук принимает данные из интернета. Без проверки подлинности — любой может слать тебе поддельные запросы. HMAC-подпись решает это за несколько строк.

## Как работает HMAC

1. Отправитель (Stripe, GitHub, Telegram) знает секретный ключ
2. При отправке вычисляет подпись: `HMAC-SHA256(тело_запроса, секретный_ключ)`
3. Добавляет подпись в заголовок
4. Ты на своей стороне вычисляешь то же самое и сравниваешь

Если подпись совпадает — запрос настоящий. Если нет — игнорировать.

## Stripe

Stripe добавляет заголовок `Stripe-Signature` с timestamp и подписью.

```python
from fastapi import FastAPI, Request, HTTPException
import stripe
import os

app = FastAPI()
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    if event["type"] == "payment_intent.succeeded":
        payment = event["data"]["object"]
        await handle_payment(payment)
    
    elif event["type"] == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        await cancel_subscription(subscription)
    
    return {"status": "ok"}


async def handle_payment(payment: dict):
    amount = payment["amount"] / 100  # Stripe в центах
    customer_id = payment.get("customer")
    print(f"Оплата {amount} USD, клиент: {customer_id}")
```

## GitHub

GitHub добавляет `X-Hub-Signature-256: sha256=<hex>`.

```python
import hmac
import hashlib
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
GITHUB_WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET").encode()


def verify_github_signature(payload: bytes, signature: str) -> bool:
    expected = "sha256=" + hmac.new(
        GITHUB_WEBHOOK_SECRET, payload, hashlib.sha256
    ).hexdigest()
    # compare_digest защищает от timing-атак
    return hmac.compare_digest(expected, signature)


@app.post("/webhooks/github")
async def github_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")
    
    if not verify_github_signature(payload, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    event = request.headers.get("X-GitHub-Event")
    data = await request.json()
    
    if event == "push":
        branch = data["ref"].split("/")[-1]
        commits = len(data["commits"])
        pusher = data["pusher"]["name"]
        print(f"Push в {branch}: {commits} коммитов от {pusher}")
    
    elif event == "pull_request":
        action = data["action"]  # opened, closed, merged
        pr_title = data["pull_request"]["title"]
        print(f"PR {action}: {pr_title}")
    
    return {"status": "ok"}
```

## Telegram Payments (кастомный провайдер)

Если используешь кастомный платёжный шлюз с вебхуком:

```python
import hashlib

def verify_telegram_hash(data: dict, bot_token: str) -> bool:
    """Проверить данные от Telegram Login Widget / пр."""
    check_hash = data.pop("hash", "")
    data_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(secret_key, data_string.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, check_hash)
```

## Универсальная функция верификации

```python
import hmac
import hashlib


def verify_hmac(
    payload: bytes,
    secret: str,
    received_signature: str,
    algorithm: str = "sha256",
    prefix: str = ""
) -> bool:
    """
    Универсальная проверка HMAC-подписи.
    prefix: например "sha256=" для GitHub
    """
    key = secret.encode() if isinstance(secret, str) else secret
    expected = prefix + hmac.new(key, payload, getattr(hashlib, algorithm)).hexdigest()
    return hmac.compare_digest(expected, received_signature)
```

Использование:

```python
# Stripe (нет prefix, используй stripe.Webhook.construct_event)
# GitHub
ok = verify_hmac(payload, GITHUB_SECRET, sig, prefix="sha256=")
# Shopify
ok = verify_hmac(payload, SHOPIFY_SECRET, sig, prefix="sha256=")
```

## Дополнительная защита: timestamp

Stripe включает timestamp в подпись — это защищает от **replay-атак**: кто-то перехватил реальный вебхук и шлёт его снова через час.

```python
from datetime import datetime, timezone


def check_timestamp(timestamp: int, tolerance_seconds: int = 300) -> bool:
    """Отклонить запросы старше 5 минут."""
    request_time = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    now = datetime.now(tz=timezone.utc)
    age = abs((now - request_time).total_seconds())
    return age <= tolerance_seconds
```

Stripe делает это автоматически в `construct_event`. Для GitHub — можно добавить вручную если нужно.

## Idempotency: обработать только раз

Вебхуки могут приходить дважды (сеть, ретраи). Защита — проверить что уже обработали:

```python
processed_events = set()  # для прода — Redis

@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    # ... верификация ...
    event_id = event["id"]
    
    if event_id in processed_events:
        return {"status": "already processed"}
    
    processed_events.add(event_id)
    await process_event(event)
    return {"status": "ok"}
```

Redis-вариант с TTL:

```python
import redis.asyncio as redis

r = redis.from_url(os.getenv("REDIS_URL"))


async def is_duplicate(event_id: str) -> bool:
    key = f"webhook:processed:{event_id}"
    # SET NX — только если ключа нет
    result = await r.set(key, "1", ex=86400, nx=True)  # TTL 24ч
    return result is None  # None = ключ уже существовал
```

## Полный пример: FastAPI + Stripe + Redis

```python
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
import stripe
import redis.asyncio as redis
import os

app = FastAPI()
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost"))


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request, background_tasks: BackgroundTasks):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    
    try:
        event = stripe.Webhook.construct_event(payload, sig, WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Idempotency check
    key = f"stripe:processed:{event['id']}"
    if not await r.set(key, "1", ex=86400, nx=True):
        return {"status": "duplicate"}
    
    # Обработать асинхронно чтобы Stripe не ждал
    background_tasks.add_task(process_stripe_event, event)
    return {"status": "ok"}


async def process_stripe_event(event: dict):
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        customer_email = session.get("customer_email")
        amount = session["amount_total"] / 100
        # выдать товар/подписку
        print(f"Checkout completed: {customer_email}, ${amount}")
```

---

::: danger Никогда не пропускай верификацию
Вебхук без проверки подписи = открытая дыра. Любой может запустить твою логику «оплата получена» послав поддельный запрос. Всегда верифицируй, всегда используй `compare_digest`.
:::
