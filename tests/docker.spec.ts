// @ts-nocheck
import { strict as assert } from 'assert'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Config } from '../src/config'

const { MaibotDockerManager } = require('../src/bridge/docker') as any

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
    dockerNetwork: 'maiko-net',
    dockerPublishedWebuiPort: 18002,
    dockerRecreateOnStart: false,
    enableConsole: true,
    ...overrides,
  }
}

describe('mai.ko Docker manager', () => {
  const root = join(tmpdir(), `mai-ko-docker-${process.pid}`)
  const oldDataDir = process.env.MAIKO_DATA_DIR
  const oldHostname = process.env.HOSTNAME

  afterEach(() => {
    if (oldDataDir === undefined) {
      delete process.env.MAIKO_DATA_DIR
    } else {
      process.env.MAIKO_DATA_DIR = oldDataDir
    }
    if (oldHostname === undefined) {
      delete process.env.HOSTNAME
    } else {
      process.env.HOSTNAME = oldHostname
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('builds image and creates the maimai-ko container with Koishi env', async () => {
    const maibotRoot = join(root, 'maimai')
    process.env.MAIKO_DATA_DIR = join(root, 'data')
    mkdirSync(maibotRoot, { recursive: true })
    writeFileSync(join(maibotRoot, 'EULA.md'), 'test eula')
    writeFileSync(join(maibotRoot, 'PRIVACY.md'), 'test privacy')
    const manager = new MaibotDockerManager(createConfig(maibotRoot, {
      acceptMaibotAgreements: true,
    }), 'runtime-key')
    const calls: string[][] = []

    manager.run = async (_command: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'inspect') return { code: 1, stdout: '', stderr: '', signal: null }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    await manager.build()
    await manager.start()

    const create = calls.find((args) => args[0] === 'create')
    assert.ok(create)
    assert.ok(create.includes('maimai-ko'))
    assert.ok(create.includes('maimai-ko:latest'))
    assert.ok(create.includes('--network'))
    assert.ok(create.includes('maiko-net'))
    assert.ok(create.includes('-p'))
    assert.ok(create.includes('18002:8002'))
    assert.ok(create.includes('MAIBOT_KOISHI_API_KEY=runtime-key'))
    assert.ok(create.includes('MAIBOT_KOISHI_API_HOST=0.0.0.0'))
    assert.ok(calls.some((args) => args.join(' ') === 'container inspect maimai-ko'))
  })

  it('does not treat an image with the container name as an existing container', async () => {
    const maibotRoot = join(root, 'maimai')
    process.env.MAIKO_DATA_DIR = join(root, 'data')
    mkdirSync(maibotRoot, { recursive: true })
    writeFileSync(join(maibotRoot, 'EULA.md'), 'test eula')
    writeFileSync(join(maibotRoot, 'PRIVACY.md'), 'test privacy')
    const manager = new MaibotDockerManager(createConfig(maibotRoot, {
      acceptMaibotAgreements: true,
    }), 'runtime-key')
    const calls: string[][] = []

    manager.run = async (_command: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'container' && args[1] === 'inspect') {
        return { code: 1, stdout: '', stderr: 'No such container: maimai-ko', signal: null }
      }
      if (args[0] === 'inspect') {
        return { code: 0, stdout: 'maimai-ko:latest\n', stderr: '', signal: null }
      }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    await manager.start()

    assert.ok(calls.some((args) => args[0] === 'create'))
    assert.ok(calls.some((args) => args.join(' ') === 'container inspect maimai-ko'))
    assert.ok(!calls.some((args) => args.join(' ') === 'inspect maimai-ko'))
    assert.equal(manager.getStatus().state, 'running')
  })

  it('uses the Koishi container network when dockerNetwork is empty', async () => {
    const maibotRoot = join(root, 'maimai')
    process.env.MAIKO_DATA_DIR = join(root, 'data')
    process.env.HOSTNAME = 'koishi-container-id'
    mkdirSync(maibotRoot, { recursive: true })
    writeFileSync(join(maibotRoot, 'EULA.md'), 'test eula')
    writeFileSync(join(maibotRoot, 'PRIVACY.md'), 'test privacy')
    const manager = new MaibotDockerManager(createConfig(maibotRoot, {
      acceptMaibotAgreements: true,
      dockerNetwork: '',
    }), 'runtime-key')
    const calls: string[][] = []

    manager.run = async (_command: string, args: string[]) => {
      calls.push(args)
      if (args.join(' ') === 'container inspect maimai-ko') {
        return { code: 1, stdout: '', stderr: 'No such container: maimai-ko', signal: null }
      }
      if (args[0] === 'container' && args[1] === 'inspect' && args[2] === 'koishi-container-id') {
        return { code: 0, stdout: 'bridge\nkoishi-net\n', stderr: '', signal: null }
      }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    await manager.start()

    const create = calls.find((args) => args[0] === 'create')
    assert.ok(create)
    assert.ok(create.includes('--network'))
    assert.ok(create.includes('koishi-net'))
    assert.ok(manager.getLogs().some((line) => line.includes('using Docker network from Koishi container: koishi-net')))
  })

  it('maps Koishi container paths to Docker host paths for maimai volumes', async () => {
    const containerRoot = join(root, 'container-root')
    const hostRoot = join(root, 'host-root')
    const maibotRoot = join(root, 'maimai')
    process.env.MAIKO_DATA_DIR = join(containerRoot, 'data', 'mai.ko')
    process.env.HOSTNAME = 'koishi-container-id'
    mkdirSync(maibotRoot, { recursive: true })
    writeFileSync(join(maibotRoot, 'EULA.md'), 'test eula')
    writeFileSync(join(maibotRoot, 'PRIVACY.md'), 'test privacy')
    const manager = new MaibotDockerManager(createConfig(maibotRoot, {
      acceptMaibotAgreements: true,
      dockerNetwork: 'koishi-net',
    }), 'runtime-key')
    const calls: string[][] = []

    manager.run = async (_command: string, args: string[]) => {
      calls.push(args)
      if (args.join(' ') === 'container inspect maimai-ko') {
        return { code: 1, stdout: '', stderr: 'No such container: maimai-ko', signal: null }
      }
      if (args[0] === 'container' && args[1] === 'inspect' && args[2] === 'koishi-container-id') {
        return {
          code: 0,
          stdout: JSON.stringify([{ Source: hostRoot, Destination: containerRoot }]),
          stderr: '',
          signal: null,
        }
      }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    await manager.start()

    const create = calls.find((args) => args[0] === 'create')
    assert.ok(create)
    assert.ok(create.includes(`${join(hostRoot, 'data', 'mai.ko', 'data')}:/MaiMBot/data`))
    assert.ok(create.includes(`${join(hostRoot, 'data', 'mai.ko', 'config')}:/MaiMBot/config`))
    assert.ok(!create.includes(`${join(containerRoot, 'data', 'mai.ko', 'data')}:/MaiMBot/data`))
  })

  it('redacts API keys from Docker logs', () => {
    const maibotRoot = join(root, 'maimai')
    const manager = new MaibotDockerManager(createConfig(maibotRoot), 'very-secret-runtime-key')

    manager.pushLog('boot very-secret-runtime-key')

    assert.ok(!manager.getLogs()[0].includes('very-secret-runtime-key'))
  })

  it('does not log docker inspect probes', async () => {
    const maibotRoot = join(root, 'maimai')
    const manager = new MaibotDockerManager(createConfig(maibotRoot), 'runtime-key')

    manager.run = async (_command: string, args: string[], logOutput = true) => {
      if (args[0] === 'container' && args[1] === 'inspect') {
        if (logOutput) manager.pushLog('stderr: error: no such object: maimai-ko')
        return { code: 1, stdout: '', stderr: 'error: no such object: maimai-ko', signal: null }
      }
      return { code: 0, stdout: '', stderr: '', signal: null }
    }

    await manager.stop()

    assert.ok(!manager.getLogs().join('\n').includes('no such object'))
  })
})
