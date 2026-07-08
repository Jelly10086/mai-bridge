import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { Logger } from 'koishi'
import type { Config } from '../config'
import type { PrepareState, RuntimeStatus } from '../types'
import { resolveMaibotRoot } from '../utils/paths'
import { assertSuccessful, runCommand, type CommandResult } from '../utils/spawn'

interface PrepareMarker {
  gitUrl: string
  gitRef: string
  patchChecksum?: string
  patchApplied?: boolean
  commit?: string
  updatedAt: number
}

type PatchState = 'pending' | 'applied' | 'conflict' | 'missing'

export class MaibotPrepareManager {
  private logger = new Logger('mai.ko/prepare')
  private state: PrepareState = 'not-prepared'
  private patchApplied?: boolean
  private patchChecksum?: string
  private commit?: string
  private blockedReason?: string
  private lastError?: string
  private updatedAt?: number
  private logs: string[] = []

  constructor(private config: Config) {}

  get root() {
    return resolveMaibotRoot(this.config)
  }

  getStatus(): RuntimeStatus['prepare'] {
    return {
      state: this.state,
      root: this.root,
      gitUrl: this.config.maibotGitUrl,
      gitRef: this.config.maibotGitRef,
      patchApplied: this.patchApplied,
      patchChecksum: this.patchChecksum,
      commit: this.commit,
      blockedReason: this.blockedReason,
      lastError: this.lastError,
      updatedAt: this.updatedAt,
    }
  }

  getLogs() {
    return [...this.logs]
  }

  async prepare(force = false) {
    if (!force && !this.config.autoPrepareMaibot) {
      this.state = 'not-prepared'
      this.pushLog('auto prepare disabled')
      return this.getStatus()
    }

    this.state = 'preparing'
    this.blockedReason = undefined
    this.lastError = undefined
    this.updatedAt = Date.now()

    try {
      await this.ensureRepository()
      await this.ensurePatch()
      this.commit = await this.readCommit()
      this.writeMarker()
      this.state = 'ready'
      this.updatedAt = Date.now()
      this.pushLog(`MaiBot ready: root=${this.root} commit=${this.commit || '-'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastError = message
      this.state = message.startsWith('blocked:') ? 'blocked' : 'error'
      this.blockedReason = this.state === 'blocked' ? message.slice('blocked:'.length).trim() : undefined
      this.updatedAt = Date.now()
      this.logger.warn(message)
    }

    return this.getStatus()
  }

  private async ensureRepository() {
    const root = this.root
    if (!existsSync(root)) {
      await this.cloneRepository()
      return
    }

    if (!statSync(root).isDirectory()) {
      throw new Error(`blocked: maibotRoot exists but is not a directory: ${root}`)
    }

    if (!existsSync(join(root, '.git'))) {
      if (this.isRecoverablePartialDirectory()) {
        this.pushLog(`removing incomplete MaiBot directory: ${root}`)
        rmSync(root, { recursive: true, force: true })
        await this.cloneRepository()
        return
      }
      throw new Error(`blocked: maibotRoot exists but is not a git repository: ${root}`)
    }

    if (!await this.isValidGitRepository()) {
      if (this.isRecoverablePartialDirectory()) {
        this.pushLog(`removing incomplete MaiBot repository: ${root}`)
        rmSync(root, { recursive: true, force: true })
        await this.cloneRepository()
        return
      }
      throw new Error(`blocked: maibotRoot exists but is not a valid git repository: ${root}`)
    }

    this.pushLog(`using existing MaiBot repository: ${root}`)
  }

  private async cloneRepository() {
    mkdirSync(dirname(this.root), { recursive: true })
    this.pushLog(`cloning MaiBot: ${this.config.maibotGitUrl}#${this.config.maibotGitRef}`)
    await this.git(['clone', '--depth', '1', '--branch', this.config.maibotGitRef, this.config.maibotGitUrl, this.root], process.cwd())
  }

  private async isValidGitRepository() {
    const result = await this.git(['rev-parse', '--is-inside-work-tree'], this.root, true, false)
    return result.code === 0 && result.stdout.trim() === 'true'
  }

  private isRecoverablePartialDirectory() {
    try {
      return readdirSync(this.root).every((name) => name === '.git' || name === '.mai-ko-prepare.json')
    } catch {
      return false
    }
  }

  private async ensurePatch() {
    if (!this.config.applyBundledPatch) {
      this.patchApplied = false
      this.patchChecksum = undefined
      this.pushLog('bundled patch disabled')
      return
    }

    const patchPath = this.resolvePatchPath()
    if (!existsSync(patchPath)) {
      throw new Error(`blocked: bundled patch not found: ${patchPath}`)
    }

    this.patchChecksum = createHash('sha256').update(readFileSync(patchPath)).digest('hex')
    const patchState = await this.checkPatchState(patchPath)
    if (patchState === 'missing') {
      throw new Error(`blocked: bundled patch not found: ${patchPath}`)
    }
    if (patchState === 'conflict') {
      const refreshed = await this.refreshManagedPatch(patchPath)
      if (refreshed === 'applied') return
      if (refreshed === 'pending') {
        await this.applyPatch(patchPath)
        return
      }
      throw new Error('blocked: bundled patch cannot be applied cleanly; check MaiBot ref or update maimai-koishi.patch')
    }
    if (patchState === 'applied') {
      this.patchApplied = true
      this.pushLog('bundled patch already applied')
      return
    }

    await this.applyPatch(patchPath)
  }

  private async applyPatch(patchPath: string) {
    this.pushLog(`applying bundled patch: ${patchPath}`)
    await this.git(['apply', patchPath], this.root)
    this.patchApplied = true
  }

  private async checkPatchState(patchPath: string): Promise<PatchState> {
    if (!existsSync(patchPath)) return 'missing'
    const applyCheck = await this.git(['apply', '--check', patchPath], this.root, true, false)
    if (applyCheck.code === 0) return 'pending'
    const reverseCheck = await this.git(['apply', '--reverse', '--check', patchPath], this.root, true, false)
    if (reverseCheck.code === 0) return 'applied'
    return 'conflict'
  }

  private async refreshManagedPatch(patchPath: string): Promise<'pending' | 'applied' | undefined> {
    const marker = this.readMarker()
    if (!marker?.patchApplied) return
    if (marker.gitUrl !== this.config.maibotGitUrl || marker.gitRef !== this.config.maibotGitRef) return
    if (!marker.patchChecksum || marker.patchChecksum === this.patchChecksum) return

    const patchPaths = new Set(this.listPatchPaths(patchPath))
    const dirtyFiles = await this.listDirtyTrackedFiles()
    if (!dirtyFiles.length) return

    const foreignFiles = dirtyFiles.filter((file) => !patchPaths.has(file))
    if (foreignFiles.length) {
      throw new Error(`blocked: MaiBot has local changes outside bundled patch: ${foreignFiles.slice(0, 5).join(', ')}`)
    }

    this.pushLog('refreshing managed bundled patch')
    await this.git(['restore', '--source', 'HEAD', '--', ...dirtyFiles], this.root)

    const patchState = await this.checkPatchState(patchPath)
    if (patchState === 'pending') return 'pending'
    if (patchState === 'applied') {
      this.patchApplied = true
      this.pushLog('bundled patch already applied')
      return 'applied'
    }
    throw new Error('blocked: bundled patch cannot be refreshed cleanly; check MaiBot ref or update maimai-koishi.patch')
  }

  private readMarker(): PrepareMarker | undefined {
    try {
      const marker = JSON.parse(readFileSync(join(this.root, '.mai-ko-prepare.json'), 'utf8')) as PrepareMarker
      if (!marker || typeof marker !== 'object') return
      return marker
    } catch {
      return
    }
  }

  private listPatchPaths(patchPath: string) {
    const paths = new Set<string>()
    const patch = readFileSync(patchPath, 'utf8')
    for (const line of patch.split(/\r?\n/)) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      if (!match) continue
      if (match[2] !== '/dev/null') paths.add(match[2])
    }
    return [...paths]
  }

  private async listDirtyTrackedFiles() {
    const result = await this.git(['status', '--porcelain', '--untracked-files=no'], this.root, true, false)
    if (result.code !== 0) return []
    return result.stdout
      .split(/\r?\n/)
      .map((line) => {
        if (!line.trim()) return ''
        const path = line.slice(3)
        return path.includes(' -> ') ? path.split(' -> ').pop()! : path
      })
      .filter(Boolean)
  }

  private async readCommit() {
    const result = await this.git(['rev-parse', 'HEAD'], this.root, true, false)
    return result.code === 0 ? result.stdout.trim() : undefined
  }

  private writeMarker() {
    const marker: PrepareMarker = {
      gitUrl: this.config.maibotGitUrl,
      gitRef: this.config.maibotGitRef,
      patchChecksum: this.patchChecksum,
      patchApplied: this.patchApplied,
      commit: this.commit,
      updatedAt: Date.now(),
    }
    writeFileSync(join(this.root, '.mai-ko-prepare.json'), `${JSON.stringify(marker, null, 2)}\n`)
  }

  private resolvePatchPath() {
    return resolve(__dirname, '../../patches/maimai-koishi.patch')
  }

  private async git(args: string[], cwd: string, allowFailure = false, logOutput = true) {
    const result = await this.run('git', args, cwd, logOutput)
    if (!allowFailure) assertSuccessful(result, `git ${args[0]}`)
    return result
  }

  private run(command: string, args: string[], cwd: string, logOutput = true): Promise<CommandResult> {
    return runCommand(command, args, {
      cwd,
      onLine: logOutput ? (line, stream) => this.pushLog(`${stream}: ${line}`) : undefined,
    })
  }

  private pushLog(line: string) {
    const normalized = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trimEnd()
    if (!normalized) return
    this.logs.push(normalized)
    if (this.logs.length > this.config.logLines) {
      this.logs.splice(0, this.logs.length - this.config.logLines)
    }
    this.logger.info(normalized)
  }
}
