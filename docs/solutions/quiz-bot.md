# Бот-викторина с AI-генерацией вопросов

Бот для обучения и тестирования: генерирует вопросы по теме через Claude, сохраняет результаты, ведёт статистику. Можно использовать для онбординга сотрудников, курсов, квизов в Telegram-канале.

## Что делает

- Выбор темы из списка или ввод своей
- AI генерирует уникальные вопросы с 4 вариантами ответа
- Прогресс-бар в процессе
- Итоговая оценка и слабые места
- `/leaderboard` — таблица лидеров

## Структура

```
quiz-bot/
├── bot.py
├── db.py
├── quiz_generator.py  # генерация вопросов через Claude
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
anthropic
aiosqlite
python-dotenv
```

## Генерация вопросов (quiz_generator.py)

```python
import json
import re
from anthropic import AsyncAnthropic
import os

claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


async def generate_questions(topic: str, count: int = 5, difficulty: str = "medium") -> list[dict]:
    """
    Сгенерировать вопросы по теме.
    Возвращает list[{"question": str, "options": list[str], "correct": int, "explanation": str}]
    """
    difficulty_desc = {
        "easy": "базовые, для новичков",
        "medium": "средние, для тех кто знает основы",
        "hard": "сложные, требуют глубокого понимания"
    }
    
    response = await claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": f"""Создай {count} вопросов для викторины по теме: "{topic}".
Уровень: {difficulty_desc.get(difficulty, 'средний')}.

Верни ТОЛЬКО JSON-массив без markdown-обёртки:
[
  {{
    "question": "текст вопроса",
    "options": ["А) вариант 1", "Б) вариант 2", "В) вариант 3", "Г) вариант 4"],
    "correct": 0,
    "explanation": "краткое объяснение правильного ответа (1-2 предложения)"
  }}
]

correct — индекс правильного ответа (0-3).
Варианты должны быть реалистичными и похожими (не очевидными).
Вопросы должны быть разными, не повторяться."""
        }]
    )
    
    text = response.content[0].text.strip()
    
    # Убрать возможную markdown-обёртку
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    
    questions = json.loads(text)
    
    # Валидация
    for q in questions:
        assert "question" in q and "options" in q and "correct" in q
        assert len(q["options"]) == 4
        assert 0 <= q["correct"] <= 3
    
    return questions
```

## База данных (db.py)

```python
import aiosqlite
import os
import json

DB_PATH = os.getenv("DB_PATH", "quiz.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                topic TEXT,
                questions TEXT,  -- JSON
                answers TEXT DEFAULT '[]',  -- JSON список ответов
                current_q INTEGER DEFAULT 0,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT,
                topic TEXT,
                score INTEGER,
                total INTEGER,
                percentage REAL,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()


async def create_session(user_id: int, topic: str, questions: list) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO sessions (user_id, topic, questions) VALUES (?, ?, ?)",
            (user_id, topic, json.dumps(questions, ensure_ascii=False))
        )
        await db.commit()
        return cur.lastrowid


async def get_session(user_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        row = await db.execute_fetchone(
            "SELECT * FROM sessions WHERE user_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1",
            (user_id,)
        )
        if not row:
            return None
        d = dict(row)
        d["questions"] = json.loads(d["questions"])
        d["answers"] = json.loads(d["answers"])
        return d


async def save_answer(session_id: int, answer_idx: int, answers: list):
    answers.append(answer_idx)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE sessions SET answers = ?, current_q = current_q + 1 WHERE id = ?",
            (json.dumps(answers), session_id)
        )
        await db.commit()


async def finish_session(session_id: int, user_id: int, username: str, 
                         topic: str, score: int, total: int):
    pct = round(score / total * 100, 1) if total else 0
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE sessions SET finished_at = CURRENT_TIMESTAMP WHERE id = ?",
            (session_id,)
        )
        await db.execute(
            "INSERT INTO results (user_id, username, topic, score, total, percentage) VALUES (?,?,?,?,?,?)",
            (user_id, username or "", topic, score, total, pct)
        )
        await db.commit()
    return pct


async def get_leaderboard(topic: str = None, limit: int = 10) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if topic:
            rows = await db.execute_fetchall(
                "SELECT username, score, total, percentage FROM results WHERE topic=? ORDER BY percentage DESC, score DESC LIMIT ?",
                (topic, limit)
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT username, AVG(percentage) as avg_pct, COUNT(*) as quizzes FROM results GROUP BY user_id ORDER BY avg_pct DESC LIMIT ?",
                (limit,)
            )
        return [dict(r) for r in rows]
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

TOPICS = [
    "Python основы", "FastAPI", "SQL и базы данных",
    "Git и GitHub", "Docker", "Telegram-боты на aiogram"
]

from db import init_db, create_session, get_session, save_answer, finish_session, get_leaderboard
from quiz_generator import generate_questions


class QuizState(StatesGroup):
    choosing_topic = State()
    custom_topic = State()
    answering = State()


def answer_keyboard(options: list[str], session_id: int, q_idx: int):
    kb = InlineKeyboardBuilder()
    for i, option in enumerate(options):
        kb.button(text=option, callback_data=f"ans:{session_id}:{q_idx}:{i}")
    kb.adjust(1)
    return kb.as_markup()


def topics_keyboard():
    kb = InlineKeyboardBuilder()
    for topic in TOPICS:
        kb.button(text=topic, callback_data=f"topic:{topic}")
    kb.button(text="✏️ Своя тема", callback_data="topic:custom")
    kb.adjust(2)
    return kb.as_markup()


@dp.message(Command("start", "quiz"))
async def cmd_start(message: Message, state: FSMContext):
    await state.set_state(QuizState.choosing_topic)
    await message.answer(
        "🧠 Викторина с AI\n\nВыбери тему или введи свою:",
        reply_markup=topics_keyboard()
    )


@dp.callback_query(F.data.startswith("topic:"))
async def choose_topic(callback: CallbackQuery, state: FSMContext):
    topic = callback.data.removeprefix("topic:")
    
    if topic == "custom":
        await state.set_state(QuizState.custom_topic)
        await callback.message.edit_text("Введи тему для викторины:")
        return
    
    await start_quiz(callback.message, callback.from_user, topic, state)
    await callback.answer()


@dp.message(QuizState.custom_topic)
async def got_custom_topic(message: Message, state: FSMContext):
    await start_quiz(message, message.from_user, message.text.strip(), state)


async def start_quiz(message: Message, user, topic: str, state: FSMContext):
    await state.set_state(QuizState.answering)
    
    gen_msg = await message.answer(f"🤖 Генерирую вопросы по теме «{topic}»...")
    
    try:
        questions = await generate_questions(topic, count=5)
    except Exception as e:
        await gen_msg.edit_text(f"Ошибка генерации: {e}")
        return
    
    session_id = await create_session(user.id, topic, questions)
    await state.update_data(session_id=session_id)
    
    await gen_msg.delete()
    await send_question(message, session_id, questions, 0)


async def send_question(message: Message, session_id: int, questions: list, idx: int):
    q = questions[idx]
    total = len(questions)
    progress = "▓" * (idx) + "░" * (total - idx)
    
    await message.answer(
        f"Вопрос {idx + 1}/{total}  [{progress}]\n\n"
        f"❓ {q['question']}",
        reply_markup=answer_keyboard(q["options"], session_id, idx)
    )


@dp.callback_query(F.data.startswith("ans:"))
async def handle_answer(callback: CallbackQuery, state: FSMContext):
    _, session_id, q_idx, ans_idx = callback.data.split(":")
    session_id, q_idx, ans_idx = int(session_id), int(q_idx), int(ans_idx)
    
    session = await get_session(callback.from_user.id)
    if not session or session["id"] != session_id:
        await callback.answer("Сессия устарела, начни новую /quiz")
        return
    
    questions = session["questions"]
    q = questions[q_idx]
    correct = q["correct"]
    is_correct = ans_idx == correct
    
    # Сохранить ответ
    await save_answer(session_id, ans_idx, session["answers"])
    
    # Показать результат этого вопроса
    result_icon = "✅" if is_correct else "❌"
    feedback = (
        f"{result_icon} {'Верно!' if is_correct else 'Неверно.'}\n"
        f"{'Правильный ответ: ' + q['options'][correct] + chr(10) if not is_correct else ''}"
        f"💡 {q.get('explanation', '')}"
    )
    
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer(feedback)
    
    next_idx = q_idx + 1
    
    if next_idx < len(questions):
        await send_question(callback.message, session_id, questions, next_idx)
    else:
        # Викторина завершена
        answers = session["answers"] + [ans_idx]
        score = sum(1 for i, a in enumerate(answers) if a == questions[i]["correct"])
        total = len(questions)
        
        pct = await finish_session(
            session_id, callback.from_user.id,
            callback.from_user.username or "",
            session["topic"], score, total
        )
        
        emoji = "🏆" if pct >= 80 else "👍" if pct >= 60 else "📚"
        
        await callback.message.answer(
            f"{emoji} Викторина завершена!\n\n"
            f"Тема: {session['topic']}\n"
            f"Результат: {score}/{total} ({pct}%)\n\n"
            f"{'Отлично!' if pct >= 80 else 'Хорошо, есть куда расти!' if pct >= 60 else 'Стоит повторить материал.'}\n\n"
            f"/quiz — начать новую\n"
            f"/leaderboard — таблица лидеров"
        )
        
        await state.clear()
    
    await callback.answer()


@dp.message(Command("leaderboard"))
async def cmd_leaderboard(message: Message):
    rows = await get_leaderboard(limit=10)
    if not rows:
        await message.answer("Пока нет результатов. Первым пройди викторину: /quiz")
        return
    
    lines = ["🏆 Таблица лидеров\n"]
    medals = ["🥇", "🥈", "🥉"]
    
    for i, row in enumerate(rows):
        medal = medals[i] if i < 3 else f"{i+1}."
        name = row.get("username") or "Аноним"
        
        if "avg_pct" in row:
            lines.append(f"{medal} @{name} — {row['avg_pct']:.0f}% ({row['quizzes']} квизов)")
        else:
            lines.append(f"{medal} @{name} — {row['score']}/{row['total']} ({row['percentage']}%)")
    
    await message.answer("\n".join(lines))


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
DB_PATH=quiz.db
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

---

::: tip Применение
- Онбординг сотрудников — создай темы по продукту/процессам
- Курс в Telegram — каждый урок заканчивается квизом
- Развлечательный канал — `/quiz` как интерактив с подписчиками
- Самоподготовка к собеседованиям — темы по технологиям
:::
