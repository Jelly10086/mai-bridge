import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface AgreementOptions {
  accept: boolean
  env?: NodeJS.ProcessEnv
}

export type AgreementResult = { ok: true; env: Record<string, string> } | { ok: false; reason: string }

export function prepareAgreementEnv(root: string, options: AgreementOptions): AgreementResult {
  const eula = join(root, 'EULA.md')
  const privacy = join(root, 'PRIVACY.md')
  if (!existsSync(eula) || !existsSync(privacy)) {
    return {
      ok: false,
      reason: 'mai.ko EULA/Privacy files are missing. Check maibotRoot or finish MaiBot preparation first.',
    }
  }

  const eulaHash = md5(eula)
  const privacyHash = md5(privacy)
  const currentEnv = options.env || process.env
  const eulaConfirmed = isAgreementConfirmed(root, 'eula.confirmed', 'EULA_AGREE', eulaHash, currentEnv)
  const privacyConfirmed = isAgreementConfirmed(root, 'privacy.confirmed', 'PRIVACY_AGREE', privacyHash, currentEnv)
  if (eulaConfirmed && privacyConfirmed) return { ok: true, env: {} }

  if (!options.accept) {
    return {
      ok: false,
      reason: 'mai.ko EULA/Privacy is not confirmed. Run mai.ko once manually or set acceptMaibotAgreements=true.',
    }
  }

  return {
    ok: true,
    env: {
      EULA_AGREE: eulaHash,
      PRIVACY_AGREE: privacyHash,
    },
  }
}

function isAgreementConfirmed(
  root: string,
  fileName: string,
  envName: string,
  expected: string,
  env: NodeJS.ProcessEnv,
) {
  if (env[envName] === expected) return true
  const path = join(root, fileName)
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8').trim() === expected
}

function md5(path: string) {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}
