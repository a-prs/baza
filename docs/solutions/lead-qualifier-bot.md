# Бот-квалификатор лидов

Бот задаёт вопросы, оценивает потенциального клиента по критериям (BANT или своим) и передаёт квалифицированных лидов в CRM или менеджеру. Снимает рутину первичной квалификации.

## Что делает

1. Пользователь пишет боту (из рекламы, канала, сайта)
2. Бот проводит квалификационный диалог (5-7 вопросов)
3. Claude анализирует ответы → оценка лида (горячий/тёплый/холодный)
4. Горячий → уведомление менеджера + данные лида
5. Холодный → автоматический нутрящий контент

## Структура

```
lead-bot/
├── bot.py
├── db.py
├── qualifier.py   # AI-квалификация через Claude
├── questions.yaml # конфиг вопросов
├── .env
└── requirements.txt
```

## questions.yaml

```yaml
product: "AI-автоматизация для бизнеса"

questions:
  - id: business_type
    text: "Какой у вас бизнес? (кратко: сфера и размер)"
    required: true
  
  - id: problem
    text: "Какую задачу хотите автоматизировать?"
    required: true
  
  - id: current_solution
    text: "Как решаете это сейчас? (вручную / инструменты)"
    required: true
  
  - id: budget
    text: "Каков примерный бюджет на решение? (в рублях/месяц)"
    required: false
    skip_text: "Пока не определился"
  
  - id: timeline
    text: "Когда хотели бы внедрить решение?"
    required: false
    options:
      - "Срочно (в течение месяца)"
      - "В течение квартала"
      - "Планируем, без срока"

completion_message: |
  Спасибо! Я передам ваши данные нашему специалисту.
  Он свяжется с вами в ближайшее время.

cold_message: |
  Спасибо за ответы! Ваш запрос принят.
  Мы пришлём полезные материалы по теме — они помогут принять решение.
```

## Квалификатор (qualifier.py)

```python
import yaml
import os
from anthropic import AsyncAnthropic
import json

with open("questions.yaml") as f:
    CONFIG = yaml.safe_load(f)

claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


async def qualify_lead(answers: dict) -> dict:
    """
    Оценить лид по ответам.
    Возвращает: {"score": "hot|warm|cold", "reason": str, "summary": str}
    """
    answers_text = "\n".join(
        f"- {q_id}: {answer}"
        for q_id, answer in answers.items()
    )
    
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": f"""Оцени потенциального клиента для компании "{CONFIG['product']}".

Ответы клиента:
{answers_text}

Оцени по критериям:
- Есть реальная бизнес-задача под наш продукт
- Есть бюджет (явный или подразумеваемый)
- Есть срочность / дедлайн
- Размер бизнеса соответствует нашей ЦА

Верни JSON:
{{
  "score": "hot|warm|cold",
  "reason": "одно предложение почему такая оценка",
  "summary": "краткая выжимка запроса клиента (2-3 предложения)",
  "next_action": "что сделать дальше (связаться / отправить материалы / не подходит)"
}}

JSON:"""
        }]
    )
    
    return json.loads(response.content[0].text.strip())
```

## База данных (db.py)

```python
import aiosqlite
import json
import os

DB_PATH = os.getenv("DB_PATH", "leads.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER,
                username TEXT,
                full_name TEXT,
                answers TEXT,  -- JSON
                score TEXT,    -- hot/warm/cold
                summary TEXT,
                next_action TEXT,
                contacted BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()


async def save_lead(telegram_id: int, username: str, full_name: str,
                    answers: dict, qualification: dict) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("""
            INSERT INTO leads (telegram_id, username, full_name, answers, score, summary, next_action)
            VALUES (?,?,?,?,?,?,?)
        """, (
            telegram_id, username or "", full_name or "",
            json.dumps(answers, ensure_ascii=False),
            qualification["score"],
            qualification.get("summary", ""),
            qualification.get("next_action", "")
        ))
        await db.commit()
        return cur.lastrowid


async def get_leads(score: str = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if score:
            rows = await db.execute_fetchall(
                "SELECT * FROM leads WHERE score = ? ORDER BY created_at DESC",
                (score,)
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM leads ORDER BY created_at DESC LIMIT 50"
            )
        result = []
        for r in rows:
            d = dict(r)
            d["answers"] = json.loads(d["answers"])
            result.append(d)
        return result
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
import yaml
from dotenv import load_dotenv
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

MANAGER_CHAT_ID = int(os.getenv("MANAGER_CHAT_ID"))

with open("questions.yaml") as f:
    CONFIG = yaml.safe_load(f)

QUESTIONS = CONFIG["questions"]

from db import init_db, save_lead, get_leads
from qualifier import qualify_lead


class QualifyState(StatesGroup):
    answering = State()


@dp.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    await state.set_state(QualifyState.answering)
    await state.update_data(answers={}, current_q=0)
    
    first_q = QUESTIONS[0]
    await message.answer(
        "Привет! Я помогу разобраться как мы можем помочь вашему бизнесу.\n\n"
        f"Несколько вопросов (займёт 2-3 минуты):\n\n"
        f"1/{len(QUESTIONS)}: {first_q['text']}"
    )


@dp.message(QualifyState.answering)
async def handle_answer(message: Message, state: FSMContext):
    data = await state.get_data()
    answers = data.get("answers", {})
    current_q = data.get("current_q", 0)
    
    q = QUESTIONS[current_q]
    
    # Сохранить ответ
    answers[q["id"]] = message.text
    next_q = current_q + 1
    
    await state.update_data(answers=answers, current_q=next_q)
    
    if next_q >= len(QUESTIONS):
        # Все вопросы заданы — квалифицировать
        await state.clear()
        await run_qualification(message, answers)
    else:
        # Следующий вопрос
        nq = QUESTIONS[next_q]
        
        # Кнопки если есть варианты
        if nq.get("options"):
            kb = InlineKeyboardBuilder()
            for opt in nq["options"]:
                kb.button(text=opt, callback_data=f"opt:{next_q}:{opt[:50]}")
            if not nq.get("required"):
                kb.button(text=nq.get("skip_text", "Пропустить"), callback_data=f"opt:{next_q}:—")
            kb.adjust(1)
            
            await message.answer(
                f"{next_q + 1}/{len(QUESTIONS)}: {nq['text']}",
                reply_markup=kb.as_markup()
            )
        else:
            skip_hint = f"\n_(или напиши «{nq.get('skip_text', 'пропустить')}»)_" if not nq.get("required") else ""
            await message.answer(
                f"{next_q + 1}/{len(QUESTIONS)}: {nq['text']}{skip_hint}",
                parse_mode="Markdown"
            )


@dp.callback_query(F.data.startswith("opt:"))
async def handle_option(callback: CallbackQuery, state: FSMContext):
    _, q_idx, answer = callback.data.split(":", 2)
    
    # Симулировать текстовый ответ
    await callback.message.edit_reply_markup(reply_markup=None)
    
    # Пересоздать Message-like для handle_answer
    fake_message = callback.message
    fake_message.text = answer
    
    data = await state.get_data()
    await state.update_data(current_q=int(q_idx))
    
    await handle_answer(fake_message, state)
    await callback.answer()


async def run_qualification(message: Message, answers: dict):
    status = await message.answer("Анализирую ваши ответы...")
    
    qualification = await qualify_lead(answers)
    score = qualification["score"]
    
    user = message.from_user
    
    # Сохранить лид
    lead_id = await save_lead(
        telegram_id=user.id,
        username=user.username or "",
        full_name=user.full_name or "",
        answers=answers,
        qualification=qualification
    )
    
    # Уведомить пользователя
    if score in ("hot", "warm"):
        await status.edit_text(CONFIG.get("completion_message", "Спасибо! Менеджер свяжется с вами."))
    else:
        await status.edit_text(CONFIG.get("cold_message", "Спасибо за ответы!"))
    
    # Уведомить менеджера
    score_emoji = {"hot": "🔥", "warm": "🟡", "cold": "🔵"}.get(score, "⚪")
    
    answers_text = "\n".join(f"• {k}: {v}" for k, v in answers.items())
    manager_text = (
        f"{score_emoji} Новый лид #{lead_id} — {score.upper()}\n\n"
        f"👤 {user.full_name} (@{user.username or '—'})\n"
        f"🆔 {user.id}\n\n"
        f"📝 Ответы:\n{answers_text}\n\n"
        f"💡 {qualification.get('summary', '')}\n\n"
        f"➡️ {qualification.get('next_action', '')}"
    )
    
    await bot.send_message(MANAGER_CHAT_ID, manager_text)


@dp.message(Command("leads"))
async def cmd_leads(message: Message):
    if message.chat.id != MANAGER_CHAT_ID:
        return
    
    leads = await get_leads()
    hot = sum(1 for l in leads if l["score"] == "hot")
    warm = sum(1 for l in leads if l["score"] == "warm")
    cold = sum(1 for l in leads if l["score"] == "cold")
    
    await message.answer(
        f"📊 Лиды:\n"
        f"🔥 Горячих: {hot}\n"
        f"🟡 Тёплых: {warm}\n"
        f"🔵 Холодных: {cold}\n"
        f"Всего: {len(leads)}"
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
ANTHROPIC_API_KEY=your_key
MANAGER_CHAT_ID=-100xxxxxxxxx
DB_PATH=leads.db
```

## Запуск

```bash
pip install aiogram anthropic aiosqlite python-dotenv pyyaml
python bot.py
```

---

::: tip Как использовать
- Ссылка на бота в рекламе/посте: `t.me/yourbot?start=ad_source`
- Лид-магнит: «Пройди 3-минутный квиз и получи персональный план автоматизации»
- После квалификации горячих лидов — немедленно звони, конверсия выше в первые 5 минут
:::
