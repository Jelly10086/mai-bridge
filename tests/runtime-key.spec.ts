// @ts-nocheck
import { strict as assert } from 'assert'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const { createOrReadApiKey, resolveRuntimeFilePath } = require('../src/bridge/runtime-key') as any

describe('mai.ko runtime key', () => {
  const root = join(tmpdir(), `mai-ko-runtime-${process.pid}`)
  const oldDataDir = process.env.MAIKO_DATA_DIR

  beforeEach(() => {
    process.env.MAIKO_DATA_DIR = root
  })

  afterEach(() => {
    if (oldDataDir === undefined) {
      delete process.env.MAIKO_DATA_DIR
    } else {
      process.env.MAIKO_DATA_DIR = oldDataDir
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('persists generated API key when config apiKey is empty', () => {
    const first = createOrReadApiKey({ apiKey: '' })
    const second = createOrReadApiKey({ apiKey: '' })

    assert.equal(first, second)
    assert.ok(first.startsWith('koishi-'))
    assert.ok(existsSync(resolveRuntimeFilePath()))
  })

  it('uses explicit API key without writing runtime file', () => {
    const key = createOrReadApiKey({ apiKey: 'configured-key' })

    assert.equal(key, 'configured-key')
    assert.equal(existsSync(resolveRuntimeFilePath()), false)
  })
})
