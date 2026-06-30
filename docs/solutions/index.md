# Готовые решения

Здесь собраны проекты, которые можно поставить и запустить с минимальными усилиями. Каждое решение — пошаговая инструкция от «ничего нет» до «всё работает».

## Доступные решения

<div class="solutions-grid">

<a href="/solutions/qwenclaw" class="solution-card">
  <div class="solution-icon">🤖</div>
  <h3>QwenClaw</h3>
  <p>Персональный ИИ-ассистент в Telegram. Установка одной командой, 1000 бесплатных запросов в день.</p>
  <span class="solution-tag">Бесплатно</span>
  <span class="solution-tag">10 минут</span>
</a>

<a href="/solutions/rss-bot" class="solution-card">
  <div class="solution-icon">📰</div>
  <h3>RSS-бот в Telegram</h3>
  <p>Автоматический дайджест из любых RSS-источников прямо в Telegram. Настройка через n8n без кода.</p>
  <span class="solution-tag">n8n</span>
  <span class="solution-tag">30 минут</span>
</a>

<a href="/solutions/price-monitor" class="solution-card">
  <div class="solution-icon">📊</div>
  <h3>Монитор цен</h3>
  <p>Скрипт следит за ценой или любым значением на сайте и шлёт уведомление в Telegram при изменении.</p>
  <span class="solution-tag">Python</span>
  <span class="solution-tag">20 минут</span>
</a>

<a href="/solutions/google-sheets-bot" class="solution-card">
  <div class="solution-icon">📋</div>
  <h3>Автопостинг из Google Sheets</h3>
  <p>Ведёшь контент-план в таблице — скрипт сам публикует посты в Telegram-канал по расписанию.</p>
  <span class="solution-tag">Python</span>
  <span class="solution-tag">30 минут</span>
</a>

<a href="/solutions/n8n-ai-digest" class="solution-card">
  <div class="solution-icon">🤖</div>
  <h3>AI-дайджест в Telegram</h3>
  <p>n8n каждое утро собирает новости из RSS, суммаризирует через OpenAI и присылает дайджест.</p>
  <span class="solution-tag">n8n</span>
  <span class="solution-tag">OpenAI</span>
  <span class="solution-tag">30 минут</span>
</a>

<a href="/solutions/telegram-mini-app" class="solution-card">
  <div class="solution-icon">📱</div>
  <h3>Telegram Mini App</h3>
  <p>Веб-приложение прямо внутри Telegram: форма заявки, каталог или калькулятор — без выхода из мессенджера.</p>
  <span class="solution-tag">HTML/JS</span>
  <span class="solution-tag">FastAPI</span>
  <span class="solution-tag">45 минут</span>
</a>

<a href="/solutions/lead-landing" class="solution-card">
  <div class="solution-icon">🚀</div>
  <h3>Лендинг с формой заявки</h3>
  <p>Тёмный одностраничник с формой: пользователь отправляет — тебе мгновенно приходит уведомление в Telegram.</p>
  <span class="solution-tag">HTML/CSS</span>
  <span class="solution-tag">Без сервера</span>
  <span class="solution-tag">20 минут</span>
</a>

<a href="/solutions/payment-bot" class="solution-card">
  <div class="solution-icon">💳</div>
  <h3>Бот с приёмом оплаты</h3>
  <p>Telegram-бот принимает оплату картой прямо в чате через ЮКассу или Stripe. Каталог, инвойс, выдача товара.</p>
  <span class="solution-tag">aiogram 3</span>
  <span class="solution-tag">ЮКасса</span>
  <span class="solution-tag">60 минут</span>
</a>


<a href="/solutions/rag-bot" class="solution-card">
  <div class="solution-icon">🧠</div>
  <h3>RAG-бот: чат с документами</h3>
  <p>Бот отвечает на вопросы только по твоим документам. Загружаешь статьи, FAQ или инструкции — бот знает их наизусть.</p>
  <span class="solution-tag">Python</span>
  <span class="solution-tag">Claude</span>
  <span class="solution-tag">45 минут</span>
</a>

</div>

::: info Раздел растёт
Мы будем добавлять новые готовые решения. Если хочешь увидеть конкретный проект — напиши в Telegram.
:::

<style>
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  margin: 24px 0;
}

.solution-card {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  text-decoration: none !important;
  color: inherit !important;
  transition: all 0.3s ease;
  background: var(--vp-c-bg-soft);
}

.solution-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.1);
}

.solution-icon {
  font-size: 2em;
  margin-bottom: 12px;
}

.solution-card h3 {
  margin: 0 0 8px;
  font-size: 1.2em;
}

.solution-card p {
  margin: 0 0 14px;
  font-size: 0.9em;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.solution-tag {
  display: inline-block;
  padding: 2px 10px;
  font-size: 0.75em;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 20px;
  background: var(--vp-c-brand-soft);
  margin-right: 6px;
}
</style>
