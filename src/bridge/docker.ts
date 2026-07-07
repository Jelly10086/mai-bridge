import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Logger } from 'koishi'
import type { Config } from '../config'
import type { DockerState, RuntimeStatus } from '../types'
import { resolveMaiKoDataDir, resolveMaibotRoot } from '../utils/paths'
import { assertSuccessful, runCommand, type CommandResult } from '../utils/spawn'
import { redactSecret } from '../utils/command'
import { prepareAgreementEnv } from './agreements'

export class MaibotDockerManager {
  private logger = new Logger('mai.ko/docker')
  private state: DockerState = 'idle'
  private lastError?: string
  private updatedAt?: number
  private logs: string[] = []

  constructor(
    private config: Config,
    private apiKey: string,
  ) {}

  getStatus(): RuntimeStatus['docker'] {
    return {
      state: this.state,
      containerName: this.config.dockerContainerName,
      imageName: this.config.dockerImageName,
      lastError: this.lastError,
      updatedAt: this.updatedAt,
    }
  }

  getLogs() {
    return [...this.logs]
  }

  async build() {
    this.state = 'building'
    this.lastError = undefined
    this.updatedAt = Date.now()
    try {
      const root = resolveMaibotRoot(this.config)
      if (!existsSync(root)) {
        throw new Error(`maibotRoot does not exist: ${root}`)
      }
      this.pushLog(`building Docker image: ${this.config.dockerImageName}`)
      const result = await this.docker(['build', '-t', this.config.dockerImageName, root])
      assertSuccessful(result, 'docker build')
      this.state = 'stopped'
      this.updatedAt = Date.now()
    } catch (error) {
      this.fail(error)
    }
  }

  async start() {
    this.lastError = undefined
    this.updatedAt = Date.now()
    try {
      if (this.config.dockerRecreateOnStart) {
        await this.removeContainer(true)
      }

      const exists = await this.containerExists()
      if (!exists) {
        await this.createContainer()
      }

      this.state = 'starting'
      this.pushLog(`starting Docker container: ${this.config.dockerContainerName}`)
      const result = await this.docker(['start', this.config.dockerContainerName])
      assertSuccessful(result, 'docker start')
      this.state = 'running'
      this.updatedAt = Date.now()
    } catch (error) {
      this.fail(error)
    }
  }

  async stop() {
    this.state = 'stopping'
    this.updatedAt = Date.now()
    try {
      const exists = await this.containerExists()
      if (exists) {
        const result = await this.docker(['stop', this.config.dockerContainerName], true)
        if (result.code !== 0) this.pushLog(`docker stop warning: ${result.stderr.trim() || result.stdout.trim()}`)
      }
      this.state = 'stopped'
      this.updatedAt = Date.now()
    } catch (error) {
      this.fail(error)
    }
  }

  async restart() {
    await this.stop()
    await this.removeContainer(true)
    await this.build()
    if (this.state === 'error' || this.state === 'blocked') return
    await this.start()
  }

  private async createContainer() {
    const root = resolveMaibotRoot(this.config)
    const agreements = prepareAgreementEnv(root, { accept: this.config.acceptMaibotAgreements })
    if (!agreements.ok) {
      this.state = 'blocked'
      throw new Error(`blocked: ${agreements.reason}`)
    }

    this.ensureVolumeDirs()
    const args = this.createRunArgs(agreements.env)
    this.pushLog(`creating Docker container: ${this.config.dockerContainerName}`)
    const result = await this.docker(args)
    assertSuccessful(result, 'docker create')
  }

  private createRunArgs(agreementEnv: Record<string, string>) {
    const args = [
      'create',
      '--name',
      this.config.dockerContainerName,
      '--restart',
      'unless-stopped',
    ]

    if (this.config.dockerNetwork) {
      args.push('--network', this.config.dockerNetwork)
    }

    if (this.config.dockerPublishedWebuiPort > 0) {
      args.push('-p', `${this.config.dockerPublishedWebuiPort}:${this.config.webuiPort}`)
    }

    const env = this.buildEnv(agreementEnv)
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`)
    }

    for (const [source, target] of this.volumeMap()) {
      args.push('-v', `${source}:${target}`)
    }

    args.push(this.config.dockerImageName)
    return args
  }

  private buildEnv(agreementEnv: Record<string, string>) {
    return {
      ...agreementEnv,
      TZ: process.env.TZ || 'Asia/Shanghai',
      MAIBOT_WORKER_PROCESS: '1',
      MAIBOT_KOISHI_MODE: '1',
      MAIBOT_KOISHI_API_HOST: '0.0.0.0',
      MAIBOT_KOISHI_API_PORT: String(this.config.apiPort),
      MAIBOT_KOISHI_API_KEY: this.apiKey,
      MAIBOT_KOISHI_LEGACY_HOST: '0.0.0.0',
      MAIBOT_KOISHI_LEGACY_PORT: String(this.config.legacyPort),
      MAIBOT_KOISHI_WEBUI_ENABLED: this.config.webuiEnabled ? '1' : '0',
      MAIBOT_KOISHI_WEBUI_HOST: this.config.webuiHost,
      MAIBOT_KOISHI_WEBUI_PORT: String(this.config.webuiPort),
      WEBUI_HOST: this.config.webuiHost,
    }
  }

  private volumeMap() {
    const dataDir = resolveMaiKoDataDir()
    return [
      [join(dataDir, 'config'), '/MaiMBot/config'],
      [join(dataDir, 'data'), '/MaiMBot/data'],
      [join(dataDir, 'plugins'), '/MaiMBot/plugins'],
      [join(dataDir, 'logs'), '/MaiMBot/logs'],
      [join(dataDir, 'depends-data'), '/MaiMBot/depends-data'],
    ] as const
  }

  private ensureVolumeDirs() {
    for (const [source] of this.volumeMap()) {
      mkdirSync(source, { recursive: true })
    }
  }

  private async containerExists() {
    const result = await this.run(this.config.dockerCommand, ['inspect', this.config.dockerContainerName], false)
    return result.code === 0
  }

  private async removeContainer(force = false) {
    const exists = await this.containerExists()
    if (!exists) return
    const args = ['rm']
    if (force) args.push('-f')
    args.push(this.config.dockerContainerName)
    const result = await this.docker(args, true)
    if (result.code !== 0) {
      this.pushLog(`docker rm warning: ${result.stderr.trim() || result.stdout.trim()}`)
    }
  }

  private async docker(args: string[], allowFailure = false) {
    const result = await this.run(this.config.dockerCommand, args)
    if (!allowFailure && result.code !== 0) {
      assertSuccessful(result, `${this.config.dockerCommand} ${args[0]}`)
    }
    return result
  }

  private run(command: string, args: string[], logOutput = true): Promise<CommandResult> {
    return runCommand(command, args, {
      onLine: logOutput ? (line, stream) => this.pushLog(`${stream}: ${this.sanitize(line)}`) : undefined,
    })
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    this.lastError = message
    this.state = message.startsWith('blocked:') ? 'blocked' : 'error'
    this.updatedAt = Date.now()
    this.logger.warn(this.sanitize(message))
  }

  private pushLog(line: string) {
    const normalized = this.sanitize(line)
    if (!normalized) return
    this.logs.push(normalized)
    if (this.logs.length > this.config.logLines) {
      this.logs.splice(0, this.logs.length - this.config.logLines)
    }
    this.logger.info(normalized)
  }

  private sanitize(line: string) {
    let result = line
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-***REDACTED***')
      .trimEnd()
    for (const secret of [this.apiKey, encodeURIComponent(this.apiKey), this.config.apiKey]) {
      if (!secret) continue
      result = result.split(secret).join(redactSecret(secret))
    }
    return result
  }
}
