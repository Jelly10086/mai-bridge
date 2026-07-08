import type { Session } from 'koishi'
import type { KoishiRoute } from '../types'

export interface GroupTriggerResult {
  shouldForward: boolean
  count: number
  threshold: number
  key?: string
}

export class GroupMessageTrigger {
  private counters = new Map<string, number>()

  constructor(private threshold: number) {}

  test(session: Session, route: KoishiRoute): GroupTriggerResult {
    const threshold = Math.max(1, Math.floor(this.threshold || 1))
    if (threshold <= 1 || session.isDirect || !route.channelId) {
      return { shouldForward: true, count: 1, threshold }
    }

    const key = this.createKey(route)
    const count = (this.counters.get(key) || 0) + 1
    if (count >= threshold) {
      this.counters.delete(key)
      return { shouldForward: true, count, threshold, key }
    }

    this.counters.set(key, count)
    return { shouldForward: false, count, threshold, key }
  }

  clear() {
    this.counters.clear()
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
