// @ts-nocheck
import { strict as assert } from 'assert'
import type { Config } from '../src/config'

const { MaibotProcessManager } = require('../src/bridge/process') as any

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    processMode: 'managed',
    maibotRoot: '/tmp/maimai',
    maibotGitUrl: 'https://github.com/Mai-with-u/MaiBot.git',
    maibotGitRef: 'main',
    autoPrepareMaibot: true,
    applyBundledPatch: true,
    pythonCommand: 'python3',
    entryScript: 'bot.py',
    autoStart: true,
    apiHost: '127.0.0.1',
    apiPort: 8090,
    legacyHost: '127.0.0.1',
    legacyPort: 8000,
    apiKey: '',
    webuiEnabled: true,
    webuiHost: '127.0.0.1',
    webuiPort: 8001,
    webuiPublicUrl: '',
    webuiTokenPath: '',
    showWebuiToken: true,
    messageMode: 'coexist',
    commandPrefix: 'mai.ko',
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

describe('mai.ko process manager', () => {
  it('injects Koishi WebUI environment variables for managed worker startup', () => {
    const manager = new MaibotProcessManager({}, createConfig({
      webuiEnabled: false,
      webuiHost: '0.0.0.0',
      webuiPort: 18001,
    }), 'runtime-key')

    const env = manager.buildEnv({ EULA_AGREE: 'ok' }) as Record<string, string>

    assert.equal(env.MAIBOT_WORKER_PROCESS, '1')
    assert.equal(env.MAIBOT_KOISHI_MODE, '1')
    assert.equal(env.MAIBOT_KOISHI_WEBUI_ENABLED, '0')
    assert.equal(env.MAIBOT_KOISHI_WEBUI_HOST, '0.0.0.0')
    assert.equal(env.MAIBOT_KOISHI_WEBUI_PORT, '18001')
    assert.equal(env.EULA_AGREE, 'ok')
  })

  it('forwards only startup logs to Koishi logger and redacts secrets', () => {
    const infoLogs = [] as string[]
    const warnLogs = [] as string[]

    const apiKey = 'super-secret-api-key'
    const manager = new MaibotProcessManager({}, createConfig(), apiKey)
    manager.logger = {
      info: (message: unknown) => infoLogs.push(String(message)),
      warn: (message: unknown) => warnLogs.push(String(message)),
    }
    manager.state = 'starting'
    manager.child = { exitCode: null, killed: false }

    manager.pushLog(`boot \u001b[31m${apiKey}\u001b[0m\n`, 'stdout')
    manager.pushLog(`bad ${encodeURIComponent(apiKey)}\n`, 'stderr')
    manager.markReady()
    manager.pushLog('later runtime log\n', 'stdout')

    assert.equal(manager.getStatus().state, 'running')
    assert.equal(infoLogs.length, 1)
    assert.equal(warnLogs.length, 1)
    assert.ok(!infoLogs[0].includes(apiKey))
    assert.ok(!warnLogs[0].includes(apiKey))
    assert.ok(!warnLogs[0].includes(encodeURIComponent(apiKey)))
    assert.ok(!manager.getLogs().some((line) => line.includes('\u001b')))
    assert.ok(manager.getLogs().some((line) => line.includes('later runtime log')))
  })
})
