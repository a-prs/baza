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
