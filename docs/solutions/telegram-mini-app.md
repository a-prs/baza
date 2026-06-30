# Telegram Mini App: веб-приложение в мессенджере

Telegram Mini App — это обычный веб-сайт который открывается прямо внутри Telegram через кнопку в боте. Пользователь не выходит из мессенджера. Удобно для форм, каталогов, опросов, калькуляторов.

**Время настройки:** 30–45 минут  
**Стек:** HTML + JS + Python FastAPI (backend) + Vercel (фронтенд)  
**Нужен:** Telegram-бот, Vercel-аккаунт

## Что получится

Пользователь пишет `/start` → бот присылает кнопку «Открыть форму» → Telegram открывает твой веб-сайт в попапе → пользователь заполняет форму → данные приходят тебе в Telegram.

## Как это работает

Mini App — это просто URL. Telegram открывает его в WebView (встроенный браузер). На странице подключаешь `telegram-web-app.js` — он даёт доступ к данным пользователя и кнопке «Закрыть».

```
Пользователь → Telegram-бот (кнопка) → твой сайт → BackendAPI → уведомление в Telegram
```

## Шаг 1: Создай фронтенд

Создай файл `index.html` — это и есть твой Mini App:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Заявка</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, sans-serif;
      background: var(--tg-theme-bg-color, #fff);
      color: var(--tg-theme-text-color, #000);
      padding: 20px;
      min-height: 100vh;
    }
    h1 { font-size: 1.3rem; margin-bottom: 20px; }
    label { display: block; margin-bottom: 6px; font-size: 0.9rem; color: #666; }
    input, textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 1rem;
      margin-bottom: 16px;
      background: var(--tg-theme-secondary-bg-color, #f5f5f5);
    }
    button {
      width: 100%;
      padding: 14px;
      background: var(--tg-theme-button-color, #2481cc);
      color: var(--tg-theme-button-text-color, #fff);
      border: none;
      border-radius: 10px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    .success { text-align: center; padding: 40px 20px; display: none; }
    .success h2 { margin-bottom: 10px; }
  </style>
</head>
<body>
  <div id="form-view">
    <h1>Оставить заявку</h1>
    
    <label>Имя</label>
    <input type="text" id="name" placeholder="Иван Иванов">
    
    <label>Телефон</label>
    <input type="tel" id="phone" placeholder="+7 999 000 00 00">
    
    <label>Комментарий</label>
    <textarea id="comment" rows="3" placeholder="Кратко опишите задачу"></textarea>
    
    <button onclick="submitForm()">Отправить заявку</button>
  </div>
  
  <div class="success" id="success-view">
    <h2>✅ Заявка отправлена!</h2>
    <p>Мы свяжемся с вами в ближайшее время.</p>
  </div>

<script>
  const tg = window.Telegram.WebApp;
  tg.expand(); // развернуть на весь экран

  async function submitForm() {
    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const comment = document.getElementById("comment").value.trim();
    
    if (!name || !phone) {
      alert("Заполни имя и телефон");
      return;
    }
    
    const data = {
      name,
      phone,
      comment,
      user_id: tg.initDataUnsafe?.user?.id,
      username: tg.initDataUnsafe?.user?.username,
    };
    
    try {
      const response = await fetch("https://api.mysite.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (response.ok) {
        document.getElementById("form-view").style.display = "none";
        document.getElementById("success-view").style.display = "block";
        setTimeout(() => tg.close(), 2000); // закрыть через 2 сек
      }
    } catch (e) {
      alert("Ошибка отправки. Попробуй ещё раз.");
    }
  }
</script>
</body>
</html>
```

## Шаг 2: Задеплой на Vercel

1. Создай репозиторий на GitHub с `index.html`
2. Зайди на vercel.com → New Project → выбери репо
3. Framework Preset: **Other** (просто статика)
4. Deploy

Получишь URL: `https://my-mini-app.vercel.app`

## Шаг 3: Backend для получения заявок

```python
# main.py (FastAPI)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import os

app = FastAPI()

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
ADMIN_CHAT_ID = os.getenv("ADMIN_CHAT_ID")

class Lead(BaseModel):
    name: str
    phone: str
    comment: str = ""
    user_id: int | None = None
    username: str | None = None

@app.post("/submit")
async def submit_lead(lead: Lead):
    tg_username = f"@{lead.username}" if lead.username else f"id:{lead.user_id}"
    
    message = (
        f"📋 Новая заявка!\n\n"
        f"👤 {lead.name}\n"
        f"📱 {lead.phone}\n"
        f"💬 {lead.comment or '—'}\n\n"
        f"Telegram: {tg_username}"
    )
    
    async with httpx.AsyncClient() as client:
        await client.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": ADMIN_CHAT_ID, "text": message}
        )
    
    return {"ok": True}
```

Задеплои на Railway или Render — получи URL `https://api.mysite.com`.

Обнови в `index.html` строку `fetch("https://api.mysite.com/submit", ...)`.

## Шаг 4: Бот с кнопкой

```python
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

MINI_APP_URL = "https://my-mini-app.vercel.app"

@dp.message(Command("start"))
async def start(message: Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="📋 Оставить заявку",
            web_app=WebAppInfo(url=MINI_APP_URL)
        )
    ]])
    await message.answer(
        "Привет! Нажми кнопку чтобы оставить заявку:",
        reply_markup=keyboard
    )
```

## Шаг 5: Обязательно — HTTPS

Mini App работает только через HTTPS. Vercel даёт HTTPS автоматически. Backend на Railway/Render — тоже.

Если деплоишь на свой сервер — нужен Certbot:
```bash
certbot --nginx -d api.mysite.com
```

## Темы Telegram

Mini App автоматически подстраивается под тему пользователя (светлая/тёмная) через CSS-переменные:

```css
background: var(--tg-theme-bg-color);
color: var(--tg-theme-text-color);
```

Не нужно дополнительного кода — уже в шаблоне выше.

## Идеи что сделать

- **Форма заявки** — имя, телефон, описание
- **Калькулятор** — считает стоимость прямо в Telegram
- **Опрос/анкета** — несколько вопросов со звёздочками
- **Каталог товаров** — список с фото и кнопкой "Заказать"
- **Запись на приём** — выбор даты и времени

---

::: info Связанные материалы
- [Telegram-бот с нуля](/practice/11-telegram-bot) — основы aiogram
- [FastAPI](/practice/24-fastapi) — создание backend API
- [Деплой без сервера](/practice/20-deploy-platforms) — Vercel, Railway, Render
:::
