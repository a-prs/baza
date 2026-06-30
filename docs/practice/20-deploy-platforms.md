# Деплой без своего сервера: Vercel, Railway, Render

Не обязательно сразу брать VPS. Для многих задач хватает бесплатных платформ — они сами управляют сервером, автоматически деплоят из GitHub и масштабируются.

## Когда платформы лучше VPS

| Ситуация | Рекомендация |
|----------|--------------|
| Статический сайт, документация, лендинг | Vercel или Netlify |
| Backend API, Python/Node приложение | Railway или Render |
| Telegram-бот 24/7, фоновые задачи | VPS (нужен постоянный процесс) |
| Прототип, MVP для показа | Любая платформа |
| Продакшн с нагрузкой | VPS или Railway Pro |

::: warning Бесплатные планы и ограничения
Бесплатные планы часто «засыпают» после 15–30 минут без запросов. Для Telegram-бота который должен отвечать 24/7 — нужен VPS или платный план.
:::

## Vercel — лучший для фронтенда

Vercel создан для деплоя статических сайтов и фронтенд-приложений. Next.js, VitePress, Vue, React — всё работает из коробки.

**Бесплатно:** неограниченные деплои, 100GB трафика, кастомные домены.

### Деплой за 3 минуты

1. Создай аккаунт на vercel.com (через GitHub)
2. Нажми **Add New** → **Project**
3. Выбери репозиторий с GitHub
4. Vercel автоматически определит фреймворк
5. Нажми **Deploy**

Каждый `git push` в `main` → автоматический деплой.

### Переменные окружения на Vercel

В интерфейсе: Project → Settings → Environment Variables.

Добавь переменные (аналог `.env`): имя и значение. Они доступны как `process.env.VARIABLE_NAME` (JS) или `os.getenv("VARIABLE_NAME")` (Python).

### Vercel CLI — деплой из терминала

```bash
npm install -g vercel
vercel login
vercel  # деплой текущей папки
vercel --prod  # деплой в продакшн
```

Полезно для тестирования до пуша в GitHub.

### Кастомный домен на Vercel

1. Project → Settings → Domains → Add Domain
2. Добавь свой домен (например, `mysite.com`)
3. В DNS-настройках домена добавь CNAME запись: `@` → `cname.vercel-dns.com`

SSL-сертификат добавляется автоматически.

## Railway — для backend приложений

Railway умеет деплоить Python, Node.js, Go, Ruby и любой Docker. Хорошо подходит для API и приложений с базой данных.

**Бесплатно:** $5 кредитов в месяц (обычно хватает для небольшого проекта).

### Деплой Python-приложения

1. Создай аккаунт на railway.app
2. **New Project** → **Deploy from GitHub repo**
3. Выбери репозиторий
4. Railway ищет `requirements.txt` и запускает `python main.py`

Если нужен другой стартовый файл — укажи в **Settings** → **Build**: `python bot.py`.

### Переменные окружения на Railway

Project → Variables → добавь пары ключ/значение. Автоматически доступны в приложении.

### PostgreSQL на Railway

В Railway встроены управляемые базы данных:

1. **New** → **Database** → **PostgreSQL**
2. Подключись к проекту
3. В Variables появится `DATABASE_URL` — подключи в коде:

```python
import os
import psycopg2

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
```

### Логи и мониторинг

В интерфейсе Railway: вкладка **Deployments** → выбери деплой → **View Logs**.

## Render — альтернатива Railway

Render похож на Railway но с бесплатным планом без кредитного лимита (с ограничением: сервис «засыпает» после 15 минут без запросов).

**Бесплатно:** веб-сервисы, статические сайты, cron-задания.

### Деплой на Render

1. Аккаунт на render.com
2. **New** → **Web Service** → Connect GitHub repo
3. Выбери Runtime (Python, Node, и т.д.)
4. Укажи Build Command: `pip install -r requirements.txt`
5. Укажи Start Command: `python main.py`
6. **Create Web Service**

### Render Cron Jobs

Render умеет запускать скрипты по расписанию бесплатно:

1. **New** → **Cron Job**
2. Command: `/usr/bin/python3 script.py`
3. Schedule: cron-выражение (например `0 9 * * *` — каждый день в 9:00)

Полезно для периодических задач без постоянно работающего сервера.

## Netlify — альтернатива Vercel для статики

Netlify конкурирует с Vercel для статических сайтов. Настройка аналогична:

1. netlify.com → New site from Git
2. Выбери репозиторий
3. Build Command и Publish Directory зависят от фреймворка:
   - VitePress: `npm run build` / `docs/.vitepress/dist`
   - Next.js: `npm run build` / `.next`
   - Просто HTML: не нужен build

## Сравнение платформ

| Платформа | Лучше для | Бесплатно | Ограничения |
|-----------|-----------|-----------|-------------|
| **Vercel** | Статика, Next.js | Да, щедро | Только фронтенд |
| **Railway** | Python/Node backend | $5/мес кредитов | Закончатся — платить |
| **Render** | Backend, API | Да | «Засыпает» без запросов |
| **Netlify** | Статика | Да | Только фронтенд |

## Автоматический деплой из GitHub

Все четыре платформы работают одинаково:
1. Подключаешь GitHub-репозиторий
2. Выбираешь ветку (`main`)
3. Каждый `git push` → автоматический деплой

```bash
# Локальная разработка
git add .
git commit -m "feat: new feature"
git push origin main
# → платформа сама деплоит за 1-2 минуты
```

## Миграция с платформы на VPS

Когда вырос из бесплатного плана или нужно больше контроля — мигрируешь на VPS. Процесс:

1. Код уже есть на GitHub — ничего не теряешь
2. Поднимаешь VPS (см. [главу про сервер](/practice/04-connect-server))
3. Клонируешь репозиторий: `git clone https://github.com/user/repo.git`
4. Настраиваешь `.env`, зависимости, systemd
5. Меняешь DNS домена на IP нового сервера
6. Отключаешь старую платформу

---

::: info Что дальше?
Если решил взять VPS — читай [Подключение сервера](/practice/04-connect-server). Если деплоишь статический сайт или документацию — Vercel подключается за 5 минут без этой главы.
:::
