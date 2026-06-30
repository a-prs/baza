# Отправка email из Python

Telegram — главный канал, но email по-прежнему нужен: welcome-письма, сброс пароля, транзакционные уведомления, рассылки. Разберём варианты от простого к сложному.

## SMTP: отправка через Gmail

Самый простой путь — через свою почту. Подходит для небольших объёмов (до ~500 писем/день):

```python
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

def send_email(to: str, subject: str, html_body: str, text_body: str = ""):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = os.getenv("EMAIL_FROM")
    msg["To"] = to

    # Текстовая версия (фолбэк)
    if text_body:
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
    
    # HTML-версия
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(os.getenv("EMAIL_FROM"), os.getenv("EMAIL_PASS"))
        server.sendmail(os.getenv("EMAIL_FROM"), to, msg.as_string())
```

`.env`:
```
EMAIL_FROM=your@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop   # App Password, не обычный пароль
```

::: warning Gmail App Password
Обычный пароль не работает — нужен App Password. Включи двухфакторку в Google-аккаунте → «Безопасность» → «Пароли приложений» → создай. Получишь 16-символьный пароль.
:::

### Простой пример использования

```python
send_email(
    to="client@example.com",
    subject="Добро пожаловать!",
    html_body="<h1>Привет!</h1><p>Ваш аккаунт создан.</p>",
    text_body="Привет! Ваш аккаунт создан."
)
```

## Шаблон HTML-письма

Письма должны работать в старых клиентах (Outlook, Apple Mail) — только inline-стили, никаких CSS-классов:

```python
def welcome_email(name: str, login_url: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="600" style="background: white; border-radius: 8px; padding: 40px;">
          <tr>
            <td>
              <h1 style="color: #333; margin-top: 0;">Привет, {name}!</h1>
              <p style="color: #666; line-height: 1.6;">
                Рады видеть тебя. Аккаунт создан и готов к работе.
              </p>
              <a href="{login_url}" style="
                display: inline-block;
                padding: 14px 28px;
                background: #2563eb;
                color: white;
                text-decoration: none;
                border-radius: 6px;
                font-weight: bold;
                margin: 20px 0;
              ">Войти в аккаунт</a>
              <p style="color: #999; font-size: 13px;">
                Если не регистрировались — просто проигнорируйте это письмо.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""
```

## SendGrid: для реальных рассылок

Gmail хорош для 5–50 писем/день. Для тысяч писем — нужен специализированный сервис. SendGrid бесплатен до 100 писем/день:

```bash
pip install sendgrid
```

```python
import os
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

def send_via_sendgrid(to: str, subject: str, html: str):
    message = Mail(
        from_email=os.getenv("FROM_EMAIL"),
        to_emails=to,
        subject=subject,
        html_content=html,
    )
    sg = SendGridAPIClient(os.getenv("SENDGRID_API_KEY"))
    sg.send(message)
```

SendGrid даёт: статистику доставки, обработку отказов, трекинг открытий, webhooks. Получить API-ключ: `app.sendgrid.com` → Settings → API Keys.

## Mailgun: российская альтернатива

```bash
pip install requests
```

```python
import requests
import os

def send_via_mailgun(to: str, subject: str, html: str):
    domain = os.getenv("MAILGUN_DOMAIN")
    r = requests.post(
        f"https://api.mailgun.net/v3/{domain}/messages",
        auth=("api", os.getenv("MAILGUN_API_KEY")),
        data={
            "from": f"Мой сервис <noreply@{domain}>",
            "to": to,
            "subject": subject,
            "html": html,
        },
    )
    r.raise_for_status()
```

## Массовая рассылка с паузами

Если отправляешь много писем через SMTP сам — обязательно делай паузы, иначе попадёшь в спам:

```python
import time
import asyncio

async def send_bulk(recipients: list[str], subject: str, html_template: str):
    """Рассылка с паузой 1 секунда между письмами"""
    sent = 0
    errors = []
    
    for email in recipients:
        try:
            send_email(email, subject, html_template)
            sent += 1
            await asyncio.sleep(1)  # пауза
        except Exception as e:
            errors.append((email, str(e)))
    
    print(f"Отправлено: {sent}, ошибок: {len(errors)}")
    return sent, errors
```

## Уведомления из бота

Частый паттерн: пользователь делает действие в боте → письмо на email:

```python
from aiogram import Router
from aiogram.types import Message
from aiogram.filters import Command

router = Router()

@router.message(Command("subscribe"))
async def cmd_subscribe(message: Message):
    # Здесь получаем email из сообщения или FSM
    email = extract_email(message.text)
    if not email:
        await message.answer("Напишите ваш email:")
        return
    
    # Отправить welcome-письмо
    html = welcome_email(name=message.from_user.first_name, login_url="https://example.com")
    send_email(to=email, subject="Добро пожаловать!", html_body=html)
    
    await message.answer(f"Письмо отправлено на {email}")
```

## Промпт для создания email-системы

```
Добавь в Telegram-бота отправку welcome-письма при регистрации.
Стек: aiogram 3, SMTP через Gmail, шаблон на чистом HTML с inline-стилями.

Логика:
1. Команда /register — запрашивает имя (FSM state waiting_name)
2. Имя получено — запрашивает email (FSM state waiting_email)
3. Email получен — сохранить в SQLite, отправить welcome-письмо, показать подтверждение

Шаблон письма: приветствие с именем + кнопка "Открыть сервис".
Email-функция — отдельный модуль email_sender.py.
```

---

::: info Выбор сервиса
- **Gmail SMTP** — бесплатно, для небольших объёмов и уведомлений
- **SendGrid** — от 100 до 40 000 писем/день бесплатно, есть аналитика
- **Mailgun** — хорошая доставляемость, гибкие планы
- **Resend** — новый сервис, отличный API для разработчиков, 3000 писем/мес бесплатно
:::
