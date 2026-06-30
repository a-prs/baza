# Stripe: приём международных платежей

Stripe — стандарт для приёма карт по всему миру. Работает в РФ через Selectel Payments или напрямую из РБ/Казахстана/Грузии. Разбираем Payment Intents и Subscriptions.

## Установка

```bash
pip install stripe
```

## Базовая настройка

```python
import stripe
import os

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
```

## Payment Intent (разовый платёж)

### Бэкенд: создать платёж

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class CreatePaymentRequest(BaseModel):
    amount: int       # в центах (100 = $1.00)
    currency: str = "usd"
    description: str = ""


@app.post("/create-payment-intent")
async def create_payment_intent(req: CreatePaymentRequest):
    intent = stripe.PaymentIntent.create(
        amount=req.amount,
        currency=req.currency,
        description=req.description,
        automatic_payment_methods={"enabled": True},
        metadata={"source": "web"}
    )
    return {
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id
    }
```

### Фронтенд: Stripe Elements

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://js.stripe.com/v3/"></script>
</head>
<body>
  <form id="payment-form">
    <div id="payment-element"></div>
    <button type="submit">Оплатить $10</button>
    <div id="error-message"></div>
  </form>

  <script>
    const stripe = Stripe('pk_test_...');
    
    // Получить client_secret с бэкенда
    const {client_secret} = await fetch('/create-payment-intent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({amount: 1000, currency: 'usd'})
    }).then(r => r.json());
    
    const elements = stripe.elements({clientSecret: client_secret});
    const paymentElement = elements.create('payment');
    paymentElement.mount('#payment-element');
    
    document.getElementById('payment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const {error} = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment-success`,
        },
      });
      
      if (error) {
        document.getElementById('error-message').textContent = error.message;
      }
    });
  </script>
</body>
</html>
```

## Webhook: обработка событий

```python
from fastapi import Request, HTTPException
import stripe

@app.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    # Обработка событий
    if event["type"] == "payment_intent.succeeded":
        payment_intent = event["data"]["object"]
        await handle_successful_payment(payment_intent)
    
    elif event["type"] == "payment_intent.payment_failed":
        payment_intent = event["data"]["object"]
        await handle_failed_payment(payment_intent)
    
    return {"status": "ok"}


async def handle_successful_payment(payment_intent: dict):
    amount = payment_intent["amount"] / 100  # конвертировать из центов
    customer_id = payment_intent.get("customer")
    metadata = payment_intent.get("metadata", {})
    
    print(f"Оплата ${amount} от клиента {customer_id}")
    # Выдать доступ, обновить БД, отправить письмо...
```

## Subscriptions (подписки)

### Создать продукт и цену

```python
# Создать один раз (можно через Dashboard)
product = stripe.Product.create(name="Pro Plan")
price = stripe.Price.create(
    unit_amount=2000,       # $20.00
    currency="usd",
    recurring={"interval": "month"},
    product=product.id,
)
print(f"Price ID: {price.id}")  # сохрани в .env
```

### Подписать клиента

```python
PRICE_ID = os.getenv("STRIPE_PRICE_ID")  # price_xxxxx из шага выше


@app.post("/subscribe")
async def create_subscription(user_id: int, email: str):
    # Создать или найти Customer
    customers = stripe.Customer.list(email=email).data
    if customers:
        customer = customers[0]
    else:
        customer = stripe.Customer.create(
            email=email,
            metadata={"user_id": str(user_id)}
        )
    
    # Создать checkout-сессию
    session = stripe.checkout.Session.create(
        customer=customer.id,
        payment_method_types=["card"],
        line_items=[{"price": PRICE_ID, "quantity": 1}],
        mode="subscription",
        success_url=f"https://myapp.com/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url="https://myapp.com/cancel",
        metadata={"user_id": str(user_id)}
    )
    
    return {"checkout_url": session.url}
```

### Обработка событий подписки

```python
@app.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    # ... верификация ...
    
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        if session["mode"] == "subscription":
            user_id = session["metadata"]["user_id"]
            subscription_id = session["subscription"]
            await activate_subscription(user_id, subscription_id)
    
    elif event["type"] == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription["customer"]
        await cancel_subscription(customer_id)
    
    elif event["type"] == "invoice.payment_failed":
        invoice = event["data"]["object"]
        customer_id = invoice["customer"]
        await notify_payment_failed(customer_id)
    
    return {"status": "ok"}
```

### Проверить статус подписки

```python
async def is_subscribed(stripe_customer_id: str) -> bool:
    subscriptions = stripe.Subscription.list(
        customer=stripe_customer_id,
        status="active"
    )
    return len(subscriptions.data) > 0


async def get_subscription_info(stripe_customer_id: str) -> dict | None:
    subs = stripe.Subscription.list(customer=stripe_customer_id, status="active")
    if not subs.data:
        return None
    
    sub = subs.data[0]
    return {
        "status": sub.status,
        "current_period_end": sub.current_period_end,
        "cancel_at_period_end": sub.cancel_at_period_end,
    }
```

## Stripe Portal: клиент управляет подпиской сам

```python
@app.get("/billing-portal/{customer_id}")
async def billing_portal(customer_id: str):
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url="https://myapp.com/account",
    )
    return {"url": session.url}
```

Клиент переходит по ссылке → отменяет/обновляет подписку в интерфейсе Stripe.

## Тестовые карты

```
4242 4242 4242 4242 — успешная оплата
4000 0000 0000 0002 — отклонена
4000 0025 0000 3155 — требует 3D Secure

Срок: любой в будущем
CVV: любые 3 цифры
```

## Работа с возвратами

```python
async def refund_payment(payment_intent_id: str, amount: int = None) -> str:
    """
    amount — в центах, None = полный возврат
    """
    params = {"payment_intent": payment_intent_id}
    if amount:
        params["amount"] = amount
    
    refund = stripe.Refund.create(**params)
    return refund.id


# Пример: частичный возврат $5 из $20
refund_id = await refund_payment("pi_xxx", amount=500)
```

## Локальный тест вебхуков

```bash
# Установить Stripe CLI
brew install stripe/stripe-cli/stripe
stripe login

# Форвардить события на localhost
stripe listen --forward-to localhost:8000/webhook/stripe

# В другом терминале — отправить тестовое событие
stripe trigger payment_intent.succeeded
```

---

::: tip Stripe vs ЮКасса
Stripe — международные карты, простой API, отличная документация. ЮКасса — российские карты (Мир), СБП, работает с ИП/ООО без оговорок. Для РФ-аудитории — ЮКасса или оба. Для международной — Stripe.
:::
