# WebSocket: обновления в реальном времени

HTTP работает по схеме запрос-ответ: клиент спрашивает → сервер отвечает → соединение закрывается. Если нужно чтобы сервер сам отправлял обновления (чат, уведомления, живой дашборд) — нужен WebSocket. Это постоянное соединение: обе стороны могут отправлять сообщения в любой момент.

**Когда нужен:**
- Чат в реальном времени
- Живое обновление цен / данных
- Уведомления без перезагрузки
- Прогресс долгой задачи (рендер видео, загрузка файла)
- Многопользовательские функции

**Когда НЕ нужен:**
- Простой CRUD (список постов, форма — обычный HTTP)
- Редкие обновления (раз в 5+ минут — проще polling)
- Одноразовые запросы

## FastAPI + WebSocket

```bash
pip install fastapi uvicorn[standard] websockets
```

```python
# main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from typing import List

app = FastAPI()

# Менеджер соединений
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, message: str):
        """Отправить всем подключённым"""
        for ws in self.active:
            await ws.send_text(message)

    async def send_personal(self, ws: WebSocket, message: str):
        await ws.send_text(message)

manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Получили от клиента — разослать всем
            await manager.broadcast(f"Сообщение: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/")
async def get():
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<body>
    <input id="msg" placeholder="Сообщение">
    <button onclick="send()">Отправить</button>
    <div id="log"></div>
    <script>
        const ws = new WebSocket("ws://localhost:8000/ws");
        ws.onmessage = (e) => {
            document.getElementById("log").innerHTML += `<p>${e.data}</p>`;
        };
        function send() {
            ws.send(document.getElementById("msg").value);
        }
    </script>
</body>
</html>
""")
```

```bash
uvicorn main:app --reload
```

## Прогресс долгой задачи

Реальный кейс: запустил рендер → видишь прогресс без перезагрузки:

```python
import asyncio

@app.websocket("/ws/progress/{task_id}")
async def task_progress(websocket: WebSocket, task_id: str):
    await websocket.accept()
    
    try:
        for step in range(1, 11):
            await asyncio.sleep(1)  # имитация работы
            progress = step * 10
            await websocket.send_json({
                "task_id": task_id,
                "progress": progress,
                "message": f"Шаг {step}/10"
            })
            if progress == 100:
                await websocket.send_json({"status": "done", "url": "/result.mp4"})
                break
    except WebSocketDisconnect:
        pass  # клиент отключился до завершения
```

Клиентская сторона:

```javascript
const ws = new WebSocket(`ws://localhost:8000/ws/progress/${taskId}`);

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    progressBar.style.width = data.progress + "%";
    statusText.textContent = data.message;
    
    if (data.status === "done") {
        ws.close();
        window.location.href = data.url;
    }
};
```

## WebSocket в Telegram-боте

В боте WebSocket нужен реже, но бывает: например, бот показывает результаты парсинга в реальном времени через веб-дашборд.

Паттерн: бот пишет в очередь → WebSocket сервер отдаёт клиентам:

```python
from asyncio import Queue

update_queue: Queue = Queue()

# Хук из бота (вызывается при новом событии)
async def notify_dashboard(event: dict):
    await update_queue.put(event)

# WebSocket читает очередь и шлёт клиентам
@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            event = await update_queue.get()
            await manager.broadcast(str(event))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
```

## Server-Sent Events (SSE) — альтернатива

Если нужны только обновления от сервера к клиенту (а не двусторонний обмен) — SSE проще:

```python
from fastapi.responses import StreamingResponse
import asyncio

@app.get("/stream")
async def stream_updates():
    async def generate():
        for i in range(10):
            await asyncio.sleep(1)
            yield f"data: Обновление {i}\n\n"  # формат SSE обязателен
    
    return StreamingResponse(generate(), media_type="text/event-stream")
```

```javascript
const es = new EventSource("/stream");
es.onmessage = (e) => console.log(e.data);
```

SSE проще WebSocket, работает через обычный HTTP. Подходит для: лента уведомлений, прогресс, live-лог.

| Критерий | WebSocket | SSE |
|----------|-----------|-----|
| Направление | двустороннее | только сервер→клиент |
| Сложность | средняя | низкая |
| Переподключение | вручную | автоматическое |
| Бинарные данные | да | нет |

## Промпт для добавления WebSocket

```
Добавь в мой FastAPI-проект WebSocket-эндпоинт для чата.
Структура: POST /send — добавить сообщение в историю; 
WS /ws/chat — подключиться и получать все новые сообщения.

История — последние 50 сообщений в памяти (deque).
При подключении — сразу отдать историю, потом стримить новые.
Сообщение: {"user": "имя", "text": "текст", "time": "timestamp"}.
```

---

::: info Деплой с WebSocket
nginx по умолчанию закрывает соединения через 60 секунд. Добавь в конфиг:
```nginx
proxy_read_timeout 3600;
proxy_send_timeout 3600;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```
:::
