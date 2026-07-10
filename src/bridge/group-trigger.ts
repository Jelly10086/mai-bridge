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

  test(session: Session, route: KoishiRoute, force = false): GroupTriggerResult {
    const threshold = Math.max(1, Math.floor(this.threshold || 1))
    const entry = { session, route }
    if (threshold <= 1 || session.isDirect || !route.channelId) {
      return {
        shouldForward: true,
        count: 1,
        threshold,
        entries: [entry],
        ...(force ? { forceMention: true } : {}),
      }
    }

    const key = this.createKey(route)
    const entries = [...this.pending.get(key) || [], entry]
    if (force) {
      this.pending.delete(key)
      return { shouldForward: true, count: entries.length, threshold, key, entries, forceMention: true }
    }

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

export class DirectMessageTrigger {
  private pending = new Map<string, GroupTriggerEntry[]>()

  constructor(private threshold: number) {}

  test(session: Session, route: KoishiRoute): GroupTriggerResult {
    const threshold = Math.max(1, Math.floor(this.threshold || 1))
    const entry = { session, route }
    if (!session.isDirect || !route.userId) {
      return { shouldForward: true, count: 1, threshold, entries: [entry] }
    }
    if (threshold <= 1) {
      return { shouldForward: true, count: 1, threshold, entries: [entry], forceMention: true }
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
      route.userId,
    ].join(':')
  }
}
