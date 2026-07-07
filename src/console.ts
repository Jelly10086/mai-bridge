import { resolve } from 'path'
import type { Context } from 'koishi'
import type { Config } from './config'

import type {} from '@koishijs/plugin-console'

declare module '@koishijs/plugin-console' {
  interface Events {
    'mai-ko/status'(): ReturnType<Context['maimai']['getStatus']>
    'mai-ko/start'(): ReturnType<Context['maimai']['launch']>
    'mai-ko/stop'(): ReturnType<Context['maimai']['shutdown']>
    'mai-ko/restart'(): ReturnType<Context['maimai']['restart']>
    'mai-ko/reconnect'(): ReturnType<Context['maimai']['reconnect']>
    'mai-ko/prepare'(): ReturnType<Context['maimai']['prepare']>
    'mai-ko/docker-start'(): ReturnType<Context['maimai']['dockerStart']>
    'mai-ko/docker-stop'(): ReturnType<Context['maimai']['dockerStop']>
    'mai-ko/docker-restart'(): ReturnType<Context['maimai']['dockerRestart']>
  }
}

export function registerConsole(ctx: Context, config: Config) {
  if (!config.enableConsole) return
  ctx.inject(['console'], (ctx) => {
    const options = { authority: config.commandAuthority }
    ctx.console.addListener('mai-ko/status', () => ctx.maimai.getStatus(), options)
    ctx.console.addListener('mai-ko/start', () => ctx.maimai.launch(), options)
    ctx.console.addListener('mai-ko/stop', () => ctx.maimai.shutdown(), options)
    ctx.console.addListener('mai-ko/restart', () => ctx.maimai.restart(), options)
    ctx.console.addListener('mai-ko/reconnect', () => ctx.maimai.reconnect(), options)
    ctx.console.addListener('mai-ko/prepare', () => ctx.maimai.prepare(), options)
    ctx.console.addListener('mai-ko/docker-start', () => ctx.maimai.dockerStart(), options)
    ctx.console.addListener('mai-ko/docker-stop', () => ctx.maimai.dockerStop(), options)
    ctx.console.addListener('mai-ko/docker-restart', () => ctx.maimai.dockerRestart(), options)
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })
  })
}
