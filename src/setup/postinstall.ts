import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

function log(message: string) {
  console.log(`[mai.ko/postinstall] ${message}`)
}

function warn(message: string) {
  console.warn(`[mai.ko/postinstall] ${message}`)
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  }
}

function runChecked(command: string, args: string[], cwd: string) {
  const result = run(command, args, cwd)
  if (result.error) throw result.error
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} ${args.join(' ')} failed`)
  }
  return result
}

function patchState(root: string, patch: string) {
  const apply = run('git', ['apply', '--check', patch], root)
  if (apply.code === 0) return 'pending'
  const reverse = run('git', ['apply', '--reverse', '--check', patch], root)
  if (reverse.code === 0) return 'applied'
  return 'conflict'
}

export function postinstall() {
  if (process.env.MAIKO_SKIP_POSTINSTALL === '1') {
    log('skipped by MAIKO_SKIP_POSTINSTALL=1')
    return
  }

  const baseDir = resolve(process.env.INIT_CWD || process.cwd())
  const root = resolve(process.env.MAIKO_MAIBOT_ROOT || join(baseDir, 'data/mai.ko/maimai'))
  const gitUrl = process.env.MAIKO_MAIBOT_GIT_URL || 'https://github.com/Mai-with-u/MaiBot.git'
  const gitRef = process.env.MAIKO_MAIBOT_GIT_REF || 'main'
  const patch = resolve(__dirname, '../../patches/maimai-koishi.patch')

  try {
    if (!existsSync(root)) {
      mkdirSync(dirname(root), { recursive: true })
      log(`cloning MaiBot to ${root}`)
      runChecked('git', ['clone', '--depth', '1', '--branch', gitRef, gitUrl, root], baseDir)
    } else if (!statSync(root).isDirectory() || !existsSync(join(root, '.git'))) {
      warn(`skip prepare: ${root} exists but is not a git repository`)
      return
    }

    if (!existsSync(patch)) {
      warn(`skip patch: bundled patch not found at ${patch}`)
      return
    }

    const state = patchState(root, patch)
    if (state === 'pending') {
      log('applying bundled maimai-koishi patch')
      runChecked('git', ['apply', patch], root)
    } else if (state === 'applied') {
      log('bundled maimai-koishi patch already applied')
    } else {
      warn('bundled maimai-koishi patch cannot be applied cleanly; plugin startup will report details')
      return
    }

    const checksum = createHash('sha256').update(readFileSync(patch)).digest('hex')
    const commit = run('git', ['rev-parse', 'HEAD'], root).stdout.trim()
    writeFileSync(join(root, '.mai-ko-prepare.json'), `${JSON.stringify({
      gitUrl,
      gitRef,
      patchChecksum: checksum,
      patchApplied: true,
      commit,
      updatedAt: Date.now(),
    }, null, 2)}\n`)
    log('MaiBot source prepared; Docker image will be built when the plugin starts')
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error))
  }
}

if (require.main === module) postinstall()
