import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Config } from '../config'
import { resolveMaiKoDataDir } from '../utils/paths'

interface RuntimeFile {
  apiKey?: string
}

export function resolveRuntimeFilePath() {
  return join(resolveMaiKoDataDir(), 'runtime.json')
}

export function createOrReadApiKey(config: Pick<Config, 'apiKey'>) {
  if (config.apiKey) return config.apiKey

  const path = resolveRuntimeFilePath()
  const existing = readRuntimeFile(path)
  if (existing.apiKey) return existing.apiKey

  const apiKey = `koishi-${randomBytes(18).toString('hex')}`
  mkdirSync(resolveMaiKoDataDir(), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...existing, apiKey }, null, 2)}\n`)
  return apiKey
}

function readRuntimeFile(path: string): RuntimeFile {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}
