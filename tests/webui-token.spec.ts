// @ts-nocheck
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { strict as assert } from 'assert'
import { readWebuiToken, resolveWebuiTokenPath } from '../src/bridge/webui-token'

describe('mai.ko WebUI token reader', () => {
  const root = join(tmpdir(), `mai-ko-token-${process.pid}`)

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads maibotRoot/data/webui.json by default', () => {
    const dataDir = join(root, 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'webui.json'), JSON.stringify({
      access_token: 'token-123',
      token_source: 'temporary',
    }))

    const result = readWebuiToken({ maibotRoot: root, webuiTokenPath: '' })

    assert.equal(resolveWebuiTokenPath({ maibotRoot: root, webuiTokenPath: '' }), join(root, 'data', 'webui.json'))
    assert.equal(result.token, 'token-123')
    assert.equal(result.source, 'temporary')
    assert.equal(result.error, undefined)
  })

  it('reports a clear error when token file is not mounted', () => {
    const result = readWebuiToken({ maibotRoot: root, webuiTokenPath: '' })

    assert.equal(result.token, undefined)
    assert.ok(result.error?.includes('WebUI Token 文件不存在'))
  })

  it('uses explicit token path for external Docker mode', () => {
    const tokenPath = join(root, 'runtime-data', 'webui.json')
    mkdirSync(join(root, 'runtime-data'), { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({ access_token: 'external-token' }))

    const result = readWebuiToken({ maibotRoot: '/not-used', webuiTokenPath: tokenPath })

    assert.equal(result.path, tokenPath)
    assert.equal(result.token, 'external-token')
  })

  it('reads Docker mode token from MAIKO_DATA_DIR data volume by default', () => {
    const oldDataDir = process.env.MAIKO_DATA_DIR
    const dataRoot = join(root, 'mai-ko-data')
    const tokenPath = join(dataRoot, 'data', 'webui.json')
    mkdirSync(join(dataRoot, 'data'), { recursive: true })
    writeFileSync(tokenPath, JSON.stringify({
      access_token: 'docker-token',
      token_source: 'persistent',
    }))
    process.env.MAIKO_DATA_DIR = dataRoot

    try {
      const result = readWebuiToken({ maibotRoot: root, webuiTokenPath: '', processMode: 'docker' })

      assert.equal(resolveWebuiTokenPath({ maibotRoot: root, webuiTokenPath: '', processMode: 'docker' }), tokenPath)
      assert.equal(result.path, tokenPath)
      assert.equal(result.token, 'docker-token')
      assert.equal(result.source, 'persistent')
    } finally {
      if (oldDataDir === undefined) {
        delete process.env.MAIKO_DATA_DIR
      } else {
        process.env.MAIKO_DATA_DIR = oldDataDir
      }
    }
  })
})
