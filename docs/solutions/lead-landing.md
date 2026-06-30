# Лендинг с формой и уведомлением в Telegram

Одностраничный сайт с формой заявки. Пользователь заполняет — тебе мгновенно приходит уведомление в Telegram с данными. Без бэкенда и сервера — через Formspree или аналоги.

**Время:** 15–20 минут  
**Стек:** HTML + CSS + JS + Formspree (бесплатно)  
**Нужен:** аккаунт Formspree, Telegram-бот

## Варианты реализации

### Вариант А: Formspree (проще, бесплатно до 50 заявок/мес)

Formspree принимает POST с формы и пересылает на email. Настраивается за 2 минуты.

### Вариант Б: n8n webhook (гибче, без лимитов)

Форма отправляет данные в n8n → n8n пересылает в Telegram. Требует n8n.

## Вариант А: через Formspree

### Шаг 1: Создай аккаунт

Зайди на [formspree.io](https://formspree.io/) → Sign Up → создай форму → получи endpoint URL вида `https://formspree.io/f/xyzabc`.

### Шаг 2: Лендинг

Создай `index.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Автоматизация бизнеса</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #f0f0f0;
      line-height: 1.6;
    }

    .hero {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
      background: radial-gradient(ellipse at top, #1a1a2e 0%, #0f0f0f 60%);
    }

    .badge {
      display: inline-block;
      padding: 6px 16px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 20px;
      font-size: 0.85rem;
      color: #a5b4fc;
      margin-bottom: 24px;
    }

    h1 {
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 20px;
      max-width: 700px;
    }

    h1 span { color: #818cf8; }

    .subtitle {
      font-size: 1.15rem;
      color: #9ca3af;
      max-width: 500px;
      margin-bottom: 40px;
    }

    .form-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 32px;
      width: 100%;
      max-width: 420px;
    }

    .form-card h2 {
      font-size: 1.2rem;
      margin-bottom: 24px;
      color: #e5e7eb;
    }

    input {
      width: 100%;
      padding: 13px 16px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #f0f0f0;
      font-size: 1rem;
      margin-bottom: 12px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #818cf8; }
    input::placeholder { color: #6b7280; }

    button[type="submit"] {
      width: 100%;
      padding: 14px;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 4px;
      transition: background 0.2s;
    }
    button[type="submit"]:hover { background: #5558e8; }

    .success-msg {
      display: none;
      text-align: center;
      padding: 20px 0;
      color: #6ee7b7;
      font-size: 1.1rem;
    }

    .features {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      margin-top: 32px;
      max-width: 600px;
    }
    .feature {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 0.9rem;
      color: #9ca3af;
    }
  </style>
</head>
<body>
<section class="hero">
  <span class="badge">⚡ Результат за 2–4 недели</span>
  
  <h1>Автоматизирую рутину<br><span>с помощью ИИ</span></h1>
  
  <p class="subtitle">
    Боты, интеграции, парсеры — освобождаю вас от задач
    которые можно делегировать машине.
  </p>

  <div class="form-card">
    <h2>Расскажите о задаче</h2>
    
    <form id="lead-form" action="https://formspree.io/f/ВАША_ФОРМА" method="POST">
      <input type="text" name="name" placeholder="Ваше имя" required>
      <input type="tel" name="phone" placeholder="Телефон или Telegram" required>
      <input type="text" name="task" placeholder="Коротко о задаче">
      
      <button type="submit">Получить консультацию →</button>
    </form>
    
    <div class="success-msg" id="success">
      ✅ Заявка отправлена!<br>Свяжусь в течение нескольких часов.
    </div>
  </div>

  <div class="features">
    <div class="feature">🤖 Telegram-боты</div>
    <div class="feature">⚙️ Автоматизации</div>
    <div class="feature">📊 Парсеры данных</div>
    <div class="feature">🔗 Интеграции API</div>
  </div>
</section>

<script>
  document.getElementById('lead-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: data,
        headers: { 'Accept': 'application/json' }
      });
      
      if (res.ok) {
        form.style.display = 'none';
        document.getElementById('success').style.display = 'block';
      } else {
        alert('Ошибка. Напиши напрямую в Telegram.');
      }
    } catch {
      alert('Ошибка отправки. Попробуй ещё раз.');
    }
  });
</script>
</body>
</html>
```

### Шаг 3: Замени endpoint

В строке `action="https://formspree.io/f/ВАША_ФОРМА"` замени `ВАША_ФОРМА` на реальный ID из Formspree.

### Шаг 4: Задеплой

- **Vercel**: подключи GitHub-репо с `index.html` → задеплоится автоматически
- **Netlify**: drag & drop папки в netlify.com/drop

## Вариант Б: через n8n + Telegram

Формой шлёшь данные в n8n-webhook, n8n присылает в Telegram.

### Создай workflow в n8n

1. **Webhook** (метод POST) → скопируй URL
2. **Code**: форматируй сообщение
3. **Telegram**: отправь тебе

```javascript
// Нода Code:
const body = $json.body || $json;
return [{
  json: {
    text: `📋 Новая заявка!\n\n👤 ${body.name}\n📱 ${body.phone}\n💬 ${body.task || '—'}`
  }
}];
```

### В HTML: замени Formspree на n8n URL

```javascript
const res = await fetch('https://n8n.yoursite.com/webhook/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.fromEntries(data))
});
```

## Кастомизация

Все цвета в CSS через переменные — меняй под свой бренд:

```css
/* Основной акцент */
background: #6366f1;   /* → твой цвет */
color: #a5b4fc;        /* → светлый вариант акцента */

/* Фон */
background: #0f0f0f;   /* → твой тёмный фон */
```

---

::: info Что дальше?
Хочешь более сложный лендинг с несколькими секциями — попроси ИИ: «Добавь секции: Проблема → Решение → Кейсы → Форма». Для динамики — [Telegram Mini App](/solutions/telegram-mini-app) внутри мессенджера.
:::
