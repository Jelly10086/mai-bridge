import type { Session } from 'koishi'
import type { KoishiRoute } from '../types'

export interface GroupTriggerResult {
  shouldForward: boolean
  count: number
  threshold: number
  key?: string
  entries: GroupTriggerEntry[]
  forceMention?: boolean
}

export interface GroupTriggerEntry {
  session: Session
  route: KoishiRoute
}

export class GroupMessageTrigger {
  private pending = new Map<string, GroupTriggerEntry[]>()

  constructor(private threshold: number) {}

  test(session: Session, route: KoishiRoute): GroupTriggerResult {
    const threshold = Math.max(1, Math.floor(this.threshold || 1))
    const entry = { session, route }
    if (threshold <= 1 || session.isDirect || !route.channelId) {
      return { shouldForward: true, count: 1, threshold, entries: [entry] }
    }

    const key = this.createKey(route)
    const entries = [...this.pending.get(key) || [], entry]
    if (entries.length >= threshold) {
      this.pending.delete(key)
      return { shouldForward: true, count: entries.length, threshold, key, entries, forceMention: true }
    }

    this.pending.set(key, entries)
    return { shouldForward: false, count: entries.length, threshold, key, entries: [] }
  }

  clear() {
    this.pending.clear()
  }

  private createKey(route: KoishiRoute) {
    return [
      route.platform,
      route.botSelfId,
      route.guildId || '',
      route.channelId,
    ].join(':')
  }
}
