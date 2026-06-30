# FastAPI: создай своё API

FastAPI — это Python-фреймворк для создания REST API. Если хочешь чтобы твоё приложение могло отвечать на HTTP-запросы — это лучший выбор для вайб-кодера.

## Когда нужно своё API

- Мобильное приложение или фронтенд хочет получать данные
- Несколько сервисов должны обмениваться данными
- Хочешь сделать webhook endpoint для внешнего сервиса
- n8n или другой инструмент автоматизации дёргает твой сервис

## Минимальное API за 10 минут

```bash
pip install fastapi uvicorn[standard]
```

```python
# main.py
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# Хранилище (в продакшне — база данных)
tasks = []

class Task(BaseModel):
    title: str
    done: bool = False

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/tasks")
def get_tasks():
    return tasks

@app.post("/tasks")
def create_task(task: Task):
    tasks.append(task.dict())
    return {"ok": True, "task": task}

@app.put("/tasks/{task_id}")
def update_task(task_id: int, done: bool):
    if task_id >= len(tasks):
        return {"error": "Task not found"}
    tasks[task_id]["done"] = done
    return tasks[task_id]
```

Запуск:

```bash
uvicorn main:app --reload --port 8000
```

Открой в браузере: `http://localhost:8000/docs` — автоматическая документация!

## Структура endpoint

```python
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import sqlite3

app = FastAPI(title="My API", version="1.0.0")

# Схема данных
class Product(BaseModel):
    name: str
    price: float
    category: Optional[str] = None

# GET — получить список
@app.get("/products")
def list_products(skip: int = 0, limit: int = 10, category: str = None):
    # skip и limit — параметры URL: /products?skip=0&limit=10
    # category — фильтр: /products?category=electronics
    ...

# GET — получить один
@app.get("/products/{product_id}")
def get_product(product_id: int):
    product = find_by_id(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# POST — создать
@app.post("/products", status_code=201)
def create_product(product: Product):
    # product уже валидирован pydantic
    new_id = save_to_db(product)
    return {"id": new_id, **product.dict()}

# DELETE — удалить
@app.delete("/products/{product_id}")
def delete_product(product_id: int):
    deleted = delete_from_db(product_id)
    if not deleted:
        raise HTTPException(status_code=404)
    return {"ok": True}
```

## Автоматическая документация

FastAPI генерирует Swagger UI автоматически. После запуска:

- `http://localhost:8000/docs` — интерактивная документация (можно тестировать прямо там)
- `http://localhost:8000/redoc` — альтернативный формат
- `http://localhost:8000/openapi.json` — JSON-схема для клиентов

## Работа с базой данных

```bash
pip install sqlalchemy aiosqlite
```

```python
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from fastapi import Depends

DATABASE_URL = "sqlite:///./app.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class ProductDB(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    price = Column(Float)

Base.metadata.create_all(bind=engine)

# Dependency injection — сессия в каждый запрос
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/products")
def list_products(db: Session = Depends(get_db)):
    return db.query(ProductDB).all()

@app.post("/products")
def create_product(product: Product, db: Session = Depends(get_db)):
    db_product = ProductDB(**product.dict())
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product
```

## Аутентификация через API Key

```python
from fastapi import Security, HTTPException
from fastapi.security import APIKeyHeader
import os

API_KEY = os.getenv("API_SECRET_KEY")
api_key_header = APIKeyHeader(name="X-API-Key")

def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")
    return api_key

# Защищённый endpoint
@app.get("/protected", dependencies=[Depends(verify_api_key)])
def protected_route():
    return {"data": "только с ключом"}
```

Клиент должен передать заголовок: `X-API-Key: твой-ключ`.

## CORS для фронтенда

Если к API будет обращаться браузерный JavaScript:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mysite.com"],  # или ["*"] для разработки
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Деплой на сервере

Systemd-сервис для продакшна:

```ini
[Unit]
Description=My FastAPI App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/my-api
ExecStart=/opt/my-api/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --workers 2
Restart=always
EnvironmentFile=/opt/my-api/.env

[Install]
WantedBy=multi-user.target
```

Nginx-конфиг:

```nginx
location /api/ {
    proxy_pass http://localhost:8001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## Промпты для создания API

### Новое API с нуля

```
Создай FastAPI приложение.
Сущность: [название] с полями [поля и типы].
Операции: CRUD (создать, прочитать список, прочитать один, обновить, удалить).
База данных: SQLite через SQLAlchemy.
Аутентификация: API Key в заголовке X-API-Key из .env.
Порт: 8001.
```

### Добавить endpoint в существующее API

```
Добавь endpoint в моё FastAPI приложение:
POST /[путь]
Принимает: [описание тела запроса]
Делает: [описание логики]
Возвращает: [описание ответа]
Не ломай существующие endpoints.
```

### Документирование

```
Добавь описания к endpoint в FastAPI:
- title и description для всего приложения
- summary и description для каждого endpoint
- примеры для параметров и тела запроса
Используй стандартный подход через аргументы декоратора и docstring.
```

## Тестирование API через curl

```bash
# GET запрос
curl http://localhost:8000/tasks

# POST с данными
curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Новая задача"}'

# С API Key
curl http://localhost:8000/protected \
  -H "X-API-Key: твой-ключ"
```

Или используй Swagger UI — там всё можно потыкать через браузер без команд.

---

::: info Что дальше?
API готово — подключи к нему [вебхуки](/practice/19-webhooks) для получения событий извне, или сделай [мониторинг](/practice/16-monitoring) чтобы знать если API упало.
:::
