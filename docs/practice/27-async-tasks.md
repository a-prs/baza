# Фоновые задачи: не тормози ответ

Когда пользователь нажал кнопку — бот должен ответить быстро. Но иногда задача тяжёлая: отправить 500 email, сгенерировать PDF, скачать видео. Делать это синхронно — пользователь будет ждать минуту. Решение: фоновые задачи.

## Проблема: бот тормозит

```python
# ПЛОХО: пользователь ждёт пока всё не отправится
@dp.message(Command("send_all"))
async def send_all(message: Message):
    users = get_all_users()  # 500 пользователей
    for user in users:
        await bot.send_message(user.id, "Новость!")  # 500 запросов подряд
    await message.answer("Готово!")  # только через 2 минуты
```

## Решение 1: asyncio.create_task — простейший фон

Для простых случаев: отвечаешь сразу, задача работает параллельно.

```python
import asyncio

async def send_to_all(user_ids: list[int], text: str):
    """Эта функция работает в фоне"""
    for user_id in user_ids:
        try:
            await bot.send_message(user_id, text)
            await asyncio.sleep(0.05)  # 20 сообщений в секунду (лимит Telegram)
        except Exception as e:
            print(f"Ошибка для {user_id}: {e}")

@dp.message(Command("send_all"))
async def send_all(message: Message):
    users = get_all_users()
    user_ids = [u.id for u in users]
    
    # Запускаем в фоне — не ждём завершения
    asyncio.create_task(send_to_all(user_ids, "Новость!"))
    
    # Отвечаем сразу
    await message.answer(f"Рассылка запущена, получателей: {len(user_ids)}")
```

Минус: если процесс упадёт в середине рассылки — начинай заново.

## Решение 2: BackgroundTasks в FastAPI

FastAPI имеет встроенный механизм фоновых задач:

```python
from fastapi import FastAPI, BackgroundTasks

app = FastAPI()

def generate_report(user_id: int, email: str):
    """Запустится после ответа пользователю"""
    pdf = create_pdf_report(user_id)  # медленно
    send_email(email, pdf)             # медленно
    print(f"Отчёт отправлен на {email}")

@app.post("/report")
def request_report(user_id: int, email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(generate_report, user_id, email)
    return {"message": "Отчёт готовится, пришлём на email"}
```

Ответ 200 приходит мгновенно, функция выполняется после.

## Решение 3: очередь через asyncio.Queue

Для контролируемой очереди с ограничением параллелизма:

```python
import asyncio
from asyncio import Queue

class TaskQueue:
    def __init__(self, workers: int = 3):
        self.queue = Queue()
        self.workers = workers
    
    async def add_task(self, func, *args, **kwargs):
        await self.queue.put((func, args, kwargs))
    
    async def worker(self, name: str):
        while True:
            func, args, kwargs = await self.queue.get()
            try:
                await func(*args, **kwargs)
            except Exception as e:
                print(f"Worker {name} ошибка: {e}")
            finally:
                self.queue.task_done()
    
    async def start(self):
        for i in range(self.workers):
            asyncio.create_task(self.worker(f"w{i}"))

# Создать глобальную очередь
queue = TaskQueue(workers=5)

# При старте бота
async def on_startup():
    await queue.start()

# Использование:
await queue.add_task(send_message, user_id, text)
```

Теперь одновременно работает не более 5 задач.

## Решение 4: Celery + Redis (продакшн)

Для серьёзных задач с надёжностью: Celery хранит очередь в Redis, задачи переживают рестарт.

```bash
pip install celery redis
```

```python
# tasks.py
from celery import Celery

app = Celery("tasks", broker="redis://localhost:6379/0")

@app.task
def send_report(user_id: int, email: str):
    pdf = create_pdf_report(user_id)
    send_email(email, pdf)
    return f"Отправлено на {email}"
```

Запуск воркера:

```bash
celery -A tasks worker --loglevel=info
```

Из FastAPI/бота:

```python
from tasks import send_report

# Поставить в очередь (мгновенно)
task = send_report.delay(user_id=42, email="user@example.com")

# Проверить статус (опционально)
result = send_report.AsyncResult(task.id)
print(result.state)  # PENDING / STARTED / SUCCESS / FAILURE
```

Celery + Redis — стандарт для продакшна, но требует Redis-сервера.

## Паттерн: прогресс-бар через Telegram

Покажи пользователю прогресс долгой операции:

```python
@dp.message(Command("process"))
async def process_command(message: Message):
    status_msg = await message.answer("Начинаю обработку... 0%")
    
    items = get_items()
    total = len(items)
    
    for i, item in enumerate(items):
        await process_item(item)
        
        # Обновляем каждые 10%
        progress = (i + 1) / total * 100
        if (i + 1) % max(1, total // 10) == 0:
            await status_msg.edit_text(f"Обрабатываю... {progress:.0f}%")
    
    await status_msg.edit_text(f"Готово! Обработано {total} элементов.")
```

`edit_text` редактирует существующее сообщение — не спамит новыми.

## Когда что использовать

| Задача | Решение |
|--------|---------|
| Одиночная тяжёлая задача | `asyncio.create_task` |
| FastAPI background task | `BackgroundTasks` |
| Очередь с ограничением | `asyncio.Queue` |
| Надёжность, рестарты | Celery + Redis |
| Периодические задачи | systemd timer или Celery Beat |

## Промпт для фоновых задач

```
У меня Telegram-бот на aiogram 3.
Команда /export запускает долгую операцию: [описание].
Примерное время: [N] секунд.

Сделай так чтобы:
1. Бот сразу отвечал "Начинаю обработку..."
2. Операция выполнялась в фоне через asyncio.create_task
3. По завершении бот присылал "Готово! [результат]"
4. Ошибки логировались и пользователю приходило "Произошла ошибка"
```

---

::: info Что дальше?
Фоновые задачи работают — добавь [мониторинг](/practice/16-monitoring) чтобы знать если воркер завис. Для очень долгих задач (генерация видео, тяжёлые вычисления) — рассмотри отдельный сервис на [FastAPI](/practice/24-fastapi) или Redis-очередь.
:::
