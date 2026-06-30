# OAuth2: вход через Google / GitHub

OAuth2 позволяет пользователю войти кнопкой «Войти через Google» — без создания нового пароля. Ты получаешь email и базовый профиль, пользователь — удобный вход.

## Как это работает

```
1. Пользователь нажимает «Войти через Google»
2. Редирект на страницу Google с параметрами (твой client_id, scope)
3. Пользователь даёт разрешение на странице Google
4. Google редиректит обратно с кодом авторизации (?code=...)
5. Твой сервер обменивает код на access_token (server-to-server)
6. Получаешь профиль пользователя (email, имя)
7. Создаёшь/обновляешь запись в БД и выдаёшь свою сессию/JWT
```

## Настройка Google OAuth

1. Зайди на [console.cloud.google.com](https://console.cloud.google.com)
2. «APIs & Services» → «Credentials» → «Create OAuth client ID»
3. Application type: **Web application**
4. Authorized redirect URIs: `http://localhost:8000/auth/google/callback`
5. Скопируй Client ID и Client Secret

## FastAPI + Authlib

```bash
pip install fastapi uvicorn authlib httpx python-jose[cryptography]
```

```python
# main.py
import os
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, JSONResponse
from authlib.integrations.httpx_client import AsyncOAuth2Client
import httpx
import jwt
import time

app = FastAPI()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://localhost:8000/auth/google/callback")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key")


@app.get("/auth/google/login")
async def google_login():
    """Редиректим пользователя на Google"""
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
    }
    from urllib.parse import urlencode
    url = "https://accounts.google.com/o/oauth2/auth?" + urlencode(params)
    return RedirectResponse(url)


@app.get("/auth/google/callback")
async def google_callback(code: str, state: str = None):
    """Google редиректит сюда с кодом"""
    # Обменять код на токен
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            }
        )
        tokens = token_response.json()
    
    access_token = tokens.get("access_token")
    
    # Получить профиль пользователя
    async with httpx.AsyncClient() as client:
        profile_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        profile = profile_response.json()
    
    # profile = {"id": "...", "email": "user@gmail.com", "name": "Андрей", "picture": "..."}
    
    # Найти или создать пользователя в БД
    user = find_or_create_user(
        google_id=profile["id"],
        email=profile["email"],
        name=profile.get("name", "")
    )
    
    # Выдать JWT-токен
    my_token = create_jwt(user_id=user["id"], email=user["email"])
    
    # Редирект на фронтенд с токеном
    return RedirectResponse(f"/dashboard?token={my_token}")


def create_jwt(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": int(time.time()) + 86400 * 30,  # 30 дней
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def find_or_create_user(google_id: str, email: str, name: str) -> dict:
    """Найти юзера по google_id или создать нового"""
    import sqlite3
    conn = sqlite3.connect("app.db")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            google_id TEXT UNIQUE,
            email TEXT UNIQUE,
            name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    user = conn.execute(
        "SELECT * FROM users WHERE google_id = ?", (google_id,)
    ).fetchone()
    
    if not user:
        conn.execute(
            "INSERT OR IGNORE INTO users (google_id, email, name) VALUES (?, ?, ?)",
            (google_id, email, name)
        )
        conn.commit()
        user = conn.execute(
            "SELECT * FROM users WHERE google_id = ?", (google_id,)
        ).fetchone()
    
    conn.close()
    return dict(user) if user else {}
```

## Защита эндпоинтов через JWT

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return {"user_id": int(payload["sub"]), "email": payload["email"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.get("/api/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

@app.get("/api/dashboard")
async def dashboard(current_user: dict = Depends(get_current_user)):
    return {"message": f"Привет, {current_user['email']}!"}
```

## GitHub OAuth (для developer-продуктов)

Настройка: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.

```python
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")


@app.get("/auth/github/login")
async def github_login():
    from urllib.parse import urlencode
    params = {
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": "http://localhost:8000/auth/github/callback",
        "scope": "user:email",
    }
    return RedirectResponse("https://github.com/login/oauth/authorize?" + urlencode(params))


@app.get("/auth/github/callback")
async def github_callback(code: str):
    async with httpx.AsyncClient() as client:
        # Получить токен
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
            },
            headers={"Accept": "application/json"}
        )
        access_token = token_resp.json()["access_token"]
        
        # Получить профиль
        profile_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        profile = profile_resp.json()
        
        # Получить email (может быть приватным)
        emails_resp = await client.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        emails = emails_resp.json()
        primary_email = next((e["email"] for e in emails if e["primary"]), None)
    
    return {"github_id": profile["id"], "login": profile["login"], "email": primary_email}
```

## Промпт для добавления OAuth в проект

```
Добавь Google OAuth в мой FastAPI-проект.
Уже есть: users таблица (id, email, name, created_at), роут /dashboard (HTML).

Нужно:
- GET /auth/google/login — редирект на Google
- GET /auth/google/callback — обработка кода, создание/нахождение юзера
- JWT в куке (HttpOnly, Secure, SameSite=Lax) на 30 дней
- Зависимость get_current_user для защищённых роутов
- Кнопка «Войти через Google» на /login.html

Переменные: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET в .env
```

---

::: info Безопасность OAuth
Всегда проверяй `state` параметр для защиты от CSRF. Токены храни в httpOnly куках (не в localStorage — там их могут украсть через XSS). Используй HTTPS в продакшне.
:::
