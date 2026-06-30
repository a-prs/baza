# Безопасность: что нужно знать вайб-кодеру

Когда выкладываешь приложение в интернет — его могут взломать, украсть данные пользователей или использовать твой сервер для атак. Большинство взломов происходит из-за типичных ошибок которые легко избежать. Эта глава — о главных из них.

## Правило одно: никогда не доверяй пользовательскому вводу

Всё что приходит снаружи — опасно. Параметры URL, поля форм, JSON в теле запроса, заголовки. Пользователь может отправить что угодно — в том числе специально составленные данные для взлома.

## SQL-инъекция

Если строишь SQL-запрос через конкатенацию строк — уязвим:

```python
# ОПАСНО: пользователь может ввести ' OR '1'='1
username = request.args.get("username")
query = f"SELECT * FROM users WHERE username = '{username}'"
cursor.execute(query)  # взломан!
```

Если ввод: `' OR '1'='1`, запрос становится:
```sql
SELECT * FROM users WHERE username = '' OR '1'='1'
```
Это вернёт всех пользователей сразу.

**Исправление: параметризованные запросы (всегда так)**

```python
username = request.args.get("username")
cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
# или для PostgreSQL:
cursor.execute("SELECT * FROM users WHERE username = %s", (username,))
```

В параметризованных запросах символы экранируются автоматически — они не могут изменить структуру SQL.

Промпт для проверки:
```
Проверь этот код на SQL-инъекции.
Покажи все места где строится SQL-запрос и исправь их на параметризованные.
```

## XSS — межсайтовый скриптинг

XSS позволяет злоумышленнику внедрить JavaScript-код на твой сайт через пользовательские данные.

```python
# ОПАСНО: имя пользователя попадает в HTML без экранирования
name = request.form["name"]
html = f"<h1>Привет, {name}!</h1>"  # если name = "<script>alert('взлом')</script>"
```

**Исправление: экранируй HTML при выводе**

В Jinja2 (Flask):
```python
# Jinja2 экранирует по умолчанию. НЕ используй |safe без необходимости
{{ user_name }}        # безопасно — экранируется
{{ user_name|safe }}   # ОПАСНО — не экранируется
```

В JavaScript:
```javascript
// НЕ использовать innerHTML с пользовательскими данными
element.innerHTML = userInput  // ОПАСНО
element.textContent = userInput  // безопасно — это текст, не HTML
```

## Хранение паролей

Никогда не храни пароли в открытом виде. Даже зашифрованные — ненадёжно. Используй специальные алгоритмы хэширования для паролей:

```python
from passlib.hash import bcrypt

# При регистрации
hashed = bcrypt.hash("пароль_пользователя")
# хранить: hashed (строка вида $2b$12$...)

# При входе
is_valid = bcrypt.verify("введённый_пароль", hashed)
```

bcrypt намеренно медленный — это защищает от брутфорса.

## Переменные окружения: где и как хранить секреты

Никогда не пиши секреты в коде:

```python
# ПЛОХО — токен видят все у кого есть доступ к репозиторию
TOKEN = "1234567890:ABCdef..."

# ХОРОШО
import os
TOKEN = os.getenv("BOT_TOKEN")  # из .env файла
```

Правило для `.gitignore`:

```
.env
*.env
.env.local
credentials.json
*token*.json
*.key
*.pem
```

Если случайно закоммитил секрет — сразу смени токен/ключ. Удаление из истории git — сложная операция и не всегда помогает (GitHub часто кэширует).

## CORS — кто может обращаться к API

Если делаешь API и к нему будет обращаться фронтенд с другого домена — нужно настроить CORS. Но не открывай доступ всем:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# ПЛОХО — разрешает запросы с любого сайта
app.add_middleware(CORSMiddleware, allow_origins=["*"])

# ХОРОШО — только с твоих доменов
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mysite.com", "https://app.mysite.com"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```

## Rate Limiting — защита от перегрузки

Без ограничений один злоумышленник может заспамить тысячи запросов и положить сервер:

```python
from fastapi import FastAPI, Request, HTTPException
from collections import defaultdict
from time import time

app = FastAPI()
requests_count = defaultdict(list)

@app.middleware("http")
async def rate_limit(request: Request, call_next):
    client_ip = request.client.host
    now = time()
    
    # Очищаем старые запросы (старше 60 секунд)
    requests_count[client_ip] = [t for t in requests_count[client_ip] if now - t < 60]
    
    if len(requests_count[client_ip]) >= 30:  # не больше 30 запросов в минуту
        raise HTTPException(status_code=429, detail="Слишком много запросов")
    
    requests_count[client_ip].append(now)
    return await call_next(request)
```

Или используй готовую библиотеку: `pip install slowapi`.

## HTTPS: всегда и везде

Без HTTPS данные передаются открыто — любой посредник может их прочитать. С Certbot и nginx HTTPS настраивается за одну команду (см. [главу про сервер](/practice/04-connect-server)).

Правило: если у тебя есть домен — всегда включай HTTPS. Это бесплатно через Let's Encrypt.

## Валидация входных данных

Проверяй всё что приходит от пользователя:

```python
from pydantic import BaseModel, validator
from fastapi import FastAPI

class UserInput(BaseModel):
    name: str
    age: int
    email: str
    
    @validator("name")
    def name_must_be_reasonable(cls, v):
        if len(v) > 100:
            raise ValueError("Имя слишком длинное")
        return v.strip()
    
    @validator("age")
    def age_must_be_valid(cls, v):
        if not (0 < v < 150):
            raise ValueError("Неверный возраст")
        return v

@app.post("/user")
async def create_user(data: UserInput):
    # data уже валидирована
    ...
```

Pydantic в FastAPI делает это автоматически — просто опиши схему.

## Чеклист безопасности

Перед тем как выпустить проект в продакшн:

- [ ] Все SQL-запросы параметризованы (нет конкатенации строк)
- [ ] Пользовательский ввод экранируется при выводе в HTML
- [ ] Пароли хэшируются через bcrypt/argon2 (не MD5, не SHA1)
- [ ] Секреты в `.env`, файл в `.gitignore`
- [ ] HTTPS включён (Certbot)
- [ ] Нет `allow_origins=["*"]` если это не публичное API
- [ ] Валидация входных данных на всех endpoint

## Попроси ИИ проверить безопасность

После написания кода:

```
Проведи аудит безопасности этого кода.
Найди:
1. SQL-инъекции
2. XSS уязвимости
3. Незащищённые секреты
4. Недостаточную валидацию входных данных
5. Другие очевидные уязвимости

Для каждой проблемы: что за уязвимость, как эксплуатируется, как исправить.
```

ИИ хорошо находит очевидные проблемы. Для критичных проектов — дополнительно используй специализированные инструменты (bandit для Python: `pip install bandit && bandit -r .`).

---

::: info Что дальше?
Безопасность — это не разовая задача, а постоянный процесс. Главное: следи за обновлениями зависимостей (`pip list --outdated`) и никогда не доверяй пользовательскому вводу.
:::
