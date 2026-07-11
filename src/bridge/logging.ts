import type { Fragment, Session } from 'koishi'
import type { MaimApiMessage, MaimSeg } from '../types'

export function redactTransportUrl(url?: string) {
  if (!url) return url
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('api_key')) {
      parsed.searchParams.set('api_key', '***REDACTED***')
    }
    return parsed.toString()
  } catch {
    return url.replace(/([?&]api_key=)[^&\s]+/g, '$1***REDACTED***')
  }
}

function truncate(value: string, max = 80) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}

function previewSegment(segment?: MaimSeg): string {
  if (!segment) return ''
  if (segment.type === 'seglist' && Array.isArray(segment.data)) {
    return segment.data.map(previewSegment).filter(Boolean).join(' ')
  }
  if (segment.type === 'text') return String(segment.data ?? '')
  if (segment.type === 'at') {
    const data = segment.data
    if (typeof data === 'object' && data && !Array.isArray(data)) {
      return `@${data.target_user_id || data.user_id || data.id || data.qq || ''}`
    }
    return `@${String(data ?? '')}`
  }
  if (segment.type === 'image' || segment.type === 'img') return '[image]'
  if (segment.type === 'emoji') return '[emoji]'
  return `[${segment.type}]`
}

export function describeSegment(segment?: MaimSeg) {
  if (!segment) return 'segment=empty'
  const count = segment.type === 'seglist' && Array.isArray(segment.data) ? segment.data.length : 1
  const preview = truncate(previewSegment(segment))
  return `segment=${segment.type} count=${count}${preview ? ` preview="${preview}"` : ''}`
}

export function describeSession(session: Session) {
  const scope = session.isDirect ? 'direct' : 'group'
  const channel = session.channelId || '-'
  const guild = session.guildId || '-'
  const user = session.userId || '-'
  const self = session.selfId || '-'
  const messageId = session.messageId || session.id || '-'
  return `scope=${scope} platform=${session.platform || '-'} self=${self} channel=${channel} guild=${guild} user=${user} msg=${messageId}`
}

export function describeMaimMessage(message: MaimApiMessage) {
  const info = message.message_info
  const additional = info.additional_config || {}
  const routeId = additional.koishi_route_id || '-'
  const channelId = additional.koishi_channel_id || info.group_info?.group_id || '-'
  const userId = additional.koishi_user_id || info.user_info?.user_id || '-'
  const selfId = additional.koishi_self_id || '-'
  const scope = additional.koishi_is_direct ?? !info.group_info ? 'direct' : 'group'
  return `scope=${scope} platform=${info.platform || '-'} self=${selfId} channel=${channelId} user=${userId} route=${routeId} msg=${info.message_id || '-'} ${describeSegment(message.message_segment)}`
}

export function describeFragment(fragment: Fragment) {
  if (typeof fragment === 'string') return `fragment=text preview="${truncate(fragment)}"`
  if (Array.isArray(fragment)) return `fragment=array count=${fragment.length} preview="${truncate(fragment.join(''))}"`
  return `fragment=${typeof fragment}`
}
