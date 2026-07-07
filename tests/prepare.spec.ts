// @ts-nocheck
import { strict as assert } from 'assert'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Config } from '../src/config'

const { MaibotPrepareManager } = require('../src/bridge/prepare') as any

function createConfig(root: string, overrides: Partial<Config> = {}): Config {
  return {
    processMode: 'docker',
    maibotRoot: root,
    maibotGitUrl: 'https://github.com/Mai-with-u/MaiBot.git',
    maibotGitRef: 'main',
    autoPrepareMaibot: true,
    applyBundledPatch: true,
    pythonCommand: 'python3',
    entryScript: 'bot.py',
    autoStart: true,
    apiHost: 'maimai-ko',
    apiPort: 8090,
    legacyHost: '127.0.0.1',
    legacyPort: 8000,
    apiKey: '',
    webuiEnabled: true,
    webuiHost: '0.0.0.0',
    webuiPort: 8002,
    webuiPublicUrl: '',
    webuiTokenPath: '',
    showWebuiToken: true,
    messageMode: 'coexist',
    commandPrefix: 'mai.ko',
    imageDownloadEnabled: true,
    imageDownloadTimeout: 10000,
    imageDownloadMaxBytes: 10 * 1024 * 1024,
    messageLogLevel: 'summary',
    commandAuthority: 3,
    acceptMaibotAgreements: false,
    startupTimeout: 60000,
    shutdownTimeout: 10000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: 1000,
    routeTtl: 1800000,
    logLines: 200,
    forwardStartupLogs: true,
    externalLogsEnabled: false,
    externalLogsCommand: 'docker logs --tail {tail} -f {container}',
    externalLogsContainer: 'maimai-ko',
    externalLogsTail: 40,
    externalLogsSkipDebug: true,
    dockerCommand: 'docker',
    dockerContainerName: 'maimai-ko',
    dockerImageName: 'maimai-ko:latest',
    dockerNetwork: '',
    dockerPublishedWebuiPort: 0,
    dockerRecreateOnStart: false,
    enableConsole: true,
    ...overrides,
  }
}

describe('mai.ko prepare manager', () => {
  const root = join(tmpdir(), `mai-ko-prepare-${process.pid}`)

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('clones missing MaiBot source and applies bundled patch', async () => {
    const maibotRoot = join(root, 'maimai')
    const manager = new MaibotPrepareManager(createConfig(maibotRoot))
    const calls: string[][] = []

    manager.git = async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'clone') mkdirSync(join(maibotRoot, '.git'), { recursive: true })
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { code: 0, stdout: 'true\n', stderr: '', signal: null }
      if (args[0] === 'apply' && args[1] === '--check') return { code: 0, stdout: '', stderr: '', signal: null }
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'abc123\n', stderr: '', signal: null }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    const status = await manager.prepare()

    assert.equal(status.state, 'ready')
    assert.equal(status.patchApplied, true)
    assert.equal(status.commit, 'abc123')
    assert.ok(calls.some((args) => args[0] === 'clone'))
    assert.ok(calls.some((args) => args[0] === 'apply' && args.length === 2))
  })

  it('detects an already applied bundled patch', async () => {
    const maibotRoot = join(root, 'maimai')
    mkdirSync(join(maibotRoot, '.git'), { recursive: true })
    const manager = new MaibotPrepareManager(createConfig(maibotRoot))
    const calls: string[][] = []

    manager.git = async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { code: 0, stdout: 'true\n', stderr: '', signal: null }
      if (args[0] === 'apply' && args[1] === '--check') return { code: 1, stdout: '', stderr: 'already', signal: null }
      if (args[0] === 'apply' && args[1] === '--reverse') return { code: 0, stdout: '', stderr: '', signal: null }
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'def456\n', stderr: '', signal: null }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    const status = await manager.prepare()

    assert.equal(status.state, 'ready')
    assert.equal(status.patchApplied, true)
    assert.ok(!calls.some((args) => args[0] === 'apply' && args.length === 2))
  })

  it('does not log expected patch probe failures', async () => {
    const maibotRoot = join(root, 'maimai')
    mkdirSync(join(maibotRoot, '.git'), { recursive: true })
    const manager = new MaibotPrepareManager(createConfig(maibotRoot))

    manager.run = async (_command: string, args: string[], _cwd: string, logOutput = true) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
        if (logOutput) manager.pushLog('stdout: true')
        return { code: 0, stdout: 'true\n', stderr: '', signal: null }
      }
      if (args[0] === 'apply' && args[1] === '--check') {
        if (logOutput) manager.pushLog('stderr: patch failed')
        return { code: 1, stdout: '', stderr: 'patch failed', signal: null }
      }
      if (args[0] === 'apply' && args[1] === '--reverse') {
        if (logOutput) manager.pushLog('stdout: reverse ok')
        return { code: 0, stdout: '', stderr: '', signal: null }
      }
      if (args[0] === 'rev-parse') {
        if (logOutput) manager.pushLog('stdout: def456')
        return { code: 0, stdout: 'def456\n', stderr: '', signal: null }
      }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    const status = await manager.prepare()
    const logs = manager.getLogs().join('\n')

    assert.equal(status.state, 'ready')
    assert.ok(logs.includes('bundled patch already applied'))
    assert.ok(!logs.includes('patch failed'))
    assert.ok(!logs.includes('reverse ok'))
  })

  it('blocks when the bundled patch conflicts', async () => {
    const maibotRoot = join(root, 'maimai')
    mkdirSync(join(maibotRoot, '.git'), { recursive: true })
    const manager = new MaibotPrepareManager(createConfig(maibotRoot))

    manager.git = async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return { code: 0, stdout: 'true\n', stderr: '', signal: null }
      if (args[0] === 'apply') return { code: 1, stdout: '', stderr: 'conflict', signal: null }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    const status = await manager.prepare()

    assert.equal(status.state, 'blocked')
    assert.ok(status.blockedReason?.includes('patch cannot be applied'))
  })

  it('recovers an interrupted clone when the root only contains broken git metadata', async () => {
    const maibotRoot = join(root, 'maimai')
    mkdirSync(join(maibotRoot, '.git'), { recursive: true })
    const manager = new MaibotPrepareManager(createConfig(maibotRoot))
    const calls: string[][] = []

    manager.git = async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
        return { code: 128, stdout: '', stderr: 'fatal: not a git repository', signal: null }
      }
      if (args[0] === 'clone') {
        assert.ok(!existsSync(join(maibotRoot, '.git')))
        mkdirSync(join(maibotRoot, '.git'), { recursive: true })
        return { code: 0, stdout: '', stderr: '', signal: null }
      }
      if (args[0] === 'apply' && args[1] === '--check') return { code: 0, stdout: '', stderr: '', signal: null }
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'recover123\n', stderr: '', signal: null }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    const status = await manager.prepare()

    assert.equal(status.state, 'ready')
    assert.equal(status.commit, 'recover123')
    assert.ok(calls.some((args) => args[0] === 'clone'))
  })
})
