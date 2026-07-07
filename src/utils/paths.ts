import { resolve } from 'path'
import type { Config } from '../config'

export function resolveKoishiPath(path: string) {
  return resolve(process.cwd(), path)
}

export function resolveMaibotRoot(config: Pick<Config, 'maibotRoot'>) {
  return resolveKoishiPath(config.maibotRoot)
}

export function resolveMaiKoDataDir() {
  if (process.env.MAIKO_DATA_DIR) return resolveKoishiPath(process.env.MAIKO_DATA_DIR)
  return resolveKoishiPath('data/mai.ko')
}
