import { Context } from 'koishi'
import {} from '@koishijs/plugin-http'
import { Config } from './config'
import { registerCommands } from './commands'
import { registerConsole } from './console'
import { enUS, zhCN } from './locales'
import { MaibotService } from './service'

export const name = 'mai.ko'
export const usage = '将 maibot 作为 docker 托管的消息回复后端运行，使用 mai.ko 桥接消息收发。'
export const inject = {
  required: ['http'],
  optional: ['console'],
}
export { Config }
export type { Config as MaibotConfig } from './config'

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh-CN', zhCN)
  ctx.i18n.define('en-US', enUS)

  const service = new MaibotService(ctx, config)
  registerCommands(ctx, config)
  registerConsole(ctx, config)

  ctx.middleware((session, next) => service.handleSession(session, next), true)

  ctx.on('ready', () => {
    if (!config.autoStart) return
    service.launch().catch((error) => {
      ctx.logger('mai.ko').warn(error)
    })
  })

  ctx.on('dispose', () => service.dispose())
}
