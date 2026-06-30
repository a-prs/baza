# AI-дайджест: n8n + OpenAI → Telegram

Workflow который каждое утро собирает новости из RSS, суммаризирует их через OpenAI и присылает красивый дайджест в Telegram. Полностью без кода — только n8n.

**Время настройки:** 20–30 минут  
**Стек:** n8n + OpenAI API + Telegram Bot  
**Нужен:** n8n (установленный), Telegram-бот, OpenAI API key

## Что получится

Каждое утро в 8:00 в Telegram приходит сообщение:

```
📰 Дайджест AI-новостей | 30 июня

🔹 OpenAI выпустила новую модель
Кратко: Новая модель GPT-5 превосходит предыдущие по
бенчмаркам на 40%...

🔹 Google анонсировал Gemini Ultra 2
Кратко: Поддержка мультимодальности и контекст 2М токенов...

🔹 Anthropic получила $2B инвестиций
Кратко: Раунд C при оценке $40B, деньги пойдут на...

Всего статей: 12 | Показаны топ-3
```

## Шаг 1: Создай Telegram-бота

Если бот уже есть — пропусти. Получи токен через `@BotFather` и узнай свой Chat ID через `@userinfobot`.

## Шаг 2: Получи OpenAI API key

На [platform.openai.com](https://platform.openai.com/) → API keys → Create new secret key. Стоимость дайджеста: ~$0.01–0.05 в день на GPT-4o-mini.

## Шаг 3: Собери workflow в n8n

Открой n8n → **New Workflow**. Добавляй ноды по одной.

### Нода 1: Schedule Trigger

- **Нода:** Schedule Trigger
- **Настройка:** Every Day at 8:00

### Нода 2: RSS Read

- **Нода:** RSS Read
- **URL:** URL RSS-ленты (например: `https://feeds.feedburner.com/TechCrunch`)
- **Limit:** 20

Можно добавить несколько RSS-нод и объединить через Merge (режим Append).

### Нода 3: Code (фильтр свежих)

Добавь ноду **Code** чтобы брать только статьи за последние 24 часа:

```javascript
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

return $input.all().filter(item => {
  const pubDate = new Date(item.json.pubDate || item.json.isoDate);
  return pubDate > oneDayAgo;
}).slice(0, 10); // не больше 10 статей
```

### Нода 4: OpenAI (суммаризация)

- **Нода:** OpenAI → **Message a model**
- **Model:** gpt-4o-mini (дешевле, быстрее)
- **Messages → User:**

```
Суммаризируй эту новость в 2 предложения на русском языке.
Факты и цифры — сохрани. Воду убери.

Заголовок: {{ $json.title }}
Текст: {{ $json.contentSnippet }}
```

### Нода 5: Aggregate (собрать все в одно)

- **Нода:** Aggregate
- **Aggregate:** All Item Data (Into a Single List)

### Нода 6: Code (собрать дайджест)

```javascript
const items = $input.first().json.data;
const today = new Date().toLocaleDateString('ru-RU', {
  day: 'numeric', month: 'long'
});

let digest = `📰 Дайджест AI-новостей | ${today}\n\n`;

items.slice(0, 5).forEach(item => {
  digest += `🔹 ${item.title}\n`;
  digest += `${item.message.content}\n\n`;
});

digest += `Всего статей: ${items.length} | Показаны топ-${Math.min(5, items.length)}`;

return [{ json: { text: digest } }];
```

### Нода 7: Telegram

- **Нода:** Telegram → **Send Message**
- **Chat ID:** твой Chat ID
- **Text:** `{{ $json.text }}`

## Шаг 4: Настрой credentials

В n8n: Settings → Credentials.

**OpenAI:**
1. New Credential → OpenAI
2. API Key: вставь ключ

**Telegram:**
1. New Credential → Telegram API
2. Access Token: вставь токен бота

Вернись к нодам OpenAI и Telegram — выбери созданные credentials.

## Шаг 5: Активируй workflow

**Save** → переключи **Active** в правом верхнем углу.

Для немедленного теста: кнопка **Test workflow** — прогонит один раз.

## Расширения

### Несколько RSS-источников

Добавь 3-5 RSS-нод перед Code-нодой фильтрации:
```
[RSS: TechCrunch] ↘
[RSS: Hacker News] → [Merge: Append] → [Code: filter] → ...
[RSS: AI News]    ↗
```

### Категоризация по темам

Вместо одного вызова OpenAI — добавь перед суммаризацией категоризатор:

```
Определи категорию новости одним словом: AI / Бизнес / Технологии / Другое.
Заголовок: {{ $json.title }}
```

Затем через IF-ноду разветви по категориям — в дайджест попадут только нужные.

### HTML-форматирование

Telegram поддерживает HTML:

```javascript
digest += `<b>${item.title}</b>\n`;
digest += `<i>${item.message.content}</i>\n\n`;
```

В ноде Telegram: **Parse Mode** → HTML.

### Отправка в канал

Замени Chat ID на ID канала (`-1001234567890`). Бот должен быть администратором канала.

## Варианты RSS-источников

**AI/Tech:**
- TechCrunch: `https://techcrunch.com/feed/`
- Hacker News (топ): `https://news.ycombinator.com/rss`
- MIT Technology Review: `https://www.technologyreview.com/feed/`
- VentureBeat AI: `https://venturebeat.com/category/ai/feed/`

**Русскоязычные:**
- Habr: `https://habr.com/ru/rss/best/daily/`
- vc.ru: `https://vc.ru/rss`

---

::: info Связанные материалы
- [Установка n8n](/practice/05-install-n8n) — если n8n ещё не установлен
- [MCP-сервер n8n](/practice/06-mcp-n8n-setup) — управлять workflow через Claude
- [RSS-бот в Telegram](/solutions/rss-bot) — более простой вариант без AI
:::
