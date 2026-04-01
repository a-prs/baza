---
layout: home

hero:
  name: Вайб-кодинг с нуля
  text: Создавай проекты с помощью ИИ
  tagline: База знаний для тех, кто никогда не программировал, но хочет делать свои сайты, боты и приложения
  actions:
    - theme: brand
      text: Начать с теории →
      link: /theory/01-basic-concepts
    - theme: alt
      text: Быстрый старт (бесплатно)
      link: /practice/00-quickstart

features:
  - icon: 📖
    title: Теория
    details: Понятным языком объясняем все термины — от терминала до сервера. С бытовыми аналогиями, чтобы было понятно каждому.
    link: /theory/01-basic-concepts
  - icon: 🛠
    title: Практика
    details: Пошаговые инструкции — от установки VS Code до деплоя на сервер. Скачал, установил, работает.
    link: /practice/00-quickstart
  - icon: 🤖
    title: ИИ делает код за тебя
    details: Ты говоришь что хочешь — ИИ пишет. Не нужно знать языки программирования, нужно уметь объяснять задачу.
  - icon: 🚀
    title: От нуля до деплоя
    details: К концу гайда у тебя будет свой проект в интернете с привязанным доменом. Не теория ради теории.
---

<div class="coming-soon-section">
  <h2 class="coming-soon-title">Скоро</h2>
  <div class="coming-soon-grid">
    <div class="coming-soon-card">
      <div class="coming-soon-icon">📦</div>
      <h3>Готовые решения</h3>
      <p>Шаблоны проектов, готовые промпты и рецепты — скопировал, запустил, работает.</p>
      <span class="coming-soon-badge">В разработке</span>
    </div>
    <div class="coming-soon-card">
      <div class="coming-soon-icon">💡</div>
      <h3>Как создать своё приложение</h3>
      <p>От идеи до рабочего продукта: планирование, разработка с ИИ, деплой и поддержка.</p>
      <span class="coming-soon-badge">В разработке</span>
    </div>
  </div>
</div>

<style>
.coming-soon-section {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px 64px;
}

.coming-soon-title {
  text-align: center;
  font-size: 1.4em;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-bottom: 24px;
}

.coming-soon-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

@media (max-width: 640px) {
  .coming-soon-grid {
    grid-template-columns: 1fr;
  }
}

.coming-soon-card {
  position: relative;
  border: 2px dashed var(--vp-c-divider);
  border-radius: 12px;
  padding: 28px 24px;
  opacity: 0.55;
  transition: all 0.3s ease;
  background: var(--vp-c-bg-soft);
  cursor: default;
}

.coming-soon-card:hover {
  opacity: 0.75;
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.coming-soon-icon {
  font-size: 1.8em;
  margin-bottom: 12px;
}

.coming-soon-card h3 {
  font-size: 1.1em;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
}

.coming-soon-card p {
  font-size: 0.9em;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0;
}

.coming-soon-badge {
  display: inline-block;
  margin-top: 14px;
  padding: 3px 12px;
  font-size: 0.75em;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 20px;
  background: var(--vp-c-brand-soft);
}
</style>
