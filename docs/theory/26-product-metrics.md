# Метрики продукта

Без метрик разработка — гадание. Что мерить, как считать и как принимать решения по данным. Минимальный набор для indie AI-продукта.

## Воронка: от посетителя к платящему

```
Трафик → Регистрация → Активация → Удержание → Монетизация

Типичные конверсии для Telegram-ботов:
Клик по ссылке → /start:     60-80%
/start → первый результат:   40-60%  (активация)
Активированный → платит:     2-8%
Платный → продлевает:        60-80%/мес
```

Найди слабое звено и чини его — не усиливай трафик в дырявую воронку.

## Ключевые метрики (пять важнейших)

### 1. MAU / DAU (активность)

```sql
-- MAU: уникальные пользователи за 30 дней
SELECT COUNT(DISTINCT user_id) as mau
FROM events
WHERE created_at >= date('now', '-30 days');

-- DAU: за сегодня
SELECT COUNT(DISTINCT user_id) as dau
FROM events
WHERE date(created_at) = date('now');

-- DAU/MAU ratio: вовлечённость (норма 10-20%, хорошо 20-30%)
```

### 2. Retention (удержание)

Day-N Retention: какой % пользователей вернулся на N-й день после первого использования.

```sql
-- D7 Retention (неделя)
SELECT
    COUNT(DISTINCT CASE WHEN e2.user_id IS NOT NULL THEN e1.user_id END) * 100.0
    / COUNT(DISTINCT e1.user_id) as d7_retention_pct
FROM (
    -- Когорта: первые сессии за прошлую неделю
    SELECT user_id, MIN(date(created_at)) as first_day
    FROM events
    GROUP BY user_id
    HAVING MIN(date(created_at)) BETWEEN date('now', '-14 days') AND date('now', '-7 days')
) e1
LEFT JOIN events e2 ON e2.user_id = e1.user_id
    AND date(e2.created_at) = date(e1.first_day, '+7 days');
```

**Ориентиры:**
- D1: >40% — хорошо
- D7: >20% — хорошо
- D30: >10% — хорошо

### 3. Churn (отток)

```python
# Ежемесячный churn
# Сколько % платящих отменили в этом месяце

def monthly_churn(paid_start: int, cancelled_this_month: int) -> float:
    return cancelled_this_month / paid_start * 100

# Если churn > 5%/мес → фокус на удержание, не рост
# Если churn < 2%/мес → можно масштабировать привлечение
```

### 4. LTV (пожизненная ценность)

```python
# Упрощённый LTV
def ltv(avg_monthly_revenue: float, monthly_churn_rate: float) -> float:
    # Средняя продолжительность жизни клиента = 1 / churn
    avg_lifetime_months = 1 / monthly_churn_rate
    return avg_monthly_revenue * avg_lifetime_months

# Пример: 499₽/мес, churn 8% → LTV = 499 / 0.08 = 6 237₽
```

### 5. CAC (стоимость привлечения)

```python
# CAC = деньги потраченные на маркетинг / новые платные пользователи

def cac(marketing_spend: float, new_paying_users: int) -> float:
    return marketing_spend / new_paying_users

# Правило: LTV/CAC > 3 — продукт масштабируем
# LTV/CAC < 1 — теряешь деньги на каждом клиенте
```

## Как считать в SQLite

```sql
-- Создать таблицу событий
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,  -- 'start', 'request', 'paid', 'cancelled'
    properties TEXT,           -- JSON с деталями
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для быстрых запросов
CREATE INDEX idx_events_user ON events(user_id);
CREATE INDEX idx_events_type ON events(event_type, created_at);
```

```python
import json
import aiosqlite


async def track(user_id: int, event_type: str, properties: dict = None):
    async with aiosqlite.connect("analytics.db") as db:
        await db.execute(
            "INSERT INTO events (user_id, event_type, properties) VALUES (?,?,?)",
            (user_id, event_type, json.dumps(properties or {}))
        )
        await db.commit()


# Использование
await track(user_id, "message_sent", {"has_ai": True})
await track(user_id, "payment", {"plan": "monthly", "amount": 499})
await track(user_id, "cancelled", {"reason": "too_expensive"})
```

## Еженедельный отчёт (автоматически)

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import aiosqlite


async def weekly_report(bot, admin_chat_id: int):
    async with aiosqlite.connect("analytics.db") as db:
        # MAU
        mau = await db.execute_fetchall(
            "SELECT COUNT(DISTINCT user_id) FROM events WHERE created_at >= date('now', '-30 days')"
        )
        
        # Новые за неделю
        new_users = await db.execute_fetchall(
            """SELECT COUNT(*) FROM (
                SELECT user_id, MIN(created_at) as first_seen
                FROM events GROUP BY user_id
                HAVING first_seen >= date('now', '-7 days')
            )"""
        )
        
        # Новые платящие
        new_paid = await db.execute_fetchall(
            "SELECT COUNT(DISTINCT user_id) FROM events WHERE event_type='payment' AND created_at >= date('now', '-7 days')"
        )
        
        # Отток
        cancelled = await db.execute_fetchall(
            "SELECT COUNT(*) FROM events WHERE event_type='cancelled' AND created_at >= date('now', '-7 days')"
        )
    
    report = (
        f"📊 Недельный отчёт\n\n"
        f"👥 MAU: {mau[0][0]}\n"
        f"🆕 Новых за неделю: {new_users[0][0]}\n"
        f"💳 Новых платящих: {new_paid[0][0]}\n"
        f"❌ Отменили: {cancelled[0][0]}\n"
    )
    
    await bot.send_message(admin_chat_id, report)


scheduler = AsyncIOScheduler()
scheduler.add_job(weekly_report, "cron", day_of_week="mon", hour=9, args=[bot, ADMIN_ID])
```

## A/B тестирование

```python
import hashlib


def ab_group(user_id: int, test_name: str, variants: int = 2) -> int:
    """Детерминированно распределить пользователя в группу."""
    key = f"{test_name}:{user_id}"
    hash_val = int(hashlib.md5(key.encode()).hexdigest(), 16)
    return hash_val % variants


# Пример: тест разных приветствий
async def send_welcome(message: Message):
    group = ab_group(message.from_user.id, "welcome_v2")
    
    if group == 0:
        text = "Привет! Я помогу автоматизировать твой бизнес."
    else:
        text = "Сэкономь 3 часа в день. Попробуй AI-помощника."
    
    await message.answer(text)
    await track(message.from_user.id, "welcome_shown", {"variant": group})
```

## Что смотреть первым

```
Продукт только запущен:
□ Activation rate (доходят ли до первого результата)
□ Где бросают (хендлеры без ответа в логах)

Есть 50+ активных пользователей:
□ D7 Retention
□ Конверсия в платных

Есть платящие:
□ Churn/мес
□ LTV vs CAC

Растёте:
□ Revenue MoM (рост выручки месяц к месяцу)
□ NPS (раз в квартал ручной опрос)
```

---

::: tip Не усложняй
Для начала хватит одной таблицы `events` и 3 SQL-запросов на Retention, MAU, конверсию в платных. Дашборды и аналитические платформы — потом, когда метрики станут критически важными для решений.
:::
