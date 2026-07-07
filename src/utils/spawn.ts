import { spawn } from 'child_process'

export interface RunCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
}

export interface CommandResult {
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
}

export function runCommand(command: string, args: string[], options: RunCommandOptions = {}) {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let stdoutPartial = ''
    let stderrPartial = ''

    const push = (data: Buffer | string, stream: 'stdout' | 'stderr') => {
      if (stream === 'stdout') stdout += String(data)
      if (stream === 'stderr') stderr += String(data)
      if (!options.onLine) return

      const previous = stream === 'stdout' ? stdoutPartial : stderrPartial
      const lines = `${previous}${String(data)}`.split(/\r?\n/)
      const partial = lines.pop() || ''
      if (stream === 'stdout') stdoutPartial = partial
      if (stream === 'stderr') stderrPartial = partial
      for (const line of lines) options.onLine(line, stream)
    }

    child.stdout.on('data', (data) => push(data, 'stdout'))
    child.stderr.on('data', (data) => push(data, 'stderr'))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (options.onLine) {
        if (stdoutPartial) options.onLine(stdoutPartial, 'stdout')
        if (stderrPartial) options.onLine(stderrPartial, 'stderr')
      }
      resolve({ stdout, stderr, code, signal })
    })
  })
}

export function assertSuccessful(result: CommandResult, label: string) {
  if (result.code === 0) return
  const detail = result.stderr.trim() || result.stdout.trim() || `signal=${result.signal}`
  throw new Error(`${label} failed with code=${result.code}: ${detail}`)
}
