export function parseCommandLine(source: string): string[] {
  const result: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    result.push(match[1] ?? match[2] ?? match[0])
  }
  return result
}

export function redactSecret(value: string) {
  if (!value) return ''
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}
