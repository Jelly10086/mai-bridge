import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { Logger, type Context } from 'koishi'
import type { Config } from '../config'
import { parseCommandLine, redactSecret } from '../utils/command'

type LogStream = 'stdout' | 'stderr'

export class ExternalLogForwarder {
  private logger = new Logger('mai.ko/maimai')
  private child?: ChildProcessByStdio<null, Readable, Readable>
  private logs: string[] = []
  private partial: Record<LogStream, string> = {
    stdout: '',
    stderr: '',
  }
  private stopping = false
  private forceEnabled = false
  private restartDispose?: () => void

  constructor(
    private ctx: Context,
    private config: Config,
    private secrets: string[] = [],
  ) {}

  get isRunning() {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  getLogs() {
    return [...this.logs]
  }

  start(force = false) {
    this.forceEnabled = force || this.forceEnabled
    if ((!force && !this.config.externalLogsEnabled) || this.isRunning) return
    this.clearRestart()

    const commandLine = this.buildCommandLine()
    const [command, ...args] = parseCommandLine(commandLine)
    if (!command) {
      this.logger.warn('maimai external log command is empty')
      return
    }

    this.stopping = false
    this.logger.info(`forwarding maimai docker logs: ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child

    child.stdout.on('data', (data) => this.pushLog(data, 'stdout'))
    child.stderr.on('data', (data) => this.pushLog(data, 'stderr'))
    child.on('error', (error) => {
      this.logger.warn(`maimai external log command failed: ${error.message}`)
    })
    child.on('close', (code, signal) => {
      if (this.child === child) this.child = undefined
      this.flushPartial()
      if (this.stopping) return
      this.logger.warn(`maimai external log command exited: code=${code} signal=${signal}`)
      this.scheduleRestart()
    })
  }

  stop() {
    this.stopping = true
    this.forceEnabled = false
    this.clearRestart()
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null || child.killed) return
    child.kill('SIGTERM')
    const dispose = this.setTimer(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 3000)
    child.once('close', dispose)
  }

  private scheduleRestart() {
    if (this.restartDispose || this.stopping || (!this.config.externalLogsEnabled && !this.forceEnabled)) return
    const delay = 5000
    this.logger.info(`maimai external log command restart scheduled: delay=${delay}ms`)
    this.restartDispose = this.setTimer(() => {
      this.restartDispose = undefined
      if (!this.stopping) this.start(this.forceEnabled)
    }, delay)
  }

  private clearRestart() {
    this.restartDispose?.()
    this.restartDispose = undefined
  }

  private setTimer(callback: () => void, delay: number) {
    if (typeof this.ctx.setTimeout === 'function') {
      return this.ctx.setTimeout(callback, delay)
    }
    const timer = setTimeout(callback, delay)
    return () => clearTimeout(timer)
  }

  private buildCommandLine() {
    const tail = String(this.config.externalLogsTail ?? 0)
    const container = this.config.processMode === 'docker'
      ? this.config.dockerContainerName || 'maimai-ko'
      : this.config.externalLogsContainer || 'maimai-ko'
    return this.config.externalLogsCommand
      .replace(/\{tail\}/g, tail)
      .replace(/\{container\}/g, container)
  }

  private pushLog(data: Buffer | string, stream: LogStream) {
    const text = `${this.partial[stream]}${String(data)}`
    const lines = text.split(/\r?\n/)
    this.partial[stream] = lines.pop() || ''

    for (const rawLine of lines) this.writeLine(rawLine, stream)
  }

  private flushPartial() {
    for (const stream of ['stdout', 'stderr'] as const) {
      const line = this.partial[stream]
      this.partial[stream] = ''
      if (line) this.writeLine(line, stream)
    }
  }

  private writeLine(rawLine: string, stream: LogStream) {
    const line = this.sanitizeLine(rawLine)
    if (!line) return
    if (this.config.externalLogsSkipDebug && this.isDebugLine(line)) return
    this.logs.push(`[maimai] ${line}`)
    if (this.logs.length > this.config.logLines) {
      this.logs.splice(0, this.logs.length - this.config.logLines)
    }
    if (stream === 'stderr' && this.isWarningLine(line)) {
      this.logger.warn(line)
    } else {
      this.logger.info(line)
    }
  }

  private isDebugLine(line: string) {
    return /\[(?:DEBUG|TRACE)(?:\s+[^\]]+)?\]|\bDEBUG\b|\bTRACE\b/i.test(line)
  }

  private isWarningLine(line: string) {
    return /error|exception|traceback|failed|failure|warning|warn|错误|异常|失败|告警|警告/i.test(line)
  }

  private sanitizeLine(line: string) {
    let result = line
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/(token|api[_-]?key|password|secret)(\s*[:=]\s*)\S+/gi, '$1$2***REDACTED***')
      .replace(/(Token|令牌)(\s*[:：]\s*)\S+/g, '$1$2***REDACTED***')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-***REDACTED***')
      .trimEnd()

    for (const secret of this.secrets) {
      if (!secret) continue
      result = result.split(secret).join(redactSecret(secret))
      result = result.split(encodeURIComponent(secret)).join(redactSecret(secret))
    }

    if (result.length > 1000) return `${result.slice(0, 999)}...`
    return result
  }
}
