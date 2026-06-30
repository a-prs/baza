# Реферальная программа в боте

Пользователь приглашает друзей — получает бонус (бесплатные дни, скидку, Stars). Вирусный рост без затрат на рекламу.

## Логика

```
Пользователь A → /referral → получает уникальную ссылку
Пользователь B переходит по ссылке → /start ref_A
    ↓
B проходит онбординг → регистрируется
    ↓
A получает бонус (например +7 дней Premium)
B получает приветственный бонус (например +3 дня Premium)
```

## Структура

```
referral-bot/
├── bot.py
├── db.py
├── rewards.py   # логика начисления бонусов
├── .env
└── requirements.txt
```

## База данных (db.py)

```python
import aiosqlite
import secrets
import os
from datetime import datetime, timedelta

DB_PATH = os.getenv("DB_PATH", "referral.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id INTEGER PRIMARY KEY,
                username TEXT,
                referral_code TEXT UNIQUE,
                referred_by INTEGER,  -- telegram_id того кто пригласил
                premium_until TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS referrals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer_id INTEGER,   -- кто пригласил
                referee_id INTEGER,    -- кого пригласили
                bonus_days INTEGER,    -- сколько дней начислено реферреру
                rewarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(referee_id)     -- один пользователь = одна реферальная связь
            )
        """)
        await db.commit()


def generate_code() -> str:
    return secrets.token_urlsafe(6).upper()[:8]


async def get_or_create_user(telegram_id: int, username: str = "", referred_by_code: str = "") -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        row = await db.execute_fetchone(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        
        if row:
            return dict(row)
        
        # Новый пользователь
        code = generate_code()
        while await db.execute_fetchone("SELECT 1 FROM users WHERE referral_code = ?", (code,)):
            code = generate_code()
        
        # Найти реферрера по коду
        referrer_id = None
        if referred_by_code:
            ref_row = await db.execute_fetchone(
                "SELECT telegram_id FROM users WHERE referral_code = ?", (referred_by_code,)
            )
            if ref_row and ref_row[0] != telegram_id:
                referrer_id = ref_row[0]
        
        await db.execute(
            "INSERT INTO users (telegram_id, username, referral_code, referred_by) VALUES (?,?,?,?)",
            (telegram_id, username or "", code, referrer_id)
        )
        await db.commit()
        
        row = await db.execute_fetchone("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
        return dict(row)


async def award_referral_bonus(referee_id: int, referrer_id: int, referrer_days: int = 7, referee_days: int = 3):
    """Начислить бонус реферреру и новому пользователю."""
    async with aiosqlite.connect(DB_PATH) as db:
        # Проверить что не было бонуса
        exists = await db.execute_fetchone(
            "SELECT 1 FROM referrals WHERE referee_id = ?", (referee_id,)
        )
        if exists:
            return False  # уже начислено
        
        now = datetime.now()
        
        # Начислить реферреру
        referrer = await db.execute_fetchone(
            "SELECT premium_until FROM users WHERE telegram_id = ?", (referrer_id,)
        )
        if referrer and referrer[0]:
            current = datetime.fromisoformat(referrer[0])
            new_until = max(current, now) + timedelta(days=referrer_days)
        else:
            new_until = now + timedelta(days=referrer_days)
        
        await db.execute(
            "UPDATE users SET premium_until = ? WHERE telegram_id = ?",
            (new_until.isoformat(), referrer_id)
        )
        
        # Начислить новому пользователю
        referee_until = (now + timedelta(days=referee_days)).isoformat()
        await db.execute(
            "UPDATE users SET premium_until = ? WHERE telegram_id = ?",
            (referee_until, referee_id)
        )
        
        # Записать факт
        await db.execute(
            "INSERT INTO referrals (referrer_id, referee_id, bonus_days) VALUES (?,?,?)",
            (referrer_id, referee_id, referrer_days)
        )
        
        await db.commit()
        return True


async def get_referral_stats(telegram_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        user = await db.execute_fetchone(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        )
        
        count = await db.execute_fetchone(
            "SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (telegram_id,)
        )
        total_days = await db.execute_fetchone(
            "SELECT SUM(bonus_days) FROM referrals WHERE referrer_id = ?", (telegram_id,)
        )
        
        premium_until = None
        if user["premium_until"]:
            until = datetime.fromisoformat(user["premium_until"])
            if until > datetime.now():
                premium_until = until
        
        return {
            "code": user["referral_code"],
            "invites": count[0] or 0,
            "total_bonus_days": total_days[0] or 0,
            "premium_until": premium_until,
        }
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message
from aiogram.filters import Command

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

BOT_USERNAME = os.getenv("BOT_USERNAME")  # @yourbot без @
REFERRER_BONUS_DAYS = int(os.getenv("REFERRER_BONUS", "7"))
REFEREE_BONUS_DAYS = int(os.getenv("REFEREE_BONUS", "3"))

from db import init_db, get_or_create_user, award_referral_bonus, get_referral_stats


@dp.message(Command("start"))
async def cmd_start(message: Message):
    user_id = message.from_user.id
    username = message.from_user.username or ""
    
    # Извлечь реферальный код из /start <code>
    args = message.text.split()
    ref_code = args[1] if len(args) > 1 else ""
    
    user = await get_or_create_user(user_id, username, ref_code)
    
    # Если новый пользователь с реферральным кодом — начислить бонусы
    is_new = user.get("referred_by") == (user.get("telegram_id"))  # только что создан
    if ref_code and user.get("referred_by"):
        rewarded = await award_referral_bonus(
            referee_id=user_id,
            referrer_id=user["referred_by"],
            referrer_days=REFERRER_BONUS_DAYS,
            referee_days=REFEREE_BONUS_DAYS
        )
        if rewarded:
            await message.answer(
                f"🎁 Ты пришёл по приглашению!\n"
                f"Тебе начислено {REFEREE_BONUS_DAYS} дней Premium бесплатно."
            )
            # Уведомить реферрера
            try:
                await bot.send_message(
                    user["referred_by"],
                    f"🎉 Твой друг @{username or 'пользователь'} зарегистрировался!\n"
                    f"Тебе начислено +{REFERRER_BONUS_DAYS} дней Premium."
                )
            except Exception:
                pass  # реферрер заблокировал бота
    
    await message.answer(
        f"Привет! Я AI-ассистент.\n\n"
        f"/referral — пригласить друзей и получить бонус\n"
        f"/status — твой статус Premium"
    )


@dp.message(Command("referral", "invite", "ref"))
async def cmd_referral(message: Message):
    stats = await get_referral_stats(message.from_user.id)
    
    link = f"https://t.me/{BOT_USERNAME}?start={stats['code']}"
    
    premium_text = ""
    if stats["premium_until"]:
        days_left = (stats["premium_until"] - datetime.now()).days
        premium_text = f"\n✨ Premium активен ещё {days_left} дн."
    
    await message.answer(
        f"🔗 Твоя реферральная ссылка:\n"
        f"`{link}`\n\n"
        f"За каждого приглашённого:\n"
        f"• Ты получаешь +{REFERRER_BONUS_DAYS} дней Premium\n"
        f"• Друг получает +{REFEREE_BONUS_DAYS} дня бесплатно\n\n"
        f"📊 Твоя статистика:\n"
        f"Приглашено: {stats['invites']} чел.\n"
        f"Бонусных дней получено: {stats['total_bonus_days']}"
        f"{premium_text}",
        parse_mode="Markdown"
    )


@dp.message(Command("status"))
async def cmd_status(message: Message):
    stats = await get_referral_stats(message.from_user.id)
    
    if stats["premium_until"]:
        days_left = (stats["premium_until"] - datetime.now()).days
        await message.answer(f"✨ Premium активен\nДо: {stats['premium_until'].strftime('%d.%m.%Y')} ({days_left} дн.)")
    else:
        await message.answer(
            f"🆓 Бесплатный план\n\n"
            f"Получи Premium бесплатно:\n"
            f"/referral — пригласи друзей"
        )


async def main():
    await init_db()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
BOT_USERNAME=yourbot
REFERRER_BONUS=7
REFEREE_BONUS=3
DB_PATH=referral.db
```

## Продвинутые механики

### Многоуровневая программа

```python
# Реферрер получает % от оплат приглашённых (SaaS-модель)
async def process_payment_with_referral(user_id: int, amount_stars: int):
    user = await get_user(user_id)
    if user["referred_by"]:
        # 20% от каждого платежа реферрера
        bonus_stars = int(amount_stars * 0.20)
        await add_star_bonus(user["referred_by"], bonus_stars)
```

### Топ рефереров

```python
@dp.message(Command("leaderboard"))
async def top_referrers(message: Message):
    async with aiosqlite.connect(DB_PATH) as db:
        rows = await db.execute_fetchall("""
            SELECT u.username, COUNT(r.id) as invites, SUM(r.bonus_days) as days
            FROM referrals r JOIN users u ON r.referrer_id = u.telegram_id
            GROUP BY r.referrer_id ORDER BY invites DESC LIMIT 10
        """)
    
    lines = ["🏆 Топ рефереров:\n"]
    medals = ["🥇", "🥈", "🥉"]
    for i, row in enumerate(rows):
        medal = medals[i] if i < 3 else f"{i+1}."
        lines.append(f"{medal} @{row[0] or 'анон'} — {row[1]} приглашений ({row[2]} дней бонуса)")
    
    await message.answer("\n".join(lines))
```

---

::: tip Как продвигать реферальную программу
1. Напоминание после каждой успешной оплаты: «Пригласи друга — получи 7 дней бесплатно»
2. Кнопка «Поделиться» → готовое сообщение с кнопкой «Открыть бота»
3. Акционные периоды: «На этой неделе — двойные бонусы за реферралы»
:::
