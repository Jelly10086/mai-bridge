import { existsSync } from 'fs'
import { join } from 'path'
import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { Logger, type Context } from 'koishi'
import type { Config } from '../config'
import type { ProcessState, RuntimeStatus } from '../types'
import { parseCommandLine, redactSecret } from '../utils/command'
import { resolveMaibotRoot } from '../utils/paths'
import { prepareAgreementEnv } from './agreements'
import { createOrReadApiKey } from './runtime-key'

type ProcessLogStream = 'stdout' | 'stderr'

export class MaibotProcessManager {
  private logger = new Logger('mai.ko/process')
  private child?: ChildProcessByStdio<null, Readable, Readable>
  private state: ProcessState = 'idle'
  private logs: string[] = []
  private lastError?: string
  private blockedReason?: string
  private startedAt?: number
  private stoppedAt?: number
  private exitCode?: number | null
  private signal?: NodeJS.Signals | null

  constructor(
    private ctx: Context,
    private config: Config,
    private apiKey: string,
  ) {}

  get isRunning() {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  getStatus(): RuntimeStatus['process'] {
    return {
      state: this.state,
      pid: this.child?.pid,
      exitCode: this.exitCode,
      signal: this.signal,
      blockedReason: this.blockedReason,
      lastError: this.lastError,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
    }
  }

  getLogs() {
    return [...this.logs]
  }

  markReady() {
    if (this.state === 'starting' && this.isRunning) {
      this.state = 'running'
    }
  }

  async start() {
    if (this.isRunning) return
    this.blockedReason = undefined
    this.lastError = undefined
    const preflight = this.preflight()
    if (!preflight.ok) {
      this.state = 'blocked'
      this.blockedReason = preflight.reason
      this.logger.warn(preflight.reason)
      return
    }

    const [command, ...baseArgs] = parseCommandLine(this.config.pythonCommand)
    if (!command) {
      this.state = 'blocked'
      this.blockedReason = 'pythonCommand is empty'
      return
    }

    const root = resolveMaibotRoot(this.config)
    const scriptPath = join(root, this.config.entryScript)
    const args = [...baseArgs, scriptPath]
    const env = this.buildEnv(preflight.env)

    this.logger.info(`starting mai.ko: ${command} ${args.join(' ')}`)
    this.logger.debug(`mai.ko api key: ${redactSecret(this.apiKey)}`)
    this.state = 'starting'
    this.startedAt = Date.now()
    this.stoppedAt = undefined
    this.exitCode = undefined
    this.signal = undefined

    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.child = child
    child.stdout.on('data', (data) => this.pushLog(data, 'stdout'))
    child.stderr.on('data', (data) => this.pushLog(data, 'stderr'))
    child.on('error', (error) => {
      this.lastError = error.message
      this.state = 'error'
      this.logger.warn(error)
    })
    child.on('exit', (code, signal) => {
      this.exitCode = code
      this.signal = signal
      this.stoppedAt = Date.now()
      if (this.child === child) this.child = undefined
      if (this.state !== 'stopping') {
        this.state = code === 0 ? 'stopped' : 'error'
      } else {
        this.state = 'stopped'
      }
      this.logger.info(`mai.ko exited with code=${code} signal=${signal}`)
    })
  }

  async stop() {
    const child = this.child
    if (!child) {
      this.state = 'stopped'
      return
    }
    this.state = 'stopping'
    child.kill('SIGINT')
    const stopped = await this.waitExit(child, this.config.shutdownTimeout)
    if (stopped) return
    child.kill('SIGTERM')
    const terminated = await this.waitExit(child, Math.max(1000, Math.floor(this.config.shutdownTimeout / 2)))
    if (terminated) return
    child.kill('SIGKILL')
    await this.waitExit(child, 1000)
  }

  private preflight(): { ok: true; env: Record<string, string> } | { ok: false; reason: string } {
    const root = resolveMaibotRoot(this.config)
    const script = join(root, this.config.entryScript)
    if (!existsSync(root)) return { ok: false, reason: `mai.ko root does not exist: ${root}` }
    if (!existsSync(script)) return { ok: false, reason: `mai.ko entry script does not exist: ${script}` }

    const agreements = prepareAgreementEnv(root, { accept: this.config.acceptMaibotAgreements })
    if (!agreements.ok) return agreements
    return { ok: true, env: agreements.env }
  }

  private buildEnv(extra: Record<string, string>) {
    return {
      ...process.env,
      ...extra,
      MAIBOT_WORKER_PROCESS: '1',
      MAIBOT_KOISHI_MODE: '1',
      MAIBOT_KOISHI_API_HOST: this.config.apiHost,
      MAIBOT_KOISHI_API_PORT: String(this.config.apiPort),
      MAIBOT_KOISHI_API_KEY: this.apiKey,
      MAIBOT_KOISHI_LEGACY_HOST: this.config.legacyHost,
      MAIBOT_KOISHI_LEGACY_PORT: String(this.config.legacyPort),
      MAIBOT_KOISHI_WEBUI_ENABLED: this.config.webuiEnabled ? '1' : '0',
      MAIBOT_KOISHI_WEBUI_HOST: this.config.webuiHost,
      MAIBOT_KOISHI_WEBUI_PORT: String(this.config.webuiPort),
    }
  }

  private pushLog(data: Buffer | string, stream: ProcessLogStream) {
    const lines = String(data).split(/\r?\n/).map((line) => this.sanitizeLogLine(line)).filter(Boolean)
    this.logs.push(...lines)
    if (this.logs.length > this.config.logLines) {
      this.logs.splice(0, this.logs.length - this.config.logLines)
    }

    if (!this.config.forwardStartupLogs || this.state !== 'starting') return
    for (const line of lines) {
      if (stream === 'stderr') {
        this.logger.warn(line)
      } else {
        this.logger.info(line)
      }
    }
  }

  private sanitizeLogLine(line: string) {
    let result = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trimEnd()
    const encodedApiKey = encodeURIComponent(this.apiKey)
    for (const secret of [this.apiKey, encodedApiKey]) {
      if (!secret) continue
      result = result.split(secret).join(redactSecret(this.apiKey))
    }
    return result
  }

  private waitExit(child: ChildProcessByStdio<null, Readable, Readable>, timeout: number) {
    if (child.exitCode !== null) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const dispose = this.ctx.setTimeout(() => {
        cleanup()
        resolve(false)
      }, timeout)
      const onExit = () => {
        cleanup()
        resolve(true)
      }
      const cleanup = () => {
        dispose()
        child.off('exit', onExit)
      }
      child.once('exit', onExit)
    })
  }
}

export function createApiKey(config: Config) {
  return createOrReadApiKey(config)
}
