import { h, type Awaitable, type Fragment, type Session } from 'koishi'
import type { Config } from '../config'
import type { KoishiRoute, MaimApiMessage, MaimInfoBase, MaimSeg } from '../types'

const PLATFORM = 'koishi'

type SendFragment = string | h

export interface SessionToMaimOptions {
  resolveImage?: (source: string) => Awaitable<string | undefined>
  replyContext?: ReplyContext
  forceMention?: boolean
}

export interface ReplyContext {
  targetMessageId: string
  targetMessageContent?: string
  targetMessageSenderId?: string
  targetMessageSenderNickname?: string
  targetMessageSenderCardname?: string
  contextCount?: number
}

function textSeg(content: string): MaimSeg {
  return { type: 'text', data: content }
}

function atSeg(element: h): MaimSeg {
  const id = String(element.attrs.id || element.attrs.userId || element.attrs.qq || '').trim()
  const name = String(element.attrs.name || element.attrs.nick || '').trim()
  return {
    type: 'at',
    data: {
      target_user_id: id,
      target_user_nickname: name,
      target_user_cardname: name,
    },
  }
}

function stringifyUnknown(element: h) {
  const attrs = Object.entries(element.attrs || {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  return attrs ? `[${element.type} ${attrs}]` : `[${element.type}]`
}

async function imageSegFromSource(source: unknown, options: SessionToMaimOptions): Promise<MaimSeg | undefined> {
  const src = typeof source === 'string' ? source.trim() : ''
  if (!src) return

  const dataUrl = /^data:image\/[^;]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(src)
  if (dataUrl) {
    return { type: 'image', data: dataUrl[1].replace(/\s/g, '') }
  }

  const base64Url = /^base64:\/\/([A-Za-z0-9+/=\s]+)$/i.exec(src)
  if (base64Url) {
    return { type: 'image', data: base64Url[1].replace(/\s/g, '') }
  }

  if (/^https?:\/\//i.test(src) && options.resolveImage) {
    const base64 = await options.resolveImage(src)
    if (base64) return { type: 'image', data: base64 }
  }

  return textSeg(`[图片: ${src}]`)
}

async function elementToSeg(element: h, options: SessionToMaimOptions): Promise<MaimSeg | undefined> {
  if (element.type === 'text') {
    return textSeg(element.attrs.content ?? '')
  }
  if (element.type === 'quote' || element.type === 'reply') {
    return replySegFromElement(element, options.replyContext)
  }
  if (element.type === 'at') {
    return atSeg(element)
  }
  if (element.type === 'img' || element.type === 'image') {
    const src = element.attrs.src || element.attrs.url || element.attrs.file
    return await imageSegFromSource(src, options) || textSeg(stringifyUnknown(element))
  }
  if (element.type === 'br') {
    return textSeg('\n')
  }
  return textSeg(stringifyUnknown(element))
}

async function normalizeSegments(elements: h[], options: SessionToMaimOptions) {
  const hasReplyElement = elements.some((element) => element.type === 'quote' || element.type === 'reply')
  const segments = (await Promise.all(elements.map((element) => elementToSeg(element, options))))
    .filter((segment): segment is MaimSeg => !!segment)
  if (options.replyContext && !hasReplyElement) {
    segments.unshift(replySeg(options.replyContext))
  }

  if (!segments.length) return textSeg('')
  if (segments.length === 1) return segments[0]
  return {
    type: 'seglist',
    data: segments,
  }
}

function getElements(session: Session): h[] {
  const existing = (session as any).elements
  if (Array.isArray(existing)) return existing
  return h.parse(session.content || '')
}

function textFromChildren(element: h) {
  const children = (element as any).children
  if (!Array.isArray(children)) return ''
  return children.map((child) => {
    if (typeof child === 'string') return child
    if (child?.type === 'text') return child.attrs?.content ?? ''
    if (child?.type === 'at') return `@${child.attrs?.name || child.attrs?.id || ''}`
    if (child?.type === 'img' || child?.type === 'image') return '[图片]'
    return child?.type ? stringifyUnknown(child) : ''
  }).join('').trim()
}

function replySeg(context: ReplyContext): MaimSeg {
  const data: Record<string, any> = {
    target_message_id: context.targetMessageId,
  }
  if (context.targetMessageContent) data.target_message_content = context.targetMessageContent
  if (context.targetMessageSenderId) data.target_message_sender_id = context.targetMessageSenderId
  if (context.targetMessageSenderNickname) data.target_message_sender_nickname = context.targetMessageSenderNickname
  if (context.targetMessageSenderCardname) data.target_message_sender_cardname = context.targetMessageSenderCardname
  if (context.contextCount !== undefined) data.koishi_context_count = context.contextCount

  if (Object.keys(data).length === 1) return { type: 'reply', data: context.targetMessageId }
  return { type: 'reply', data }
}

function replySegFromElement(element: h, context?: ReplyContext): MaimSeg | undefined {
  const targetMessageId = firstString(
    element.attrs.id,
    element.attrs.messageId,
    element.attrs.target,
    context?.targetMessageId,
  )
  if (!targetMessageId) return textSeg(stringifyUnknown(element))

  return replySeg({
    targetMessageId,
    targetMessageContent: context?.targetMessageId === targetMessageId
      ? context.targetMessageContent
      : textFromChildren(element) || firstString(element.attrs.content, element.attrs.text),
    targetMessageSenderId: context?.targetMessageId === targetMessageId ? context.targetMessageSenderId : undefined,
    targetMessageSenderNickname: context?.targetMessageId === targetMessageId ? context.targetMessageSenderNickname : undefined,
    targetMessageSenderCardname: context?.targetMessageId === targetMessageId ? context.targetMessageSenderCardname : undefined,
    contextCount: context?.targetMessageId === targetMessageId ? context.contextCount : undefined,
  })
}

function isAtBot(session: Session) {
  return getElements(session).some((element) => {
    if (element.type !== 'at') return false
    const id = String(element.attrs.id || element.attrs.userId || element.attrs.qq || '').trim()
    return !!id && id === String(session.selfId || '').trim()
  })
}

export function isMentioningBot(session: Session) {
  const selfId = String(session.selfId || '').trim()
  if (session.stripped?.atSelf) return true
  if (isAtBot(session)) return true

  const quote = (session as any).quote
  const quoteUserId = firstString(
    quote?.user?.id,
    quote?.author?.id,
    quote?.userId,
    quote?.sender?.userId,
  )
  return !!selfId && quoteUserId === selfId
}

function nonEmptyString(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || fallback
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) return normalized
  }
}

function segDataObject(segment: MaimSeg) {
  return segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data)
    ? segment.data as Record<string, any>
    : undefined
}

function segDataString(segment: MaimSeg) {
  return typeof segment.data === 'string' ? segment.data.trim() : ''
}

function atFragment(segment: MaimSeg): Fragment {
  const data = segDataObject(segment)
  const id = firstString(
    data?.target_user_id,
    data?.user_id,
    data?.id,
    data?.qq,
    segDataString(segment),
  )
  if (!id) return ''

  const name = firstString(
    data?.target_user_cardname,
    data?.target_user_nickname,
    data?.user_cardname,
    data?.user_nickname,
    data?.name,
    data?.nick,
  )
  return h('at', name ? { id, name } : { id })
}

function quoteFragment(segment: MaimSeg): Fragment {
  const data = segDataObject(segment)
  const id = firstString(
    data?.target_message_id,
    data?.message_id,
    data?.id,
    data?.target,
    segDataString(segment),
  )
  return id ? h('quote', { id }) : ''
}

function flattenFragment(fragment: Fragment | null | undefined): SendFragment[] {
  if (Array.isArray(fragment)) return fragment.flatMap(flattenFragment)
  if (fragment === '' || fragment === null || fragment === undefined) return []
  return [fragment as SendFragment]
}

function orderSendFragments(fragments: SendFragment[]): SendFragment[] {
  const quotes: SendFragment[] = []
  const rest: SendFragment[] = []
  for (const fragment of fragments) {
    if (typeof fragment !== 'string' && fragment.type === 'quote') {
      quotes.push(fragment)
    } else {
      rest.push(fragment)
    }
  }
  return [...quotes, ...rest]
}

function buildSenderInfo(session: Session): MaimInfoBase {
  const userId = nonEmptyString(session.userId || session.author?.id, 'unknown')
  const channelId = nonEmptyString(session.channelId, 'unknown')
  const userInfo = {
    platform: PLATFORM,
    user_id: userId,
    user_nickname: nonEmptyString(session.username || session.author?.name, userId),
    user_cardname: nonEmptyString(session.author?.nick, userId),
  }
  if (session.isDirect) {
    return { user_info: userInfo }
  }
  return {
    group_info: {
      platform: PLATFORM,
      group_id: channelId,
      group_name: nonEmptyString(session.event?.channel?.name || session.event?.guild?.name, channelId),
    },
    user_info: userInfo,
  }
}

export async function sessionToMaimMessage(
  session: Session,
  route: KoishiRoute,
  apiKey: string,
  options: SessionToMaimOptions = {},
): Promise<MaimApiMessage> {
  const messageId = String(session.messageId || session.id || `koishi-${Date.now()}`)
  const senderInfo = buildSenderInfo(session)
  const atBot = isMentioningBot(session)
  const forceMention = !!options.forceMention
  const mentioned = atBot || forceMention
  const replyContext = options.replyContext
  return {
    message_info: {
      platform: PLATFORM,
      message_id: messageId,
      time: session.timestamp ? session.timestamp / 1000 : Date.now() / 1000,
      group_info: senderInfo.group_info,
      user_info: senderInfo.user_info,
      sender_info: senderInfo,
      additional_config: {
        koishi_route_id: route.routeId,
        koishi_self_id: session.selfId,
        platform_io_account_id: session.selfId,
        koishi_platform: session.platform,
        koishi_channel_id: session.channelId || '',
        koishi_guild_id: session.guildId,
        koishi_user_id: session.userId,
        koishi_message_id: messageId,
        koishi_reply_to_message_id: replyContext?.targetMessageId,
        koishi_reply_context_count: replyContext?.contextCount,
        koishi_is_direct: !!session.isDirect,
        koishi_group_trigger_forced: !session.isDirect && forceMention,
        koishi_direct_trigger_forced: !!session.isDirect && forceMention,
        at_bot: mentioned,
        is_mentioned: mentioned,
      },
      format_info: {
        content_format: ['text', 'image'],
        accept_format: ['text', 'image'],
      },
    },
    message_segment: await normalizeSegments(getElements(session), options),
    message_dim: {
      api_key: apiKey,
      platform: PLATFORM,
    },
  }
}

function segToFragment(segment: MaimSeg): Fragment {
  if (segment.type === 'seglist' && Array.isArray(segment.data)) {
    return orderSendFragments(segment.data.flatMap((item) => flattenFragment(segToFragment(item)))) as h[]
  }
  if (segment.type === 'text') {
    return String(segment.data ?? '')
  }
  if (segment.type === 'image' || segment.type === 'img') {
    const src = String(segment.data ?? '')
    if (!src) return ''
    const normalized = /^(https?:|file:|data:)/.test(src) ? src : `data:image/png;base64,${src}`
    return h('img', { src: normalized })
  }
  if (segment.type === 'emoji') {
    return String(segment.data ?? '')
  }
  if (segment.type === 'at' || segment.type === 'mention') {
    return atFragment(segment)
  }
  if (segment.type === 'reply' || segment.type === 'quote') {
    return quoteFragment(segment)
  }
  return `[${segment.type}]${typeof segment.data === 'string' ? segment.data : JSON.stringify(segment.data)}`
}

export function maimMessageToFragment(message: MaimApiMessage): Fragment {
  return segToFragment(message.message_segment)
}

export function getRouteIdFromMaim(message: MaimApiMessage) {
  return message.message_info.additional_config?.koishi_route_id as string | undefined
}

export function getFallbackRouteHints(message: MaimApiMessage) {
  const receiver = message.message_info.receiver_info
  const messageInfo = message.message_info
  const additional = message.message_info.additional_config || {}
  const channelId = firstString(
    additional.koishi_channel_id,
    receiver?.group_info?.group_id,
    messageInfo.group_info?.group_id,
  )
  const userId = firstString(
    additional.koishi_user_id,
    additional.platform_io_target_user_id,
    receiver?.user_info?.user_id,
    messageInfo.user_info?.user_id,
  )
  const isDirect = typeof additional.koishi_is_direct === 'boolean'
    ? additional.koishi_is_direct
    : !channelId

  return {
    channelId,
    userId,
    selfId: firstString(additional.koishi_self_id),
    isDirect,
  }
}

export function shouldForwardSession(session: Session, config: Config) {
  if (!session.content && !getElements(session).length) return false
  const prefix = config.commandPrefix.trim()
  const matchesPrefix = !prefix || (session.content || '').trimStart().startsWith(prefix)
  if (session.isDirect) {
    if (config.messageMode !== 'command') return true
    return matchesPrefix
  }

  if (isMentioningBot(session)) return true
  if (config.messageMode === 'command') return matchesPrefix

  if (config.groupAutoReplyMode === 'mention-only') return false
  if (config.groupAutoReplyMode === 'allowlist') {
    const ids = new Set((config.groupAutoReplyChannelIds || []).map(id => String(id).trim()).filter(Boolean))
    return ids.has(String(session.channelId || '').trim()) || ids.has(String(session.guildId || '').trim())
  }
  return true
}
