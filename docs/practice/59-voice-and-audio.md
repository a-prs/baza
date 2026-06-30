# Работа с голосом и аудио

Голосовые сообщения в Telegram — основной канал для многих пользователей. Разбираем: получить голосовое → транскрибировать → ответить. Плюс генерация TTS-ответов.

## Получить голосовое сообщение

```python
import os
import tempfile
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, Voice

bot = Bot(token=os.getenv("BOT_TOKEN"))
dp = Dispatcher()


@dp.message(F.voice)
async def handle_voice(message: Message):
    """Получить голосовое от пользователя."""
    voice: Voice = message.voice
    
    print(f"Duration: {voice.duration}s, Size: {voice.file_size} bytes")
    
    # Скачать файл
    file_info = await bot.get_file(voice.file_id)
    
    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
        await bot.download_file(file_info.file_path, tmp.name)
        local_path = tmp.name
    
    await message.answer(f"Получил голосовое ({voice.duration}с). Транскрибирую...")
    
    # Транскрибировать
    text = await transcribe_audio(local_path)
    os.unlink(local_path)
    
    await message.answer(f"Вы сказали:\n_{text}_", parse_mode="Markdown")
```

## Транскрибация через Whisper API

```python
from openai import AsyncOpenAI

openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


async def transcribe_audio(file_path: str, language: str = "ru") -> str:
    """Транскрибировать аудиофайл через Whisper."""
    with open(file_path, "rb") as audio_file:
        transcript = await openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=language,
            response_format="text"
        )
    return transcript
```

## Локальный Whisper (бесплатно)

```python
# pip install faster-whisper
from faster_whisper import WhisperModel
import asyncio

# Загрузить модель один раз при старте
# Размеры: tiny (75MB), base (145MB), small (461MB), medium (1.4GB), large (2.9GB)
whisper_model = WhisperModel("base", device="cpu", compute_type="int8")


async def transcribe_local(file_path: str) -> str:
    """Транскрибировать локально без API."""
    loop = asyncio.get_event_loop()
    
    def _transcribe():
        segments, info = whisper_model.transcribe(file_path, language="ru")
        return " ".join(seg.text for seg in segments).strip()
    
    return await loop.run_in_executor(None, _transcribe)
```

## Конвертация форматов

Telegram присылает OGG/OPUS. Whisper работает с MP3/WAV/M4A/etc. FFmpeg конвертирует:

```python
import subprocess
import asyncio


async def convert_ogg_to_mp3(input_path: str, output_path: str) -> bool:
    """Конвертировать OGG в MP3 через FFmpeg."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-i", input_path, "-q:a", "3",
            output_path, "-y",  # -y = перезаписать без вопросов
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )
        await proc.communicate()
        return proc.returncode == 0
    except Exception as e:
        print(f"FFmpeg error: {e}")
        return False


# Полный пайплайн
async def process_voice(message: Message) -> str:
    voice = message.voice
    
    with tempfile.TemporaryDirectory() as tmpdir:
        ogg_path = os.path.join(tmpdir, "voice.ogg")
        mp3_path = os.path.join(tmpdir, "voice.mp3")
        
        # Скачать
        file_info = await bot.get_file(voice.file_id)
        await bot.download_file(file_info.file_path, ogg_path)
        
        # Конвертировать
        if not await convert_ogg_to_mp3(ogg_path, mp3_path):
            raise RuntimeError("Conversion failed")
        
        # Транскрибировать (выбери один вариант)
        # text = await transcribe_audio(mp3_path)  # Whisper API
        text = await transcribe_local(mp3_path)    # локальный
    
    return text
```

## Генерация речи (TTS)

### OpenAI TTS

```python
async def text_to_speech(text: str, voice: str = "nova") -> bytes:
    """
    Голоса OpenAI: alloy, echo, fable, onyx, nova, shimmer
    nova — мягкий женский, onyx — глубокий мужской
    """
    response = await openai_client.audio.speech.create(
        model="tts-1",           # tts-1-hd для лучшего качества
        voice=voice,
        input=text,
        response_format="mp3"
    )
    return response.content


async def send_voice_reply(message: Message, text: str):
    """Ответить голосовым сообщением."""
    audio_bytes = await text_to_speech(text)
    
    from aiogram.types import BufferedInputFile
    
    audio_file = BufferedInputFile(audio_bytes, filename="response.mp3")
    await message.answer_voice(audio_file)
```

### ElevenLabs (реалистичнее, платно)

```python
import aiohttp


async def elevenlabs_tts(text: str, voice_id: str = "21m00Tcm4TlvDq8ikWAM") -> bytes:
    """Генерация речи через ElevenLabs API."""
    api_key = os.getenv("ELEVENLABS_API_KEY")
    
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json"
            },
            json={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}
            }
        ) as resp:
            return await resp.read()
```

## Полный voice-бот: говоришь → получаешь ответ

```python
from anthropic import AsyncAnthropic

claude = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


@dp.message(F.voice)
async def voice_assistant(message: Message):
    """Полный цикл: голос → текст → AI → голос."""
    
    # 1. Показать typing
    await bot.send_chat_action(message.chat.id, "record_voice")
    
    try:
        # 2. Транскрибировать
        user_text = await process_voice(message)
    except Exception as e:
        await message.answer(f"Не смог распознать: {e}")
        return
    
    # 3. AI-ответ
    ai_response = await claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": user_text}]
    )
    answer_text = ai_response.content[0].text
    
    # 4. Отправить текст + голосовой ответ
    await message.answer(f"Вы: _{user_text}_\n\nОтвет: {answer_text}", parse_mode="Markdown")
    
    # Опционально: TTS ответ
    if len(answer_text) < 500:  # не генерировать длинное
        await send_voice_reply(message, answer_text)
```

## Лимиты и советы

```
Telegram ограничения:
- Голосовое: до 20MB (Bot API) / до 2GB (TDLib)
- Длинные файлы: скачивай через file_path, не file_id

Whisper лимиты:
- API: до 25MB, форматы mp3/mp4/mpeg/mpga/m4a/wav/webm
- Локальный: ограничен RAM, больше не стоит держать >medium

Оптимизация скорости:
- Whisper "tiny": 30-50ms на секунду аудио (быстро, качество ниже)
- Whisper "base": 100ms / 1s аудио (баланс)
- Для РФ языка: явно указывай language="ru"

Стоимость Whisper API: $0.006 / минута аудио
10-секундное голосовое: $0.001 = 0.1₽ (практически бесплатно)
```

---

::: tip Кэшировать частые TTS
Если бот часто произносит одни и те же фразы («Привет! Чем помочь?», «Пожалуйста, подождите») — сгенерируй их один раз, сохрани как файлы, и шли по `file_id`. Не трать API на одинаковое.
:::
