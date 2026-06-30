# Планировщик задач: автоматизация по расписанию

Бот должен публиковать посты каждое утро. Скрипт проверяет цены каждые 30 минут. Отчёт генерируется по понедельникам. Для этого нужен планировщик.

Разберём три варианта — от простого к серьёзному.

## Вариант 1: APScheduler (внутри Python)

Планировщик живёт внутри твоего процесса. Удобно для бота — не нужен отдельный cron.

```bash
pip install apscheduler
```

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import asyncio

scheduler = AsyncIOScheduler()


async def daily_report():
    print("Генерирую отчёт...")
    # твой код


async def check_prices():
    print("Проверяю цены...")


# Запускать каждый день в 9:00
scheduler.add_job(
    daily_report,
    CronTrigger(hour=9, minute=0),
    id="daily_report"
)

# Запускать каждые 30 минут
scheduler.add_job(
    check_prices,
    "interval",
    minutes=30,
    id="price_check"
)

scheduler.start()
asyncio.get_event_loop().run_forever()
```

### Встроить в Telegram-бота

```python
from aiogram import Bot, Dispatcher
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import asyncio
import os

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()
scheduler = AsyncIOScheduler()

CHANNEL_ID = os.getenv("CHANNEL_ID")  # -100123456789


async def morning_post():
    await bot.send_message(CHANNEL_ID, "Доброе утро! Вот дайджест на сегодня...")


async def main():
    # Добавить задачу перед стартом
    scheduler.add_job(
        morning_post,
        "cron",
        hour=8,
        minute=0,
        timezone="Europe/Moscow"
    )
    scheduler.start()
    
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

### Полезные CronTrigger паттерны

```python
from apscheduler.triggers.cron import CronTrigger

# Каждый день в 08:30 (МСК)
CronTrigger(hour=8, minute=30, timezone="Europe/Moscow")

# Каждые 10 минут
"interval", minutes=10

# Только рабочие дни в 09:00
CronTrigger(day_of_week="mon-fri", hour=9, minute=0)

# 1-го числа каждого месяца в полночь
CronTrigger(day=1, hour=0, minute=0)

# Каждое воскресенье в 19:00
CronTrigger(day_of_week="sun", hour=19, minute=0)
```

## Вариант 2: systemd timer (системный)

Надёжнее чем APScheduler — переживает краш процесса, видно через `systemctl`.

Создай два файла:

**`/etc/systemd/system/mybot-report.service`:**
```ini
[Unit]
Description=My Bot Daily Report
After=network.target

[Service]
Type=oneshot
User=office
WorkingDirectory=/home/office/mybot
ExecStart=/home/office/mybot/.venv/bin/python report.py
EnvironmentFile=/home/office/mybot/.env
```

**`/etc/systemd/system/mybot-report.timer`:**
```ini
[Unit]
Description=Run My Bot Report Daily

[Timer]
OnCalendar=*-*-* 09:00:00
AccuracySec=1m
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mybot-report.timer

# Проверить
systemctl list-timers mybot-report*
systemctl status mybot-report.timer
```

Формат `OnCalendar`:
```
*-*-* 09:00:00          # каждый день в 9:00
Mon..Fri *-*-* 09:00:00 # рабочие дни
*-*-1 00:00:00          # 1-е число месяца
Sun *-*-* 19:00:00      # каждое воскресенье
*-*-* *:00:00           # каждый час
```

## Вариант 3: cron (классика)

Самый простой и надёжный. Минус — нет встроенного логирования.

```bash
crontab -e
```

```cron
# Формат: мин час день месяц день_недели команда
30 8 * * * /home/office/mybot/.venv/bin/python /home/office/mybot/report.py >> /home/office/mybot/cron.log 2>&1

# Каждые 30 минут
*/30 * * * * /home/office/mybot/.venv/bin/python /home/office/mybot/check_prices.py

# Только рабочие дни в 9:00
0 9 * * 1-5 /home/office/mybot/.venv/bin/python /home/office/mybot/morning_post.py
```

## Сравнение

| | APScheduler | systemd timer | cron |
|--|-------------|---------------|------|
| Сложность | низкая | средняя | низкая |
| Переживает краш | нет | да | да |
| Логи | в stdout | journald | только redirect |
| Внутри бота | да | нет | нет |
| Мониторинг | нет | systemctl | нет |

**Рекомендация:**
- Задачи завязаны на бот (отправка сообщений) → APScheduler
- Тяжёлые независимые задачи (рендер, парсинг) → systemd timer
- Простые скрипты на VPS → cron

## Обработка ошибок в задаче

```python
import logging
import traceback

logger = logging.getLogger(__name__)


async def safe_daily_report():
    """Обёртка с обработкой ошибок"""
    try:
        await daily_report()
    except Exception as e:
        logger.error(f"Ошибка в daily_report: {e}")
        logger.error(traceback.format_exc())
        # Уведомить админа
        await bot.send_message(ADMIN_ID, f"⚠️ Задача daily_report упала:\n{e}")


# Добавлять safe-обёртку, а не сырую функцию
scheduler.add_job(safe_daily_report, "cron", hour=9)
```

## Управление задачами через бота

```python
@dp.message(Command("jobs"))
async def cmd_jobs(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    
    jobs = scheduler.get_jobs()
    if not jobs:
        await message.answer("Нет запланированных задач.")
        return
    
    text = "Задачи:\n"
    for job in jobs:
        next_run = job.next_run_time
        text += f"• {job.id}: следующий запуск {next_run:%d.%m %H:%M}\n"
    
    await message.answer(text)


@dp.message(Command("runjob"))
async def cmd_runjob(message: Message):
    """Принудительно запустить задачу"""
    if message.from_user.id != ADMIN_ID:
        return
    
    job_id = message.text.removeprefix("/runjob").strip()
    job = scheduler.get_job(job_id)
    
    if not job:
        await message.answer(f"Задача '{job_id}' не найдена.")
        return
    
    await message.answer(f"Запускаю {job_id}...")
    await job.func()  # запустить немедленно
```

---

::: info Часовой пояс
Всегда указывай `timezone` явно — серверы обычно в UTC. Для МСК: `timezone="Europe/Moscow"`.
:::
