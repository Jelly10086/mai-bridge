import { Logger, type Awaitable, type Context, type Fragment, type Session } from 'koishi'
import type { Config } from '../config'
import type { RuntimeStatus } from '../types'

const logger = new Logger('mai.ko/commands')

function formatTime(value?: number) {
  return value ? new Date(value).toLocaleString() : '-'
}

export function renderStatus(status: RuntimeStatus) {
  const lines = [
    `mai.ko 进程: ${status.process.state}`,
    `准备: ${status.prepare.state}`,
    `Docker: ${status.docker.state} / ${status.docker.containerName}`,
    `PID: ${status.process.pid ?? '-'}`,
    `Bridge: ${status.transport.state}`,
    `URL: ${status.transport.url ?? '-'}`,
    `重连次数: ${status.transport.reconnectAttempts}`,
    `中转: Koishi收=${status.bridge.koishiReceived} / 发往mai.ko=${status.bridge.maimSent} / 收到mai.ko=${status.bridge.maimReceived} / 回发Koishi=${status.bridge.koishiSent}`,
    `中转异常: 路由失败=${status.bridge.routeMissed} / 发送失败=${status.bridge.sendFailed}`,
    `触发限制: 群聊跳过=${status.bridge.groupTriggerSkipped} / 私信跳过=${status.bridge.directTriggerSkipped}`,
    `启动时间: ${formatTime(status.process.startedAt)}`,
  ]
  if (status.process.blockedReason) lines.push(`阻塞原因: ${status.process.blockedReason}`)
  if (status.prepare.blockedReason) lines.push(`准备阻塞: ${status.prepare.blockedReason}`)
  if (status.prepare.lastError) lines.push(`准备错误: ${status.prepare.lastError}`)
  if (status.docker.lastError) lines.push(`Docker 错误: ${status.docker.lastError}`)
  if (status.process.lastError) lines.push(`进程错误: ${status.process.lastError}`)
  if (status.transport.lastError) lines.push(`Bridge 错误: ${status.transport.lastError}`)
  if (status.bridge.lastError) lines.push(`中转错误: ${status.bridge.lastError}`)
  const logs = status.logs.slice(-5)
  if (logs.length) {
    lines.push('', '最近日志:', ...logs)
  }
  return lines.join('\n')
}

export async function sendCommandResult(session: Session, config: Config, content: string): Promise<Fragment | void> {
  if (config.commandResultMode === 'silent') return
  if (config.commandResultMode !== 'admin') return content

  const userId = config.commandResultAdminUserId.trim() || session.userId
  if (!userId) return 'mai.ko 指令结果发送失败：没有可用的管理员用户 ID。'
  if (!session.bot?.sendPrivateMessage) return 'mai.ko 指令结果发送失败：当前平台不支持私聊发送。'

  try {
    const guildId = config.commandResultAdminGuildId.trim() || undefined
    await session.bot.sendPrivateMessage(userId, content, guildId, { session })
    if (config.commandResultNotifySource) return 'mai.ko 指令结果已发送给管理员。'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`send command result failed: user=${userId} error=${message}`)
    return `mai.ko 指令结果发送失败：${message}`
  }
}

async function handleCommandResult(session: Session | undefined, config: Config, status: Awaitable<RuntimeStatus>) {
  const content = renderStatus(await status)
  return session ? sendCommandResult(session, config, content) : content
}

export function registerCommands(ctx: Context, config: Config) {
  const options = { authority: config.commandAuthority }

  ctx.command('mai.ko', '查看 mai.ko 托管状态', options)
    .alias('maibot')
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.getStatus()))

  ctx.command('mai.ko.status', '查看 mai.ko 托管状态', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.getStatus()))

  ctx.command('mai.ko.start', '启动 mai.ko', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.launch()))

  ctx.command('mai.ko.stop', '停止 mai.ko', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.shutdown()))

  ctx.command('mai.ko.restart', '重启 mai.ko', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.restart()))

  ctx.command('mai.ko.reconnect', '重连 mai.ko Bridge', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.reconnect()))

  ctx.command('mai.ko.prepare', '准备 MaiBot 源码、补丁与 Docker 镜像', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.prepare()))

  ctx.command('mai.ko.docker.start', '启动 maimai-ko Docker 容器', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.dockerStart()))

  ctx.command('mai.ko.docker.stop', '停止 maimai-ko Docker 容器', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.dockerStop()))

  ctx.command('mai.ko.docker.restart', '重建并重启 maimai-ko Docker 容器', options)
    .action((argv) => handleCommandResult(argv.session, config, ctx.maimai.dockerRestart()))
}
