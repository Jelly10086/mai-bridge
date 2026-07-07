import { Context } from '@koishijs/client'
import Page from './page.vue'

export default (ctx: Context) => {
  ctx.page({
    name: 'mai.ko',
    path: '/mai-ko',
    authority: 3,
    component: Page,
  })
}
