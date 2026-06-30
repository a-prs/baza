# Docker: упакуй приложение в контейнер

Docker решает проблему «у меня работает, у тебя нет». Упаковываешь приложение со всеми зависимостями в контейнер — он одинаково работает везде: на твоей машине, на сервере, у коллеги.

## Что такое контейнер

Контейнер — это изолированная среда запуска. Внутри: твой код + нужная версия Python/Node + все библиотеки. Снаружи: ничего лишнего, никаких конфликтов с другими проектами.

Аналогия: Dockerfile — это рецепт, контейнер — готовое блюдо. Один рецепт всегда даёт одинаковый результат независимо от кухни.

## Установка

```bash
# На Ubuntu/Debian
apt install docker.io -y
systemctl start docker
systemctl enable docker

# Проверить
docker --version
docker run hello-world
```

> 💬 «Установи Docker на Ubuntu и проверь что работает»

## Dockerfile — рецепт контейнера

Для Python-приложения (бота, скрипта, FastAPI):

```dockerfile
# Dockerfile
FROM python:3.11-slim

# Рабочая директория внутри контейнера
WORKDIR /app

# Сначала только зависимости (кэшируется если requirements.txt не менялся)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Потом код
COPY . .

# Команда запуска
CMD ["python", "bot.py"]
```

Для FastAPI/uvicorn:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## .dockerignore — что не копировать

Создай рядом с Dockerfile:

```
.env
.venv
__pycache__
*.pyc
.git
*.log
data/
logs/
```

Без этого в контейнер попадут гигабайты мусора.

## Основные команды

```bash
# Собрать образ (запускать в папке с Dockerfile)
docker build -t my-bot .

# Запустить контейнер
docker run my-bot

# Запустить в фоне (detached)
docker run -d my-bot

# Передать переменные окружения из .env файла
docker run -d --env-file .env my-bot

# Автоперезапуск при падении
docker run -d --restart=always --env-file .env --name my-bot my-bot

# Посмотреть работающие контейнеры
docker ps

# Логи
docker logs my-bot
docker logs -f my-bot  # live

# Остановить / удалить
docker stop my-bot
docker rm my-bot

# Зайти внутрь работающего контейнера
docker exec -it my-bot bash
```

> 💬 «Собери Docker-образ из текущей папки и запусти контейнер my-bot в фоне с .env файлом»

## Docker Compose — несколько контейнеров

Когда приложение состоит из нескольких частей (бот + база данных + Redis), удобно описать всё в одном файле:

```yaml
# docker-compose.yml
services:
  bot:
    build: .
    restart: always
    env_file: .env
    depends_on:
      - db

  db:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Команды:

```bash
# Запустить всё
docker compose up -d

# Остановить всё
docker compose down

# Логи конкретного сервиса
docker compose logs bot -f

# Пересобрать после изменений
docker compose up -d --build
```

> 💬 «Запусти все сервисы из docker-compose.yml в фоне»

## Тома (volumes) — персистентные данные

Данные внутри контейнера исчезают при его удалении. Для сохранения нужны тома:

```bash
# Примонтировать папку с хоста
docker run -v /opt/bot-data:/app/data my-bot

# Или в docker-compose.yml:
services:
  bot:
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
```

> 💬 «Запусти контейнер my-bot с подключённой папкой /opt/bot-data для хранения данных между перезапусками»

Теперь файлы в `/app/data` живут на хосте в `/opt/bot-data` — переживают удаление контейнера.

## Готовые образы для типичных задач

Не нужно всё строить с нуля — берёшь готовый образ:

```bash
# PostgreSQL
docker run -d \
  --name postgres \
  -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16

# Redis (кэш, очереди)
docker run -d --name redis -p 6379:6379 redis:alpine

# n8n
docker run -d \
  --name n8n \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  n8nio/n8n
```

> 💬 «Запусти PostgreSQL и Redis через Docker с персистентными данными»

## Промпты для создания Docker-конфигурации

### Dockerfile для проекта

```
Создай Dockerfile для моего Python-приложения.
Файл входа: bot.py
Python: 3.11
Зависимости: в requirements.txt
Переменные окружения: из .env при запуске (не включать в образ)
Оптимизируй слои кэширования (зависимости отдельно от кода).
```

### Docker Compose с базой

```
Создай docker-compose.yml для:
- Python-приложение (Dockerfile в текущей папке)
- PostgreSQL 16 с персистентным хранилищем
- Переменные из .env
- Приложение стартует только после готовности базы
- Все данные сохраняются при перезапуске
```

### Оптимизация образа

```
Мой Docker образ весит 1.2GB. Это слишком много.
Вот мой Dockerfile:
[вставь Dockerfile]

Как уменьшить размер? Используй:
- slim или alpine базовый образ
- многоэтапную сборку если нужно компилировать
- .dockerignore
```

## Когда Docker нужен, а когда нет

**Нужен:**
- Несколько проектов на одном сервере с разными версиями Python/Node
- Команда — разработчики используют разные ОС
- База данных в изоляции
- Деплой стандартизирован (CI/CD)

**Не обязательно:**
- Один проект на сервере
- Простой Python-скрипт с systemd timer
- Telegram-бот для личного использования

systemd + venv проще для одиночных проектов. Docker — для более сложных конфигураций.

---

::: info Что дальше?
Docker освоен — следующий уровень: [деплой без сервера](/practice/20-deploy-platforms) через Railway/Render, которые принимают Docker-образы напрямую. Или [автоматический деплой](/practice/18-roadmap#автоматический-деплой-через-github-actions) через GitHub Actions.
:::
