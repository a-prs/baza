# Дизайн REST API

Если делаешь API которым будут пользоваться другие (или ты сам через месяц) — важно сделать его предсказуемым. Хороший API — угадывается без документации.

## Именование эндпоинтов

Правила:
- Существительные, не глаголы: `/users` не `/getUsers`
- Множественное число: `/articles`, `/orders`
- Вложенность для связанных ресурсов: `/users/123/orders`
- Нижнее подчёркивание или дефис: `/blog-posts` или `/blog_posts` — выбери одно

```
✓ GET    /articles          — список статей
✓ GET    /articles/42       — одна статья
✓ POST   /articles          — создать статью
✓ PUT    /articles/42       — заменить статью целиком
✓ PATCH  /articles/42       — обновить часть полей
✓ DELETE /articles/42       — удалить

✓ GET    /users/5/orders    — заказы пользователя 5
✓ POST   /users/5/orders    — создать заказ для пользователя 5

✗ GET    /getArticles        — глагол в пути
✗ POST   /article/create     — глагол
✗ GET    /articles/delete/42 — действие в пути
```

## HTTP-методы правильно

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
articles_db = {}  # имитация БД

class Article(BaseModel):
    title: str
    content: str
    published: bool = False

class ArticleUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    published: bool | None = None

@app.get("/articles")
def list_articles(skip: int = 0, limit: int = 20, published: bool | None = None):
    """GET — только чтение, никаких побочных эффектов"""
    items = list(articles_db.values())
    if published is not None:
        items = [a for a in items if a["published"] == published]
    return {"items": items[skip:skip + limit], "total": len(items)}

@app.post("/articles", status_code=201)
def create_article(article: Article):
    """POST — создание; 201 Created"""
    article_id = max(articles_db.keys(), default=0) + 1
    articles_db[article_id] = {"id": article_id, **article.dict()}
    return articles_db[article_id]

@app.patch("/articles/{article_id}")
def update_article(article_id: int, update: ArticleUpdate):
    """PATCH — частичное обновление (только переданные поля)"""
    if article_id not in articles_db:
        raise HTTPException(status_code=404, detail="Article not found")
    
    data = update.dict(exclude_none=True)  # только непустые поля
    articles_db[article_id].update(data)
    return articles_db[article_id]

@app.delete("/articles/{article_id}", status_code=204)
def delete_article(article_id: int):
    """DELETE — 204 No Content"""
    if article_id not in articles_db:
        raise HTTPException(status_code=404, detail="Article not found")
    del articles_db[article_id]
```

## Коды ответов

| Код | Когда использовать |
|-----|--------------------|
| 200 OK | Успешный GET, PUT, PATCH |
| 201 Created | Успешный POST (создание) |
| 204 No Content | Успешный DELETE |
| 400 Bad Request | Неверные данные запроса |
| 401 Unauthorized | Нет авторизации (нет токена) |
| 403 Forbidden | Авторизован, но нет прав |
| 404 Not Found | Ресурс не найден |
| 409 Conflict | Конфликт (дубликат email) |
| 422 Unprocessable | Валидация не прошла (FastAPI default) |
| 429 Too Many Requests | Rate limit |
| 500 Internal Server Error | Ошибка сервера |

## Единый формат ошибок

```python
from fastapi import Request
from fastapi.responses import JSONResponse

# Стандартный формат ошибки
def error_response(status: int, message: str, details: dict = None):
    body = {"error": {"code": status, "message": message}}
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)

@app.exception_handler(404)
async def not_found(request: Request, exc):
    return error_response(404, "Resource not found")

@app.exception_handler(500)
async def server_error(request: Request, exc):
    return error_response(500, "Internal server error")
```

Клиент всегда получает одну структуру — легко обрабатывать.

## Версионирование API

Когда API меняется — старые клиенты не должны ломаться:

```python
# Подход 1: версия в пути (самый распространённый)
@app.get("/v1/articles")
def list_v1():
    return {"version": 1, "items": [...]}

@app.get("/v2/articles")
def list_v2():
    return {"version": 2, "data": [...]}  # другая структура

# Подход 2: в заголовке (чище, но сложнее)
from fastapi import Header

@app.get("/articles")
def list_articles(api_version: str = Header(default="v1")):
    if api_version == "v2":
        return v2_response()
    return v1_response()
```

В реальных проектах: `/v1/` — текущая стабильная, `/v2/` — новая. Держишь обе 6–12 месяцев, потом выкатываешь.

## Пагинация

```python
from pydantic import BaseModel
from typing import Generic, TypeVar

T = TypeVar("T")

class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    pages: int
    has_next: bool
    has_prev: bool

@app.get("/articles", response_model=Page[Article])
def list_articles(page: int = 1, per_page: int = 20):
    total = len(articles_db)
    start = (page - 1) * per_page
    items = list(articles_db.values())[start:start + per_page]
    
    return Page(
        items=items,
        total=total,
        page=page,
        pages=(total + per_page - 1) // per_page,
        has_next=page * per_page < total,
        has_prev=page > 1,
    )
```

## Документация автоматически

FastAPI генерирует Swagger UI из кода:

```python
@app.post("/articles", status_code=201, 
          summary="Создать статью",
          description="Создаёт новую статью и возвращает её с присвоенным ID.")
def create_article(
    article: Article,
    current_user: User = Depends(get_current_user)  # авторизация
) -> Article:
    """
    Создание статьи.
    
    - **title**: заголовок (обязательно)
    - **content**: содержание (обязательно)  
    - **published**: опубликовать сразу (по умолчанию false)
    """
    ...
```

Открой `http://localhost:8000/docs` — интерактивная документация.

## Чеклист хорошего API

- [ ] Существительные в путях, не глаголы
- [ ] Правильные HTTP-методы (GET только читает)
- [ ] Единый формат ошибок
- [ ] Осмысленные коды ответов
- [ ] Пагинация для списков
- [ ] Версионирование с самого начала
- [ ] Авторизация для изменяющих операций
- [ ] Документация (хотя бы OpenAPI/Swagger)

---

::: info Главное правило
Хороший API можно угадать. Если разработчик смотрит на `/users/5/posts` и сразу понимает что это — вы сделали правильно.
:::
