import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Вайб-кодинг с нуля',
  description: 'База знаний для тех, кто хочет создавать проекты с помощью ИИ',
  lang: 'ru-RU',

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/favicon.svg',

    nav: [
      { text: 'Теория', link: '/theory/01-basic-concepts' },
      { text: 'Практика', link: '/practice/00-quickstart' },
      { text: 'Готовые решения', link: '/solutions/' },
      { text: 'Услуги', link: '/services/' },
    ],

    sidebar: {
      '/theory/': [
        {
          text: '📖 Теория',
          items: [
            { text: 'Базовые понятия', link: '/theory/01-basic-concepts' },
            { text: 'Что такое вайб-кодинг', link: '/theory/02-what-is-vibecoding' },
            { text: 'Обзор инструментов', link: '/theory/03-tools-overview' },
            { text: 'Структура проекта и CLAUDE.md', link: '/theory/04-project-structure' },
            { text: 'Серверы и домены', link: '/theory/05-servers-and-domains' },
            { text: 'MCP-серверы', link: '/theory/06-mcp-servers' },
            { text: 'Планирование проекта', link: '/theory/07-planning' },
            { text: 'Безопасность', link: '/theory/08-security' },
            { text: 'Как работает HTTP', link: '/theory/09-http-basics' },
            { text: 'Монетизация', link: '/theory/10-monetization' },
            { text: 'AI-агенты', link: '/theory/11-ai-agents' },
            { text: 'Архитектура приложения', link: '/theory/12-architecture' },
            { text: 'Выбор базы данных', link: '/theory/13-database-choice' },
            { text: 'Дизайн REST API', link: '/theory/14-api-design' },
            { text: 'Бизнес-модели продуктов', link: '/theory/15-business-model' },
            { text: 'Продвинутый промпт-инжиниринг', link: '/theory/16-prompt-engineering' },
            { text: 'Отладка AI-продуктов', link: '/theory/17-debugging' },
            { text: 'Масштабирование', link: '/theory/18-scaling' },
            { text: 'Юридика для AI-продукта', link: '/theory/19-legal' },
          ],
        },
      ],
      '/practice/': [
        {
          text: '🛠 Практика',
          items: [
            { text: 'Самый быстрый старт', link: '/practice/00-quickstart' },
            { text: 'Установка рабочего места', link: '/practice/01-setup-workplace' },
            { text: 'Установка Claude Code', link: '/practice/02-install-claude-code' },
            { text: 'Первый проект', link: '/practice/03-first-project' },
            { text: 'Подключение сервера', link: '/practice/04-connect-server' },
            { text: 'Установка n8n', link: '/practice/05-install-n8n' },
            { text: 'MCP-сервер n8n', link: '/practice/06-mcp-n8n-setup' },
            { text: 'Low-code деплой', link: '/practice/07-lowcode-deploy' },
            { text: 'Шпаргалка', link: '/practice/08-cheatsheet' },
            { text: 'Переменные и API-ключи', link: '/practice/09-env-keys' },
            { text: 'Что делать когда сломалось', link: '/practice/10-errors-debugging' },
            { text: 'Telegram-бот с нуля', link: '/practice/11-telegram-bot' },
            { text: 'Git: ветки и откат', link: '/practice/12-git-basics' },
            { text: 'Несколько проектов на сервере', link: '/practice/13-multiple-projects' },
            { text: 'Библиотека промптов', link: '/practice/14-prompt-library' },
            { text: 'Базы данных', link: '/practice/15-databases' },
            { text: 'Мониторинг', link: '/practice/16-monitoring' },
            { text: 'Python-скрипты', link: '/practice/17-python-scripts' },
            { text: 'Вебхуки', link: '/practice/19-webhooks' },
            { text: 'Деплой без сервера', link: '/practice/20-deploy-platforms' },
            { text: 'Внешние API', link: '/practice/21-external-apis' },
            { text: 'Тестирование', link: '/practice/22-testing' },
            { text: 'Работа с файлами', link: '/practice/23-files' },
            { text: 'FastAPI: своё API', link: '/practice/24-fastapi' },
            { text: 'Рефакторинг кода', link: '/practice/25-refactoring' },
            { text: 'Docker', link: '/practice/26-docker' },
            { text: 'Фоновые задачи', link: '/practice/27-async-tasks' },
            { text: 'Telegram FSM: диалоги', link: '/practice/28-telegram-fsm' },
            { text: 'Redis: кэш и очереди', link: '/practice/29-redis' },
            { text: 'LLM API: ИИ в приложении', link: '/practice/30-llm-api' },
            { text: 'Векторный поиск и RAG', link: '/practice/31-vector-search' },
            { text: 'Отправка email', link: '/practice/32-email' },
            { text: 'WebSocket: реальное время', link: '/practice/33-websockets' },
            { text: 'Playwright: JS-сайты', link: '/practice/34-playwright' },
            { text: 'Планировщик задач', link: '/practice/35-scheduler' },
            { text: 'Генерация изображений', link: '/practice/36-image-gen' },
            { text: 'Несколько ботов из одного кода', link: '/practice/37-multibot' },
            { text: 'Пагинация: кнопки Назад/Вперёд', link: '/practice/38-pagination-bot' },
            { text: 'Мультиязычный бот (i18n)', link: '/practice/39-i18n' },
            { text: 'Telegram Admin Panel', link: '/practice/40-admin-panel' },
            { text: 'Rate Limiting', link: '/practice/41-rate-limiting' },
            { text: 'OAuth: вход через Google', link: '/practice/42-oauth' },
            { text: 'Кэширование', link: '/practice/43-caching' },
            { text: 'Отслеживание ошибок', link: '/practice/44-error-tracking' },
            { text: 'CI/CD: автодеплой', link: '/practice/45-ci-cd' },
            { text: 'Миграции БД', link: '/practice/46-migrations' },
            { text: 'Безопасные вебхуки (HMAC)', link: '/practice/47-webhook-security' },
            { text: 'Serverless функции', link: '/practice/48-serverless' },
            { text: 'Работа с PDF', link: '/practice/49-pdf-processing' },
            { text: 'Куда расти дальше', link: '/practice/18-roadmap' },
          ],
        },
      ],
      '/solutions/': [
        {
          text: '📦 Готовые решения',
          items: [
            { text: 'Обзор', link: '/solutions/' },
            { text: 'QwenClaw — ИИ в Telegram', link: '/solutions/qwenclaw' },
            { text: 'RSS-бот в Telegram', link: '/solutions/rss-bot' },
            { text: 'Монитор цен', link: '/solutions/price-monitor' },
            { text: 'Автопостинг из Sheets', link: '/solutions/google-sheets-bot' },
            { text: 'AI-дайджест в Telegram', link: '/solutions/n8n-ai-digest' },
            { text: 'Telegram Mini App', link: '/solutions/telegram-mini-app' },
            { text: 'Лендинг с формой', link: '/solutions/lead-landing' },
            { text: 'Бот с оплатой', link: '/solutions/payment-bot' },
            { text: 'RAG-бот: чат с документами', link: '/solutions/rag-bot' },
            { text: 'Оплата Telegram Stars', link: '/solutions/telegram-stars' },
            { text: 'Автопостинг из Notion', link: '/solutions/notion-bot' },
            { text: 'AI-ревьюер текстов', link: '/solutions/ai-reviewer' },
            { text: 'Планировщик контента с AI', link: '/solutions/content-scheduler' },
            { text: 'Voice-бот: голос → Claude', link: '/solutions/voice-bot' },
            { text: 'Мини-CRM в Telegram', link: '/solutions/crm-bot' },
            { text: 'Бот-отчётчик: Excel/PDF/CSV', link: '/solutions/data-export-bot' },
            { text: 'Бот с платной подпиской', link: '/solutions/subscription-bot' },
            { text: 'Автопостинг из Airtable', link: '/solutions/airtable-bot' },
          ],
        },
      ],
    },

    outline: {
      label: 'На этой странице',
      level: [2, 3],
    },

    docFooter: {
      prev: '← Назад',
      next: 'Далее →',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск' },
          modal: {
            noResultsText: 'Ничего не найдено',
            resetButtonTitle: 'Сбросить',
            footer: { selectText: 'выбрать', navigateText: 'навигация', closeText: 'закрыть' },
          },
        },
      },
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com' },
    ],
  },
})
