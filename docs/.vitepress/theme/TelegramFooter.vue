<template>
  <div class="tg-footer">
    <a href="https://t.me/+5ylv4BVomfJiNDRi" target="_blank" rel="noopener">
      <span class="tg-icon">✈</span>
      <span>Подписывайся на Telegram-канал — новости, кейсы, лайфхаки по вайб-кодингу</span>
      <span class="tg-arrow">→</span>
    </a>
  </div>
</template>

<style scoped>
.tg-footer {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
}

.tg-footer a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(0, 136, 204, 0.08) 0%, rgba(124, 58, 237, 0.08) 100%);
  border: 1px solid rgba(0, 136, 204, 0.2);
  text-decoration: none !important;
  color: var(--vp-c-text-1) !important;
  font-size: 0.9em;
  transition: all 0.3s ease;
}

.tg-footer a:hover {
  border-color: #0088cc;
  background: linear-gradient(135deg, rgba(0, 136, 204, 0.14) 0%, rgba(124, 58, 237, 0.14) 100%);
  transform: translateY(-1px);
}

.tg-icon {
  font-size: 1.3em;
  flex-shrink: 0;
}

.tg-arrow {
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.3s;
}

.tg-footer a:hover .tg-arrow {
  opacity: 1;
}
</style>
