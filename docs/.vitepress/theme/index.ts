import DefaultTheme from 'vitepress/theme'
import './custom.css'
import TelegramFooter from './TelegramFooter.vue'
import { h } from 'vue'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-after': () => h(TelegramFooter),
    })
  },
}
