import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { Config } from '../config'
import { resolveMaiKoDataDir, resolveMaibotRoot } from '../utils/paths'

export interface WebuiTokenInfo {
  path: string
  token?: string
  source?: string
  error?: string
}

export function resolveWebuiTokenPath(config: Pick<Config, 'maibotRoot' | 'webuiTokenPath'> & Partial<Pick<Config, 'processMode'>>) {
  const configuredPath = config.webuiTokenPath.trim()
  if (!configuredPath && config.processMode === 'docker') {
    return join(resolveMaiKoDataDir(), 'data', 'webui.json')
  }
  return configuredPath ? resolve(configuredPath) : join(resolveMaibotRoot(config), 'data', 'webui.json')
}

export function readWebuiToken(config: Pick<Config, 'maibotRoot' | 'webuiTokenPath'> & Partial<Pick<Config, 'processMode'>>): WebuiTokenInfo {
  const path = resolveWebuiTokenPath(config)
  if (!existsSync(path)) {
    return { path, error: `WebUI Token 文件不存在: ${path}` }
  }

  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const token = typeof data.access_token === 'string' ? data.access_token.trim() : ''
    if (!token) return { path, error: `WebUI Token 文件中缺少 access_token: ${path}` }
    const source = typeof data.token_source === 'string' ? data.token_source : undefined
    return { path, token, source }
  } catch (error) {
    return {
      path,
      error: error instanceof Error
        ? `读取 WebUI Token 失败: ${error.message}`
        : `读取 WebUI Token 失败: ${String(error)}`,
    }
  }
}
