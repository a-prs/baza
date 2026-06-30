# AI-стек 2025: что выбрать

Рынок AI-инструментов меняется быстро. Здесь — прагматичный обзор того что реально работает для строителей продуктов.

## Языковые модели (LLM)

### Anthropic Claude

**Лучший для:** сложных задач с длинным контекстом, работы с кодом, структурированных выходных данных.

| Модель | Контекст | Когда использовать | Цена (приблизительно) |
|---|---|---|---|
| Haiku 4.5 | 200K | Простые задачи, массовая обработка | ~$0.25/M input |
| Sonnet 4.6 | 200K | Большинство задач — оптимальный выбор | ~$3/M input |
| Opus 4.8 | 200K | Сложный анализ, критичное качество | ~$15/M input |

Сильные стороны: следование инструкциям, безопасность, Tool Use, Vision, длинный контекст.

### OpenAI GPT

**Лучший для:** если нужна широкая экосистема, OpenAI ecosystem (Assistants, fine-tuning).

| Модель | Когда |
|---|---|
| GPT-4o mini | Дешёвые задачи, Whisper-замена |
| GPT-4o | Мультимодальность, voice |
| o1 / o3 | Математика, логические задачи |

### Google Gemini

**Лучший для:** если нужен бесплатный tier (Gemini 1.5 Flash бесплатно до лимитов), мультимодальность с видео.

### Локальные модели (Ollama)

```bash
# Поставить и запустить локально
curl -fsSL https://ollama.com/install.sh | sh
ollama run llama3.2
```

**Лучший для:** приватные данные (нельзя отправлять в облако), бесплатно, оффлайн.

```python
# API совместим с OpenAI
from openai import OpenAI

client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
response = client.chat.completions.create(
    model="llama3.2",
    messages=[{"role": "user", "content": "Привет!"}]
)
```

## Изображения

### Генерация

| Инструмент | API | Качество | Цена |
|---|---|---|---|
| DALL-E 3 | OpenAI | Хорошее, стабильное | $0.04/image |
| Flux.1 | Replicate / fal.ai | Превосходное | ~$0.003/image |
| Stable Diffusion | Self-hosted | Настраиваемое | Бесплатно |
| Midjourney | Только через Discord | Лучшее для арта | $10+/мес |

### Распознавание / Vision

- Claude Vision, GPT-4o Vision — для документов, чеков, UI-анализа
- Google Vision API — для массового OCR, классификации
- EasyOCR (open-source) — для локальной обработки

## Голос

### Транскрипция (Speech → Text)

| Инструмент | Качество | Скорость | Цена |
|---|---|---|---|
| OpenAI Whisper API | Отличное | Быстро | $0.006/мин |
| Whisper Local | Отличное | Зависит от GPU | Бесплатно |
| Deepgram | Хорошее | Очень быстро | $0.0043/мин |

```python
# Whisper API
from openai import AsyncOpenAI
client = AsyncOpenAI()

async def transcribe(audio_path: str) -> str:
    with open(audio_path, "rb") as f:
        result = await client.audio.transcriptions.create(
            model="whisper-1", file=f
        )
    return result.text
```

### Синтез речи (Text → Speech)

| Инструмент | Качество | Цена |
|---|---|---|
| OpenAI TTS | Отличное, натуральное | $0.015/1K chars |
| ElevenLabs | Лучшее, клонирование голоса | $0.30/1K chars |
| Silero TTS | Хорошее (RU) | Бесплатно |

## Векторные базы данных

| Инструмент | Когда |
|---|---|
| **ChromaDB** | Старт, прототип, self-hosted | 
| **Qdrant** | Продакшн, высокая нагрузка |
| **Pinecone** | Managed, не хочешь управлять инфра |
| PostgreSQL + pgvector | Уже есть Postgres |

## Автоматизация без кода

| Инструмент | Для чего |
|---|---|
| **n8n** | Self-hosted, полный контроль, 400+ интеграций |
| **Zapier** | Быстро, дорого при масштабе |
| **Make** | Между n8n и Zapier |

## Деплой и инфраструктура

### Серверы

| Вариант | Цена | Когда |
|---|---|---|
| **Hetzner VPS** | €5-20/мес | Оптимальный старт |
| **Selectel / TimeWeb** | 500-2000₽/мес | Данные в РФ |
| **Railway** | $5+/мес | Managed, проще Heroku |
| **Vercel** | Free / $20/мес | Frontend + serverless |
| **AWS/GCP/Azure** | Сложно, дорого | Только если нужен enterprise |

### Фреймворки

```
Python backend: FastAPI (REST) + aiogram 3 (Telegram)
JS frontend: Vue/Nuxt или React/Next
БД: SQLite (до 10K req/day) → PostgreSQL (продакшн)
Кэш: Redis
Контейнеры: Docker + docker-compose
```

## AI-агенты и оркестрация

### LangChain

Популярный, но тяжёлый. Хорошо для экспериментов, в продакшн — часто проще написать самому.

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage

model = ChatAnthropic(model="claude-haiku-4-5-20251001")
response = model.invoke([HumanMessage(content="Привет")])
```

### Claude Tool Use (без фреймворка)

Для большинства задач — прямой API лучше LangChain:

```python
# Агент с инструментами: прямой API
tools = [weather_tool, calculator_tool]
response = await claude.messages.create(
    model="claude-sonnet-4-6",
    tools=tools,
    messages=[{"role": "user", "content": "Какая погода в Москве?"}]
)
# Обработать tool_use блоки, вызвать функции, отправить результаты
```

### Claude Code (для разработки)

Самый мощный AI-инструмент для вайб-кодера. MCP-серверы расширяют возможности: базы данных, внешние API, файловая система.

## Что НЕ нужно (пока)

- **Kubernetes** — если у тебя меньше 100 активных пользователей одновременно
- **Kafka** — overkill для большинства продуктов
- **Собственные модели** — дешевле и эффективнее API
- **GraphQL** — если не знаешь зачем, бери REST
- **Микросервисы** — монолит проще для старта и до 10K MAU

## Стек по умолчанию для нового проекта

```
AI: Claude API (Sonnet для сложного, Haiku для масштаба)
Bot: aiogram 3 + aiosqlite (старт) → PostgreSQL (рост)
API: FastAPI  
Деплой: Hetzner VPS + systemd + nginx
CI/CD: GitHub Actions → SSH deploy
Мониторинг: Telegram уведомления об ошибках (старт) → Sentry (рост)
Бэкап: cron → tar + rclone → Yandex.Disk / S3
```

---

::: info Не гонись за новым
Инструменты меняются, принципы — нет. Хорошо понять один стек и доставлять ценность лучше, чем бесконечно изучать новые фреймворки.
:::
