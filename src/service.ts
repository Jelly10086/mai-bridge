import { Argv, h, Logger, Service, type Awaitable, type Context, type Fragment, type Session } from 'koishi'
import type { Config } from './config'
import { getFallbackRouteHints, getRouteIdFromMaim, isMentioningBot, maimMessageToFragment, sessionToMaimMessage, shouldForwardSession } from './bridge/convert'
import { MaibotDockerManager } from './bridge/docker'
import { ExternalLogForwarder } from './bridge/external-logs'
import { DirectMessageTrigger, GroupMessageTrigger } from './bridge/group-trigger'
import { MessageHistory } from './bridge/history'
import { MaibotPrepareManager } from './bridge/prepare'
import { MaibotProcessManager, createApiKey } from './bridge/process'
import { RouteRegistry } from './bridge/routes'
import { MaimTransport } from './bridge/transport'
import { readWebuiToken } from './bridge/webui-token'
import { describeFragment, describeMaimMessage, describeSegment, describeSession } from './bridge/logging'
import type { MaimApiMessage, RuntimeStatus } from './types'

function getCommandCandidateSources(session: Session) {
  return uniqueStrings([
    session.stripped?.content,
    session.content,
    getMessageSourceWithoutLeadingSelfAt(session),
  ].map(value => String(value || '').trimStart()).filter(Boolean))
}

function getCommandParseSources(session: Session) {
  const sources: string[] = []

  for (const source of getCommandCandidateSources(session)) {
    sources.push(source)

    const withoutCommonPrefix = source.replace(/^[./!！#]+/, '')
    if (withoutCommonPrefix && withoutCommonPrefix !== source) sources.push(withoutCommonPrefix)
  }

  return uniqueStrings(sources)
}

function getMessageSourceWithoutLeadingSelfAt(session: Session) {
  const selfId = String(session.selfId || '').trim()
  if (!selfId) return ''
  const existing = (session as any).elements
  const elements = Array.isArray(existing) ? existing : h.parse(session.content || '')
  const parts: string[] = []
  let leading = true

  for (const element of elements) {
    if (typeof element === 'string') {
      const text = leading ? element.trimStart() : element
      if (!text) continue
      leading = false
      parts.push(text)
      continue
    }

    if (leading && (element.type === 'quote' || element.type === 'reply')) continue
    if (leading && element.type === 'at') {
      const id = String(element.attrs.id || element.attrs.userId || element.attrs.qq || '').trim()
      if (id === selfId) continue
    }

    if (element.type === 'text') {
      const text = leading ? String(element.attrs.content || '').trimStart() : String(element.attrs.content || '')
      if (!text) continue
      leading = false
      parts.push(text)
      continue
    }

    leading = false
    parts.push(String(element || ''))
  }

  return parts.join('').trimStart()
}

function markCommandAppel(session: Session) {
  session.stripped.hasAt = true
  session.stripped.appel = true
  session.stripped.atSelf = true
  session.stripped.prefix ??= ''
}

export function isMaibotCommandSession(session: Session, config: Config) {
  const source = getMessageSourceWithoutLeadingSelfAt(session)
    || String(session.stripped?.content || session.content || '').trimStart()
  const prefixes = Array.isArray(config.maibotCommandPrefixes)
    ? config.maibotCommandPrefixes
    : ['/']

  return prefixes
    .map(prefix => String(prefix || '').trim())
    .filter(Boolean)
    .some(prefix => source.startsWith(prefix))
}

function snapshotStripped(session: Session) {
  return session.stripped && { ...session.stripped }
}

function restoreStripped(session: Session, stripped?: Session['stripped']) {
  if (!stripped) return
  Object.assign(session.stripped, stripped)
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function parseCommandSources(ctx: Context, session: Session, source: string) {
  const parsed = new Set<Argv>()

  // Command probing must still work when another plugin replaces before-parse.
  try {
    parsed.add(Argv.parse(source))
  } catch {}

  try {
    const argv = ctx.bail?.('before-parse', source, session)
    if (argv) parsed.add(argv)
  } catch {}

  return [...parsed].map((argv) => {
    argv.root = true
    argv.session = session
    return argv
  })
}

export function markKoishiCommandSession(ctx: Context, session: Session) {
  const commander = ctx.$commander
  if (!commander) return false
  const originalStripped = snapshotStripped(session)

  try {
    if (session.argv && commander.resolveCommand(session.argv)) {
      markCommandAppel(session)
      return true
    }

    for (const source of getCommandParseSources(session)) {
      markCommandAppel(session)
      for (const argv of parseCommandSources(ctx, session, source)) {
        if (!commander.resolveCommand(argv)) continue

        ;(session as any).argv = argv
        return true
      }
    }

    restoreStripped(session, originalStripped)
    return false
  } catch {
    restoreStripped(session, originalStripped)
    return false
  }
}

export class MaibotService extends Service {
  private log = new Logger('mai.ko')
  private apiKey: string
  private prepareManager: MaibotPrepareManager
  private docker: MaibotDockerManager
  private process: MaibotProcessManager
  private externalLogs: ExternalLogForwarder
  private groupTrigger: GroupMessageTrigger
  private directTrigger: DirectMessageTrigger
  private history: MessageHistory
  private routes: RouteRegistry
  private transport: MaimTransport
  private desiredRunning = false
  private transportState: RuntimeStatus['transport']['state'] = 'idle'
  private reconnectAttempts = 0
  private lastTransportError?: string
  private connectedAt?: number
  private disconnectedAt?: number
  private externalStartedAt?: number
  private webuiToken?: RuntimeStatus['webui']['token']
  private lastLoggedWebuiToken?: string
  private connectPromise?: Promise<void>
  private reconnectDispose?: () => void
  private lastWarnedTransportError?: string
  private bridge: RuntimeStatus['bridge'] = {
    koishiReceived: 0,
    maimSent: 0,
    maimReceived: 0,
    koishiSent: 0,
    routeMissed: 0,
    sendFailed: 0,
    groupTriggerSkipped: 0,
    directTriggerSkipped: 0,
  }

  constructor(public ctx: Context, private pluginConfig: Config) {
    super(ctx, 'maimai')
    this.apiKey = createApiKey(pluginConfig)
    this.prepareManager = new MaibotPrepareManager(pluginConfig)
    this.docker = new MaibotDockerManager(pluginConfig, this.apiKey)
    this.process = new MaibotProcessManager(ctx, pluginConfig, this.apiKey)
    this.externalLogs = new ExternalLogForwarder(ctx, pluginConfig, [this.apiKey, pluginConfig.apiKey])
    this.groupTrigger = new GroupMessageTrigger(pluginConfig.groupMessageTriggerCount)
    this.directTrigger = new DirectMessageTrigger(pluginConfig.directMessageTriggerCount)
    this.history = new MessageHistory(pluginConfig.routeTtl)
    this.routes = new RouteRegistry(pluginConfig.routeTtl)
    this.transport = new MaimTransport(ctx, pluginConfig, this.apiKey, {
      onMessage: (message) => this.handleMaimMessage(message),
      onClose: () => this.handleTransportClose(),
      onError: (error) => this.handleTransportError(error),
    })
  }

  async launch() {
    this.desiredRunning = true
    if (this.isDockerMode) {
      if (this.pluginConfig.autoPrepareMaibot) {
        const prepare = await this.prepareManager.prepare()
        if (prepare.state === 'blocked' || prepare.state === 'error') return this.getStatus()
      }

      await this.docker.build()
      const dockerStatus = this.docker.getStatus()
      if (dockerStatus.state === 'blocked' || dockerStatus.state === 'error') return this.getStatus()

      await this.docker.start()
      const startedStatus = this.docker.getStatus()
      if (startedStatus.state === 'blocked' || startedStatus.state === 'error') return this.getStatus()

      this.externalStartedAt = Date.now()
      this.externalLogs.start(true)
      await this.connectUntilReady()
      this.refreshWebuiToken(true)
      return this.getStatus()
    }

    if (this.isExternalMode) {
      this.externalStartedAt = Date.now()
      this.externalLogs.start()
      await this.connectUntilReady()
      this.refreshWebuiToken(true)
      return this.getStatus()
    }

    await this.process.start()
    const status = this.process.getStatus()
    if (status.state === 'blocked' || status.state === 'error') {
      return this.getStatus()
    }
    await this.connectUntilReady()
    this.refreshWebuiToken(true)
    return this.getStatus()
  }

  async shutdown() {
    this.desiredRunning = false
    this.transportState = 'disconnected'
    this.clearReconnect()
    await this.transport.disconnect()
    this.externalLogs.stop()
    if (this.isDockerMode) {
      this.externalStartedAt = undefined
      await this.docker.stop()
      return this.getStatus()
    }
    if (this.isExternalMode) {
      this.externalStartedAt = undefined
      return this.getStatus()
    }

    await this.process.stop()
    return this.getStatus()
  }

  async restart() {
    if (this.isDockerMode) {
      this.desiredRunning = true
      this.transportState = 'disconnected'
      this.clearReconnect()
      await this.transport.disconnect()
      this.externalLogs.stop()
      if (this.pluginConfig.autoPrepareMaibot) {
        const prepare = await this.prepareManager.prepare()
        if (prepare.state === 'blocked' || prepare.state === 'error') return this.getStatus()
      }
      await this.docker.restart()
      const dockerStatus = this.docker.getStatus()
      if (dockerStatus.state === 'blocked' || dockerStatus.state === 'error') return this.getStatus()
      this.externalStartedAt = Date.now()
      this.externalLogs.start(true)
      await this.connectUntilReady()
      this.refreshWebuiToken(true)
      return this.getStatus()
    }

    await this.shutdown()
    return this.launch()
  }

  async reconnect() {
    this.desiredRunning = true
    await this.ensureConnected()
    this.refreshWebuiToken(true)
    return this.getStatus()
  }

  async prepare() {
    const prepare = await this.prepareManager.prepare(true)
    if (prepare.state === 'blocked' || prepare.state === 'error') return this.getStatus()
    if (this.isDockerMode) await this.docker.build()
    return this.getStatus()
  }

  async dockerStart() {
    if (this.pluginConfig.autoPrepareMaibot) {
      const prepare = await this.prepareManager.prepare(true)
      if (prepare.state === 'blocked' || prepare.state === 'error') return this.getStatus()
    }
    await this.docker.build()
    const dockerStatus = this.docker.getStatus()
    if (dockerStatus.state === 'blocked' || dockerStatus.state === 'error') return this.getStatus()
    await this.docker.start()
    const startedStatus = this.docker.getStatus()
    if (startedStatus.state === 'blocked' || startedStatus.state === 'error') return this.getStatus()
    if (startedStatus.state === 'running') {
      this.externalStartedAt = Date.now()
      this.externalLogs.start(true)
    }
    return this.getStatus()
  }

  async dockerStop() {
    this.externalLogs.stop()
    await this.docker.stop()
    return this.getStatus()
  }

  async dockerRestart() {
    await this.docker.restart()
    const dockerStatus = this.docker.getStatus()
    if (dockerStatus.state === 'running') {
      this.externalStartedAt = Date.now()
      this.externalLogs.start(true)
    }
    return this.getStatus()
  }

  getStatus(): RuntimeStatus {
    return {
      prepare: this.prepareManager.getStatus(),
      docker: this.docker.getStatus(),
      process: this.getProcessStatus(),
      transport: {
        state: this.transportState,
        url: this.transport.status.url,
        reconnectAttempts: this.reconnectAttempts,
        lastError: this.lastTransportError || this.transport.status.lastError,
        connectedAt: this.connectedAt,
        disconnectedAt: this.disconnectedAt,
      },
      bridge: {
        ...this.bridge,
      },
      webui: this.getWebuiStatus(),
      logs: this.getLogs(),
      logsHint: this.getLogsHint(),
    }
  }

  async handleSession(session: Session, next: () => Awaitable<void | Fragment>): Promise<void | Fragment> {
    if (markKoishiCommandSession(this.ctx, session)) {
      this.log.debug(`pass koishi command: ${describeSession(session)}`)
      return next()
    }

    const maibotCommand = isMaibotCommandSession(session, this.pluginConfig)
    const route = this.routes.remember(session)
    if (!maibotCommand && !shouldForwardSession(session, this.pluginConfig)) {
      this.history.rememberSession(session, route)
      this.log.debug(`skip koishi message: ${describeSession(session)}`)
      return next()
    }

    this.bridge.koishiReceived += 1
    this.bridge.lastKoishiMessageAt = Date.now()
    this.bridge.lastMessageId = String(session.messageId || session.id || '')
    this.logMessageDetail(`koishi message received: ${describeSession(session)}`)

    try {
      const triggerKind = session.isDirect ? 'direct' : 'group'
      const trigger = maibotCommand
        ? (session.isDirect ? this.directTrigger.flush(session, route) : this.groupTrigger.flush(session, route))
        : (session.isDirect
            ? this.directTrigger.test(session, route)
            : this.groupTrigger.test(session, route, isMentioningBot(session)))
      if (!trigger.shouldForward) {
        this.history.rememberSession(session, route)
        if (triggerKind === 'direct') {
          this.bridge.directTriggerSkipped += 1
          this.bridge.lastDirectTriggerCount = trigger.count
          this.bridge.lastDirectTriggerThreshold = trigger.threshold
        } else {
          this.bridge.groupTriggerSkipped += 1
          this.bridge.lastGroupTriggerCount = trigger.count
          this.bridge.lastGroupTriggerThreshold = trigger.threshold
        }
        this.bridge.lastRouteId = route.routeId
        this.logMessageDetail(`koishi -> maimai gated: kind=${triggerKind} route=${route.routeId} count=${trigger.count}/${trigger.threshold} ${describeSession(session)}`)
        if (this.pluginConfig.messageMode === 'exclusive') return ''
        return next()
      }

      if (this.transportState !== 'connected') {
        const error = `bridge is not connected: state=${this.transportState}`
        this.bridge.sendFailed += 1
        this.bridge.lastError = error
        this.log.warn(`koishi -> maimai skipped: ${error}; ${describeSession(session)}`)
        if (this.desiredRunning) this.scheduleReconnect()
        if (this.pluginConfig.messageMode === 'exclusive') return ''
        return next()
      }

      const entries = trigger.entries.length ? trigger.entries : [{ session, route }]
      if (trigger.forceMention) {
        this.logMessageSummary(`${triggerKind} trigger reached: route=${route.routeId} count=${trigger.count}/${trigger.threshold} flushing=${entries.length}`)
      }

      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]
        const commandCandidate = maibotCommand && index === entries.length - 1
        const forceMention = !commandCandidate && !!trigger.forceMention && index === entries.length - 1
        await this.forwardSessionToMaim(entry.session, entry.route, forceMention, commandCandidate)
      }

      if (this.pluginConfig.messageMode === 'exclusive') return ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.bridge.sendFailed += 1
      this.bridge.lastError = message
      this.log.warn(`koishi -> maimai failed: ${describeSession(session)} error=${message}`)
    }

    return next()
  }

  private async forwardSessionToMaim(
    session: Session,
    route: ReturnType<RouteRegistry['remember']>,
    forceMention = false,
    maibotCommandCandidate = false,
  ) {
    const replyTargetId = this.history.getReplyMessageId(session)
    const loadedQuote = await this.loadReplyQuote(session, replyTargetId)
    const replyContext = this.history.resolveReplyContext(session, route, loadedQuote)
    const message = await sessionToMaimMessage(session, route, this.apiKey, {
      resolveImage: (source) => this.resolveImageToBase64(source),
      replyContext,
      forceMention,
      maibotCommandCandidate,
      stripLeadingSelfMention: maibotCommandCandidate,
    })
    this.transport.sendMessage(message)
    this.history.rememberSession(session, route)
    this.bridge.maimSent += 1
    this.bridge.lastMaimSendAt = Date.now()
    this.bridge.lastRouteId = route.routeId
    this.bridge.lastMessageId = message.message_info.message_id
    const replyLog = replyContext ? ` reply=${replyContext.targetMessageId} context=${replyContext.contextCount || 0}` : ''
    const forceLog = forceMention ? ' forced=message-trigger' : ''
    const commandLog = maibotCommandCandidate ? ' command-candidate=maibot' : ''
    this.logMessageDetail(`koishi -> maimai forwarded: route=${route.routeId}${replyLog}${forceLog}${commandLog} ${describeSegment(message.message_segment)}`)
  }

  private async loadReplyQuote(session: Session, targetMessageId?: string) {
    if (!targetMessageId) return
    const quote = (session as any).quote
    if (quote?.content || quote?.elements?.length) return quote

    const bot = (session as any).bot || (session as any).event?.bot
    if (typeof bot?.getMessage === 'function') {
      try {
        const message = await bot.getMessage(session.channelId, targetMessageId)
        if (message?.content || message?.elements?.length) {
          this.logMessageDetail(`koishi reply quote loaded: target=${targetMessageId} source=bot.getMessage`)
          return message
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log.debug(`koishi reply quote load failed: target=${targetMessageId} source=bot.getMessage error=${message}`)
      }
    }

    const onebot = (session as any).onebot
    const internal = bot?.internal || (session as any).event?.bot?.internal
    const getMsg = typeof onebot?.getMsg === 'function'
      ? onebot.getMsg.bind(onebot)
      : typeof internal?.getMsg === 'function'
        ? internal.getMsg.bind(internal)
        : undefined
    if (!getMsg) return quote
    try {
      const message = await getMsg(targetMessageId)
      const loadedQuote = this.history.onebotMessageToQuote(message)
      if (loadedQuote) {
        this.logMessageDetail(`koishi reply quote loaded: target=${targetMessageId} source=onebot.getMsg`)
        return loadedQuote
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.debug(`koishi reply quote load failed: target=${targetMessageId} source=onebot.getMsg error=${message}`)
    }
    return quote
  }

  async dispose() {
    await this.shutdown()
    this.routes.clear()
    this.groupTrigger.clear()
    this.directTrigger.clear()
    this.history.clear()
  }

  private logMessageDetail(message: string) {
    if (this.pluginConfig.messageLogLevel === 'detail') {
      this.log.info(message)
    } else {
      this.log.debug(message)
    }
  }

  private logMessageSummary(message: string) {
    if (this.pluginConfig.messageLogLevel === 'silent') {
      this.log.debug(message)
    } else {
      this.log.info(message)
    }
  }

  private async resolveImageToBase64(source: string) {
    if (!this.pluginConfig.imageDownloadEnabled) {
      this.log.info(`koishi image passthrough skipped: disabled source=${this.describeImageSource(source)}`)
      return
    }

    const timeout = this.pluginConfig.imageDownloadTimeout || 10000
    const maxBytes = this.pluginConfig.imageDownloadMaxBytes || 10 * 1024 * 1024
    try {
      this.log.info(`koishi image downloading: source=${this.describeImageSource(source)}`)
      const arrayBuffer = await this.ctx.http.get(source, {
        responseType: 'arraybuffer',
        timeout,
      })
      const buffer = Buffer.from(arrayBuffer)
      if (!buffer.length) throw new Error('empty image response')
      if (buffer.byteLength > maxBytes) {
        throw new Error(`image too large: ${buffer.byteLength} > ${maxBytes}`)
      }
      this.log.info(`koishi image downloaded: bytes=${buffer.byteLength} source=${this.describeImageSource(source)}`)
      return buffer.toString('base64')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.warn(`koishi image download failed: source=${this.describeImageSource(source)} error=${message}`)
    }
  }

  private describeImageSource(source: string) {
    try {
      const url = new URL(source)
      const path = url.pathname.length > 80 ? `${url.pathname.slice(0, 79)}...` : url.pathname
      return `${url.protocol}//${url.host}${path}${url.search ? '?***' : ''}`
    } catch {
      return source.length > 80 ? `${source.slice(0, 79)}...` : source
    }
  }

  private get isExternalMode() {
    return this.pluginConfig.processMode === 'external'
  }

  private get isDockerMode() {
    return this.pluginConfig.processMode === 'docker'
  }

  private getLogs() {
    const logs = this.isDockerMode
      ? [
          ...this.prepareManager.getLogs(),
          ...this.docker.getLogs(),
          ...this.externalLogs.getLogs(),
        ]
      : this.isExternalMode
        ? this.externalLogs.getLogs()
        : this.process.getLogs()
    return logs.slice(-this.pluginConfig.logLines)
  }

  private getLogsHint() {
    if (this.isDockerMode) {
      return `Docker 模式日志来自准备器、容器管理器与 ${this.pluginConfig.dockerContainerName || 'maimai-ko'} docker logs。`
    }
    if (!this.isExternalMode) return undefined
    if (this.pluginConfig.externalLogsEnabled) {
      return `外部模式日志来自 ${this.pluginConfig.externalLogsContainer || 'maimai-ko'} docker logs。`
    }
    return '外部模式未启用 maimai 容器日志转发。'
  }

  private getProcessStatus(): RuntimeStatus['process'] {
    if (this.isDockerMode) {
      const docker = this.docker.getStatus()
      return {
        state: this.transportState === 'connected'
          ? 'running'
          : docker.state === 'building' || docker.state === 'starting'
            ? 'starting'
            : docker.state === 'blocked'
              ? 'blocked'
              : docker.state === 'error'
                ? 'error'
                : docker.state === 'running'
                  ? 'running'
                  : 'stopped',
        blockedReason: docker.state === 'blocked' ? docker.lastError : undefined,
        lastError: docker.lastError,
        startedAt: this.externalStartedAt,
      }
    }
    if (!this.isExternalMode) return this.process.getStatus()
    return {
      state: this.transportState === 'connected' ? 'running' : 'stopped',
      blockedReason: undefined,
      startedAt: this.externalStartedAt,
    }
  }

  private async connectUntilReady() {
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.doConnectUntilReady()
    try {
      return await this.connectPromise
    } finally {
      this.connectPromise = undefined
    }
  }

  private async ensureConnected() {
    if (this.transportState === 'connected') return
    return this.connectUntilReady()
  }

  private async doConnectUntilReady() {
    this.clearReconnect()
    const deadline = Date.now() + this.pluginConfig.startupTimeout
    let lastError: unknown
    while (Date.now() <= deadline) {
      try {
        this.transportState = 'connecting'
        await this.transport.connect(Math.min(10000, this.pluginConfig.startupTimeout))
        this.transportState = 'connected'
        this.connectedAt = Date.now()
        this.disconnectedAt = undefined
        this.reconnectAttempts = 0
        this.lastTransportError = undefined
        if (!this.isExternalMode && !this.isDockerMode) this.process.markReady()
        this.log.info(`mai.ko bridge connected: ${this.transport.status.url}`)
        return
      } catch (error) {
        lastError = error
        this.lastTransportError = error instanceof Error ? error.message : String(error)
        await this.ctx.sleep(1000)
      }
    }
    this.transportState = 'error'
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'mai.ko websocket connect failed'))
  }

  private handleTransportClose() {
    if (!this.desiredRunning) return
    if (this.transportState === 'connecting') {
      this.disconnectedAt = Date.now()
      return
    }
    this.transportState = 'disconnected'
    this.connectedAt = undefined
    this.disconnectedAt = Date.now()
    this.log.warn('mai.ko bridge disconnected; scheduling reconnect')
    this.scheduleReconnect()
  }

  private handleTransportError(error: Error) {
    this.lastTransportError = error.message
    if (this.lastWarnedTransportError === error.message) return
    this.lastWarnedTransportError = error.message
    this.log.warn(error.message)
  }

  private scheduleReconnect() {
    if (this.reconnectDispose) return
    if (this.pluginConfig.reconnectMaxAttempts > 0 && this.reconnectAttempts >= this.pluginConfig.reconnectMaxAttempts) {
      this.transportState = 'error'
      this.log.warn(`mai.ko bridge reconnect stopped after ${this.reconnectAttempts} attempts`)
      return
    }
    const attempt = ++this.reconnectAttempts
    const delay = Math.min(this.pluginConfig.reconnectBaseDelay * 2 ** (attempt - 1), 30000)
    this.log.info(`mai.ko bridge reconnect scheduled: attempt=${attempt} delay=${delay}ms`)
    this.reconnectDispose = this.ctx.setTimeout(() => {
      this.reconnectDispose = undefined
      if (!this.desiredRunning) return
      this.reconnect().catch((error) => {
        this.lastTransportError = error instanceof Error ? error.message : String(error)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private clearReconnect() {
    this.reconnectDispose?.()
    this.reconnectDispose = undefined
  }

  private getWebuiStatus(): RuntimeStatus['webui'] {
    const publicUrl = this.pluginConfig.webuiPublicUrl.trim()
    return {
      enabled: this.pluginConfig.webuiEnabled,
      host: this.pluginConfig.webuiHost,
      port: this.pluginConfig.webuiPort,
      url: this.pluginConfig.webuiEnabled ? publicUrl || this.createWebuiUrl() : undefined,
      publicUrl: publicUrl || undefined,
      token: this.webuiToken,
    }
  }

  private refreshWebuiToken(shouldLog = false) {
    if (!this.pluginConfig.showWebuiToken) {
      this.webuiToken = undefined
      return
    }

    const result = readWebuiToken(this.pluginConfig)
    this.webuiToken = {
      value: result.token,
      source: result.source,
      path: result.path,
      lastError: result.error,
      loggedAt: result.token ? Date.now() : undefined,
    }

    if (!shouldLog) return
    if (result.token) {
      if (this.lastLoggedWebuiToken === result.token) return
      this.lastLoggedWebuiToken = result.token
      this.log.info(`mai.ko WebUI Token: ${result.token}`)
      this.log.info(`mai.ko WebUI Token 文件: ${result.path}`)
      return
    }

    this.log.warn(result.error)
  }

  private createWebuiUrl() {
    let host = this.pluginConfig.webuiHost.trim() || '127.0.0.1'
    if (host === '0.0.0.0') host = '127.0.0.1'
    if (host === '::') host = '::1'
    const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    const port = this.pluginConfig.processMode === 'docker' && this.pluginConfig.dockerPublishedWebuiPort > 0
      ? this.pluginConfig.dockerPublishedWebuiPort
      : this.pluginConfig.webuiPort
    return `http://${normalizedHost}:${port}`
  }

  private async handleMaimMessage(message: MaimApiMessage) {
    this.bridge.maimReceived += 1
    this.bridge.lastMaimMessageAt = Date.now()
    this.bridge.lastMessageId = message.message_info.message_id
    this.logMessageDetail(`maimai -> koishi received: ${describeMaimMessage(message)}`)

    const routeId = getRouteIdFromMaim(message)
    const hints = getFallbackRouteHints(message)
    const route = this.resolveMaimRoute(routeId, hints)
    if (!route) {
      this.bridge.routeMissed += 1
      this.bridge.lastError = `cannot route mai.ko message ${message.message_info.message_id}`
      this.log.warn(`maimai -> koishi route missed: route=${routeId || '-'} channel=${hints.channelId || '-'} user=${hints.userId || '-'} self=${hints.selfId || '-'} direct=${hints.isDirect}`)
      return
    }

    try {
      const fragment = this.sanitizeReplyQuotes(maimMessageToFragment(message), route)
      this.logMessageDetail(`maimai -> koishi sending: route=${route.routeId} ${describeFragment(fragment)}`)
      const sentIds = await route.session.send(fragment)
      const actualId = sentIds?.[0]
      if (!actualId) {
        this.bridge.sendFailed += 1
        this.bridge.lastError = `koishi send returned no message id for ${message.message_info.message_id}`
        this.log.warn(`maimai -> koishi send produced no id: route=${route.routeId} msg=${message.message_info.message_id}`)
        return
      }

      this.bridge.koishiSent += 1
      this.bridge.lastKoishiSendAt = Date.now()
      this.history.rememberMaimMessage(route, message, actualId, fragment)
      this.logMessageSummary(`relay ok: route=${route.routeId} maim=${message.message_info.message_id} koishi=${actualId} totals=${this.bridge.koishiReceived}/${this.bridge.maimSent}/${this.bridge.maimReceived}/${this.bridge.koishiSent}`)
      try {
        this.transport.sendEcho(message.message_info.message_id, actualId)
      } catch (error) {
        const echoError = error instanceof Error ? error.message : String(error)
        this.log.debug(`maimai echo failed: ${echoError}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.bridge.sendFailed += 1
      this.bridge.lastError = errorMessage
      this.log.warn(`maimai -> koishi failed: msg=${message.message_info.message_id} error=${errorMessage}`)
    }
  }

  private resolveMaimRoute(routeId: string | undefined, hints: ReturnType<typeof getFallbackRouteHints>) {
    if (routeId) return this.routes.get(routeId)

    if (hints.isDirect) {
      if (hints.userId) return this.routes.find(undefined, hints.userId, hints.selfId, { isDirect: true })
      return this.routes.latest({ selfId: hints.selfId, isDirect: true })
        || this.routes.latest({ isDirect: true })
    }

    if (!hints.channelId) return
    return this.routes.find(hints.channelId, hints.userId, hints.selfId, { isDirect: false })
      || this.routes.find(hints.channelId, undefined, hints.selfId, { isDirect: false })
  }

  private sanitizeReplyQuotes(fragment: Fragment, route: ReturnType<RouteRegistry['remember']>): Fragment {
    if (Array.isArray(fragment)) {
      return fragment
        .map(item => this.sanitizeReplyQuotes(item, route))
        .filter(item => item !== '') as h[]
    }
    if (typeof fragment === 'string' || !fragment) return fragment
    if (fragment.type !== 'quote' && fragment.type !== 'reply') return fragment

    const id = String(fragment.attrs.id || fragment.attrs.messageId || fragment.attrs.target || '').trim()
    if (id && this.history.hasMessage(route, id)) return fragment

    this.log.debug(`maimai -> koishi dropped stale quote: route=${route.routeId} quote=${id || '-'}`)
    return ''
  }
}
