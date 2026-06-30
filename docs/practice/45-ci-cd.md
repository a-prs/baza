# CI/CD: автоматический деплой через GitHub Actions

CI/CD — автоматизация проверки кода и деплоя. Нажал «Пуш в GitHub» → тесты прошли → код сам уехал на сервер.

## Базовый workflow

Файл: `.github/workflows/deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [main]  # запускать при пуше в main

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Deploy via SSH
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /home/office/mybot
            git pull origin main
            source .venv/bin/activate
            pip install -r requirements.txt
            sudo systemctl restart mybot
```

### Настроить секреты GitHub

1. Репо → Settings → Secrets and variables → Actions
2. Добавить:
   - `SERVER_HOST` — IP сервера (например `45.152.87.251`)
   - `SERVER_USER` — пользователь (например `office`)
   - `SERVER_SSH_KEY` — приватный SSH-ключ (содержимое `~/.ssh/id_rsa`)

### Добавить SSH-ключ на сервер

```bash
# На локальной машине — сгенерировать ключ
ssh-keygen -t ed25519 -C "github-actions"

# Добавить публичный ключ на сервер
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server

# Приватный ключ (~/.ssh/id_ed25519) скопировать в GitHub Secret
```

## Тесты перед деплоем

```yaml
name: Test and Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: "3.11"
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest
      
      - name: Run tests
        run: pytest tests/ -v
        env:
          BOT_TOKEN: test_token
          ANTHROPIC_API_KEY: ${{ secrets.TEST_ANTHROPIC_KEY }}
  
  deploy:
    needs: test  # деплоить только если тесты прошли
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /home/office/mybot
            git pull origin main
            source .venv/bin/activate
            pip install -r requirements.txt -q
            sudo systemctl restart mybot
            echo "Деплой завершён: $(date)"
```

## Проверка линтера

```yaml
      - name: Lint with ruff
        run: |
          pip install ruff
          ruff check .
      
      - name: Type check with mypy
        run: |
          pip install mypy
          mypy bot.py --ignore-missing-imports
```

## Деплой на Vercel (для фронтенда)

Vercel сам деплоит из GitHub — просто свяжи репо в настройках. Но можно и явно:

```yaml
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: '--prod'
```

## Деплой Docker-образа

```yaml
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: myusername/mybot:latest
      
      - name: Deploy on server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            docker pull myusername/mybot:latest
            docker compose up -d --no-deps mybot
```

## Нотификации о деплое

```yaml
      - name: Notify Telegram on success
        if: success()
        uses: appleboy/telegram-action@master
        with:
          to: ${{ secrets.TELEGRAM_CHAT_ID }}
          token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          message: |
            ✅ Деплой успешен!
            Репо: ${{ github.repository }}
            Коммит: ${{ github.sha }}
            Автор: ${{ github.actor }}
      
      - name: Notify Telegram on failure
        if: failure()
        uses: appleboy/telegram-action@master
        with:
          to: ${{ secrets.TELEGRAM_CHAT_ID }}
          token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          message: "❌ Деплой упал! Проверь GitHub Actions."
```

## Автоматическая проверка безопасности зависимостей

```yaml
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Check for vulnerabilities
        run: |
          pip install safety
          safety check -r requirements.txt
```

## Ежедневный backup через Actions

```yaml
name: Daily Backup

on:
  schedule:
    - cron: '0 3 * * *'  # каждый день в 3:00 UTC

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Backup database
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            DATE=$(date +%Y%m%d)
            cp /home/office/mybot/app.db /home/office/backups/app-$DATE.db
            ls -la /home/office/backups/
            # Удалить бэкапы старше 30 дней
            find /home/office/backups/ -name "*.db" -mtime +30 -delete
```

## Промпт для настройки CI/CD

```
Настрой GitHub Actions для моего Python-проекта.
Репо: github.com/myuser/mybot

Структура:
- tests/test_bot.py (pytest)
- requirements.txt
- bot.py

Нужно:
1. При PR — запускать pytest + ruff линтер
2. При мерже в main — деплоить на сервер через SSH
3. После деплоя — уведомление в Telegram

Сервер: Ubuntu, пользователь office, путь /home/office/mybot, systemd-юнит mybot.
```

---

::: info Стоимость
GitHub Actions бесплатны для публичных репо и для приватных — 2000 минут/месяц. Обычный деплой занимает 1–3 минуты. Этого хватает для большинства проектов.
:::
