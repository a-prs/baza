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
          ],
        },
      ],
      '/solutions/': [
        {
          text: '📦 Готовые решения',
          items: [
            { text: 'Обзор', link: '/solutions/' },
            { text: 'QwenClaw — ИИ в Telegram', link: '/solutions/qwenclaw' },
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
