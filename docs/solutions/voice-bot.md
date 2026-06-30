# Voice-бот: распознавание и ответ голосом

Пользователь присылает голосовое — бот транскрибирует через Whisper, понимает вопрос через Claude, отвечает текстом (или голосом). Полезно для ботов-ассистентов и ситуаций когда печатать неудобно.

## Что умеет

- Принять голосовое сообщение и кружок-видео
- Транскрибировать через OpenAI Whisper
- Ответить через Claude на распознанный вопрос
- Опционально: синтезировать голосовой ответ (TTS)

## Структура

```
voice-bot/
├── bot.py
├── voice.py      # транскрипция и TTS
├── .env
└── requirements.txt
```

## requirements.txt

```
aiogram==3.13
openai
anthropic
python-dotenv
pydub
```

## Работа с голосом (voice.py)

```python
import os
import io
from openai import AsyncOpenAI
from pydub import AudioSegment

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


async def transcribe(audio_bytes: bytes, mime: str = "audio/ogg") -> str:
    """Транскрибировать аудио через Whisper"""
    # Конвертировать ogg в mp3 (Whisper лучше работает с mp3)
    audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format="ogg")
    mp3_buffer = io.BytesIO()
    audio.export(mp3_buffer, format="mp3")
    mp3_buffer.seek(0)
    
    transcript = await client.audio.transcriptions.create(
        model="whisper-1",
        file=("audio.mp3", mp3_buffer, "audio/mpeg"),
        language="ru",  # или убрать для автоопределения
    )
    return transcript.text


async def text_to_speech(text: str) -> bytes:
    """Синтез речи через OpenAI TTS"""
    response = await client.audio.speech.create(
        model="tts-1",
        voice="nova",   # alloy, echo, fable, onyx, nova, shimmer
        input=text[:4096],  # лимит TTS
    )
    return response.content
```

## Бот (bot.py)

```python
import asyncio
import os
import logging
from dotenv import load_dotenv

from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, Voice, VideoNote, BufferedInputFile
from aiogram.filters import Command

load_dotenv()
logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()

from voice import transcribe, text_to_speech
from anthropic import AsyncAnthropic

claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# История диалога (в памяти, для простоты)
conversations: dict[int, list[dict]] = {}

SYSTEM_PROMPT = """Ты — голосовой ассистент. 
Отвечай кратко (2-4 предложения), разговорным языком.
Вопрос пришёл через распознавание речи — могут быть опечатки, пойми смысл."""


async def get_voice_bytes(message: Message) -> bytes | None:
    """Скачать голосовое или кружок"""
    if message.voice:
        file = await bot.get_file(message.voice.file_id)
    elif message.video_note:
        file = await bot.get_file(message.video_note.file_id)
    else:
        return None
    
    buf = await bot.download_file(file.file_path)
    return buf.read()


async def chat_with_claude(user_id: int, text: str) -> str:
    """Ответить через Claude с историей"""
    if user_id not in conversations:
        conversations[user_id] = []
    
    conversations[user_id].append({"role": "user", "content": text})
    
    # Обрезать историю до последних 10 сообщений
    history = conversations[user_id][-10:]
    
    response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        system=SYSTEM_PROMPT,
        messages=history
    )
    
    reply = response.content[0].text
    conversations[user_id].append({"role": "assistant", "content": reply})
    
    return reply


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "Привет! Я голосовой ассистент.\n\n"
        "Пришли голосовое сообщение или кружок — транскрибирую и отвечу.\n\n"
        "/clear — очистить историю диалога\n"
        "/voice on/off — включить/выключить голосовые ответы"
    )


@dp.message(Command("clear"))
async def cmd_clear(message: Message):
    conversations.pop(message.from_user.id, None)
    await message.answer("История очищена.")


# Настройки пользователя (голосовые ответы)
user_voice_prefs: dict[int, bool] = {}

@dp.message(Command("voice"))
async def cmd_voice(message: Message):
    args = message.text.removeprefix("/voice").strip()
    if args == "on":
        user_voice_prefs[message.from_user.id] = True
        await message.answer("✅ Голосовые ответы включены.")
    elif args == "off":
        user_voice_prefs[message.from_user.id] = False
        await message.answer("🔇 Голосовые ответы выключены.")
    else:
        current = user_voice_prefs.get(message.from_user.id, False)
        await message.answer(f"Голосовые ответы: {'✅ вкл' if current else '🔇 выкл'}\n"
                             f"/voice on — включить\n/voice off — выключить")


@dp.message(F.voice | F.video_note)
async def handle_voice(message: Message):
    status = await message.answer("🎧 Распознаю речь...")
    
    try:
        audio_bytes = await get_voice_bytes(message)
        if not audio_bytes:
            await status.edit_text("Не удалось скачать аудио.")
            return
        
        # Транскрипция
        text = await transcribe(audio_bytes)
        
        if not text.strip():
            await status.edit_text("Не удалось распознать речь. Попробуй ещё раз.")
            return
        
        await status.edit_text(f"🎙️ Ты сказал: _{text}_", parse_mode="Markdown")
        
        # Ответ через Claude
        reply = await chat_with_claude(message.from_user.id, text)
        
        # Отправить ответ
        want_voice = user_voice_prefs.get(message.from_user.id, False)
        
        if want_voice:
            try:
                audio_reply = await text_to_speech(reply)
                await message.answer_voice(
                    voice=BufferedInputFile(audio_reply, filename="reply.mp3"),
                    caption=reply[:200]  # текст как подпись
                )
            except Exception:
                # Если TTS упал — отправить текстом
                await message.answer(reply)
        else:
            await message.answer(reply)
    
    except Exception as e:
        await status.edit_text(f"Ошибка: {e}")


# Обычный текст тоже работает
@dp.message(F.text & ~F.text.startswith("/"))
async def handle_text(message: Message):
    reply = await chat_with_claude(message.from_user.id, message.text)
    await message.answer(reply)


async def main():
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
```

## .env

```
BOT_TOKEN=your_token
OPENAI_API_KEY=your_key      # Whisper + TTS
ANTHROPIC_API_KEY=your_key   # Claude
```

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# pydub нужен ffmpeg
# Ubuntu: sudo apt install ffmpeg
# Mac: brew install ffmpeg

python bot.py
```

## Без OpenAI: бесплатный Whisper локально

Если не хочешь платить за Whisper API:

```bash
pip install openai-whisper
```

```python
import whisper
import tempfile
import os

model = whisper.load_model("base")  # small, medium, large — больше = точнее

async def transcribe_local(audio_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    
    try:
        result = model.transcribe(tmp_path, language="ru")
        return result["text"]
    finally:
        os.unlink(tmp_path)
```

Локальный Whisper бесплатный, но требует GPU для быстрой работы. На CPU — медленно (~30 сек для 1 мин аудио).

## Промпт для расширения

```
Добавь в voice-bot сохранение транскриптов в SQLite.
Таблица: voice_messages(id, user_id, text, reply, created_at).
Команда /history — показать последние 5 диалогов.
Команда /export — отправить все транскрипты файлом CSV.
```

---

::: info Цены Whisper API
$0.006 за минуту аудио. Голосовое 30 секунд = $0.003. Для бота с несколькими десятками пользователей — копейки. TTS (озвучка) — $15 за 1M символов (~$0.000015 за слово).
:::
