# Serverless: функции без сервера

Serverless — запускаешь код без управления сервером. Платишь за каждый вызов, а не за аптайм. Vercel Functions, Cloudflare Workers, AWS Lambda — одна идея, разный синтаксис.

## Когда подходит

| Подходит | Не подходит |
|---|---|
| Редкие/непредсказуемые запросы | Постоянная нагрузка (дешевле VPS) |
| API без состояния | Длинные операции (>30 сек) |
| Вебхуки, форм-обработчики | Потоковые данные |
| Прототипы и лендинги | WebSocket |
| Цена важнее latency | Нужен local disk |

## Vercel Functions (Python)

### Структура проекта

```
my-app/
├── api/
│   ├── hello.py       → /api/hello
│   ├── webhook.py     → /api/webhook
│   └── ai/
│       └── chat.py    → /api/ai/chat
├── index.html
└── vercel.json
```

### Простой хендлер

```python
# api/hello.py
from http.server import BaseHTTPRequestHandler
import json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"message": "Hello!"}).encode())
```

### Хендлер с параметрами и AI

```python
# api/ai/chat.py
from http.server import BaseHTTPRequestHandler
import json
import os
from anthropic import Anthropic

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        data = json.loads(body)
        
        message = data.get("message", "")
        if not message:
            self._respond(400, {"error": "message required"})
            return
        
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": message}]
        )
        
        self._respond(200, {"reply": response.content[0].text})
    
    def _respond(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):  # CORS preflight
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
```

### vercel.json

```json
{
  "functions": {
    "api/*.py": {
      "runtime": "vercel-python@3.0",
      "maxDuration": 30
    }
  },
  "env": {
    "ANTHROPIC_API_KEY": "@anthropic_api_key"
  }
}
```

### Деплой

```bash
npm i -g vercel
vercel login
vercel --prod
# Или: подключить репо в vercel.com → автодеплой из GitHub
```

## Vercel Functions (с FastAPI через adapter)

Более удобный вариант — FastAPI через адаптер:

```bash
pip install mangum
```

```python
# api/index.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/chat")
async def chat(body: dict):
    message = body.get("message", "")
    # ... логика ...
    return {"reply": "ответ"}


# Vercel adapter
handler = Mangum(app)
```

## Cloudflare Workers (JavaScript/TypeScript)

Быстрее Vercel Functions (V8 engine, не Python), лимит бесплатного плана больше.

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/api/chat" && request.method === "POST") {
      const body = await request.json() as { message: string };
      
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{ role: "user", content: body.message }],
        }),
      });
      
      const data = await response.json() as any;
      const reply = data.content[0].text;
      
      return Response.json({ reply });
    }
    
    return new Response("Not Found", { status: 404 });
  },
};

interface Env {
  ANTHROPIC_API_KEY: string;
}
```

```toml
# wrangler.toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
# Секреты: wrangler secret put ANTHROPIC_API_KEY
```

```bash
npm install -g wrangler
wrangler deploy
```

## Telegram-бот на Vercel (вебхук)

Serverless идеально для вебхуков — функция просыпается только при входящем сообщении:

```python
# api/telegram.py
from http.server import BaseHTTPRequestHandler
import json
import os
import httpx

BOT_TOKEN = os.environ["BOT_TOKEN"]
CLAUDE_KEY = os.environ["ANTHROPIC_API_KEY"]


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        
        # Подтвердить Telegram сразу
        self.send_response(200)
        self.end_headers()
        
        # Обработать сообщение
        message = body.get("message", {})
        chat_id = message.get("chat", {}).get("id")
        text = message.get("text", "")
        
        if not (chat_id and text):
            return
        
        # Ответить (синхронно — нет asyncio в BaseHTTPRequestHandler)
        reply = self._get_ai_reply(text)
        self._send_message(chat_id, reply)
    
    def _get_ai_reply(self, text: str) -> str:
        response = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": CLAUDE_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 500,
                "messages": [{"role": "user", "content": text}],
            },
            timeout=25
        )
        return response.json()["content"][0]["text"]
    
    def _send_message(self, chat_id: int, text: str):
        httpx.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": chat_id, "text": text}
        )
```

Зарегистрировать вебхук:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://my-app.vercel.app/api/telegram"
```

## Ограничения serverless

| Ограничение | Vercel | Cloudflare Workers |
|---|---|---|
| Время выполнения | 30 сек (Hobby), 300 сек (Pro) | 30 сек (бесплатно), 300 сек (платно) |
| Память | 1 GB | 128 MB |
| Размер пакета | 50 MB | 1 MB (skewed toward small) |
| Сетевые запросы | Да | Да |
| Диск | Нет | Нет |
| Cold start | ~200ms | ~5ms (V8) |

## Переменные окружения в Vercel

```bash
# CLI
vercel env add ANTHROPIC_API_KEY production

# Или в vercel.com → Project → Settings → Environment Variables
```

В коде: `os.environ["ANTHROPIC_API_KEY"]` (не `os.getenv` — если не задано, лучше упасть с ошибкой).

---

::: tip Выбор платформы
Для Python-функций — Vercel (привычный FastAPI-стиль). Для максимальной скорости/доступности — Cloudflare Workers (V8, нет cold start). Для долгих AI-операций — всё равно нужен VPS (serverless не потянет 5-минутную генерацию видео).
:::
