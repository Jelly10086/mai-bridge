import type { Session } from 'koishi'
import type { KoishiRoute } from '../types'

export class RouteRegistry {
  private routes = new Map<string, KoishiRoute>()

  constructor(private ttl: number) {}

  remember(session: Session) {
    const routeId = this.getRouteId(session)
    const route: KoishiRoute = {
      routeId,
      session,
      platform: session.platform || 'unknown',
      botSelfId: session.selfId || 'unknown',
      channelId: session.channelId || session.userId || 'unknown',
      guildId: session.guildId,
      userId: session.userId || 'unknown',
      isDirect: !!session.isDirect,
      updatedAt: Date.now(),
    }
    this.routes.set(routeId, route)
    this.cleanup()
    return route
  }

  get(routeId?: string) {
    if (!routeId) return
    const route = this.routes.get(routeId)
    if (!route) return
    if (Date.now() - route.updatedAt > this.ttl) {
      this.routes.delete(routeId)
      return
    }
    return route
  }

  find(channelId?: string, userId?: string, selfId?: string, options: { isDirect?: boolean } = {}) {
    this.cleanup()
    const routes = [...this.routes.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    return routes.find((route) => {
      if (options.isDirect !== undefined && route.isDirect !== options.isDirect) return false
      if (selfId && route.botSelfId !== selfId) return false
      if (channelId && route.channelId !== channelId) return false
      if (userId && route.userId !== userId) return false
      return true
    })
  }

  latest(options: { selfId?: string, isDirect?: boolean } = {}) {
    this.cleanup()
    const routes = [...this.routes.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    return routes.find((route) => {
      if (options.selfId && route.botSelfId !== options.selfId) return false
      if (options.isDirect !== undefined && route.isDirect !== options.isDirect) return false
      return true
    })
  }

  clear() {
    this.routes.clear()
  }

  getRouteId(session: Session) {
    return [
      'koishi',
      session.platform,
      session.selfId || '',
      session.guildId || '',
      session.channelId || '',
      session.userId || '',
    ].join(':')
  }

  private cleanup() {
    const now = Date.now()
    for (const [routeId, route] of this.routes) {
      if (now - route.updatedAt > this.ttl) {
        this.routes.delete(routeId)
      }
    }
  }
}
