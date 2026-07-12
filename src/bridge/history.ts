import { h, type Fragment, type Session } from 'koishi'
import type { KoishiRoute, MaimApiMessage } from '../types'
import type { ReplyContext } from './convert'

const REPLY_CONTEXT_COUNT = 5
const MAX_MESSAGES_PER_SCOPE = 80

interface HistoryMessage {
  messageId: string
  scopeId: string
  senderId: string
  senderName: string
  senderCardname?: string
  content: string
  imageSources: string[]
  timestamp: number
}

export class MessageHistory {
  private messages = new Map<string, HistoryMessage[]>()
  private byId = new Map<string, HistoryMessage>()

  constructor(private ttl: number) {}

  rememberSession(session: Session, route: KoishiRoute) {
    const messageId = String(session.messageId || session.id || '').trim()
    if (!messageId) return
    this.remember({
      messageId,
      scopeId: this.getScopeId(route),
      senderId: String(session.userId || session.author?.id || 'unknown'),
      senderName: this.pickName(session.author?.nick, session.username, session.author?.name, session.userId),
      senderCardname: this.pickOptional(session.author?.nick),
      content: this.sessionText(session),
      imageSources: this.sessionImageSources(session),
      timestamp: session.timestamp || Date.now(),
    })
  }

  rememberMaimMessage(route: KoishiRoute, message: MaimApiMessage, actualId: string, fragment: Fragment) {
    const messageId = String(actualId || '').trim()
    if (!messageId) return
    const userInfo = message.message_info.sender_info?.user_info || message.message_info.user_info
    this.remember({
      messageId,
      scopeId: this.getScopeId(route),
      senderId: String(userInfo?.user_id || route.botSelfId || 'mai.ko'),
      senderName: this.pickName(userInfo?.user_cardname, userInfo?.user_nickname, userInfo?.user_id, 'mai.ko'),
      senderCardname: this.pickOptional(userInfo?.user_cardname),
      content: this.fragmentText(fragment),
      imageSources: this.fragmentImageSources(fragment),
      timestamp: Date.now(),
    })
  }

  hasMessage(route: KoishiRoute, messageId: string) {
    const id = String(messageId || '').trim()
    if (!id) return false
    this.cleanup()
    const message = this.byId.get(id)
    return !!message && message.scopeId === this.getScopeId(route)
  }

  resolveReplyContext(session: Session, route: KoishiRoute, loadedQuote?: any): ReplyContext | undefined {
    const targetMessageId = this.getReplyMessageId(session)
    if (!targetMessageId) return

    this.cleanup()
    const scopeId = this.getScopeId(route)
    const quote = loadedQuote || (session as any).quote
    const target = this.byId.get(targetMessageId)
    const recent = (this.messages.get(scopeId) || []).slice(-REPLY_CONTEXT_COUNT)
    const contextMessages = this.ensureTargetInContext(recent, target)
    const quoteContent = this.messageText(quote)
    const targetContent = quoteContent || target?.content || ''
    const targetSender = this.resolveTargetSender(quote, target)
    const imageSources = this.uniqueStrings([
      ...this.messageImageSources(quote),
      ...(target?.imageSources || []),
    ])
    const contextText = this.formatContext(contextMessages, targetMessageId)

    return {
      targetMessageId,
      targetMessageContent: this.mergeTargetContent(targetContent, contextText, targetSender.label),
      targetMessageSenderId: targetSender.id,
      targetMessageSenderNickname: targetSender.name,
      targetMessageSenderCardname: targetSender.cardname,
      targetMessageImageSources: imageSources.length ? imageSources : undefined,
      contextCount: contextMessages.length,
    }
  }

  clear() {
    this.messages.clear()
    this.byId.clear()
  }

  private remember(message: HistoryMessage) {
    if (!message.content.trim() && !message.imageSources.length) return
    this.cleanup()
    const existing = this.byId.get(message.messageId)
    if (existing) {
      const messages = this.messages.get(existing.scopeId)
      if (messages) this.messages.set(existing.scopeId, messages.filter((item) => item.messageId !== message.messageId))
    }

    const scopedMessages = this.messages.get(message.scopeId) || []
    scopedMessages.push(message)
    while (scopedMessages.length > MAX_MESSAGES_PER_SCOPE) {
      const removed = scopedMessages.shift()
      if (removed) this.byId.delete(removed.messageId)
    }
    this.messages.set(message.scopeId, scopedMessages)
    this.byId.set(message.messageId, message)
  }

  private getScopeId(route: KoishiRoute) {
    if (route.isDirect) {
      return ['koishi', route.platform, route.botSelfId, 'direct', route.userId].join(':')
    }
    return ['koishi', route.platform, route.botSelfId, route.guildId || '', route.channelId].join(':')
  }

  getReplyMessageId(session: Session) {
    const quote = (session as any).quote
    const quoteId = this.pickOptional(quote?.id, quote?.messageId)
    if (quoteId) return quoteId

    for (const element of this.getElements(session)) {
      if (element.type !== 'quote' && element.type !== 'reply') continue
      const messageId = this.pickOptional(element.attrs.id, element.attrs.messageId, element.attrs.target)
      if (messageId) return messageId
    }

    return this.onebotReplyMessageId((session as any).onebot?.message)
      || this.onebotReplyMessageId((session as any).event?._data?.message)
      || this.onebotReplyMessageId((session as any).event?.onebot?.message)
  }

  onebotMessageToQuote(message: any) {
    if (!message) return
    const elements = this.onebotMessageElements(message.message)
    return {
      id: this.pickOptional(message.message_id, message.id, message.messageId),
      messageId: this.pickOptional(message.message_id, message.id, message.messageId),
      content: this.elementsText(elements),
      elements,
      user: {
        id: this.pickOptional(message.sender?.user_id, message.user_id),
        name: this.pickOptional(message.sender?.nickname, message.sender?.card),
      },
      author: {
        id: this.pickOptional(message.sender?.user_id, message.user_id),
        name: this.pickOptional(message.sender?.nickname, message.sender?.card),
        nick: this.pickOptional(message.sender?.card),
      },
      member: {
        nick: this.pickOptional(message.sender?.card),
      },
      sender: {
        user_id: this.pickOptional(message.sender?.user_id, message.user_id),
        nickname: this.pickOptional(message.sender?.nickname),
        card: this.pickOptional(message.sender?.card),
      },
    }
  }

  private ensureTargetInContext(messages: HistoryMessage[], target?: HistoryMessage) {
    if (!target || messages.some((message) => message.messageId === target.messageId)) return messages
    return [...messages, target].slice(-REPLY_CONTEXT_COUNT)
  }

  private mergeTargetContent(targetContent: string, contextText: string, senderLabel?: string) {
    const parts: string[] = []
    const targetLines: string[] = []
    if (senderLabel) targetLines.push(`发送者: ${senderLabel}`)
    if (targetContent.trim()) targetLines.push(`内容: ${targetContent.trim()}`)
    if (targetLines.length) parts.push(`[当前消息正在回复的目标]\n${targetLines.join('\n')}\n[引用目标结束]`)
    if (contextText.trim()) parts.push(contextText.trim())
    return parts.join('\n\n') || targetContent
  }

  private formatContext(messages: HistoryMessage[], targetMessageId: string) {
    if (!messages.length) return ''
    const lines = messages.map((message, index) => {
      const marker = message.messageId === targetMessageId ? ' <- 被回复' : ''
      return `${index + 1}. ${this.senderLabel(message)}: ${message.content}${marker}`
    })
    return `[最近 ${messages.length} 条上下文，仅供参考，不是当前被回复目标]\n${lines.join('\n')}`
  }

  private sessionText(session: Session) {
    return this.elementsText(this.getElements(session)) || String(session.content || '').trim()
  }

  private messageText(message?: { content?: string, elements?: Array<h | string> }) {
    if (!message) return ''
    return this.elementsText(message.elements || []) || String(message.content || '').trim()
  }

  private fragmentText(fragment: Fragment): string {
    if (typeof fragment === 'string') return fragment.trim()
    if (Array.isArray(fragment)) return this.elementsText(fragment)
    return String(fragment || '').trim()
  }

  private sessionImageSources(session: Session) {
    return this.elementsImageSources(this.getElements(session))
  }

  private messageImageSources(message?: { content?: string, elements?: Array<h | string> }) {
    if (!message) return []
    const sources = this.elementsImageSources(message.elements || [])
    if (sources.length) return sources
    return this.elementsImageSources(h.parse(message.content || ''))
  }

  private fragmentImageSources(fragment: Fragment): string[] {
    if (typeof fragment === 'string') return []
    if (Array.isArray(fragment)) return this.elementsImageSources(fragment)
    if (fragment && typeof fragment === 'object') return this.elementsImageSources([fragment as h])
    return []
  }

  private elementsImageSources(elements: Array<h | string>) {
    const sources: string[] = []
    for (const element of elements) {
      if (typeof element === 'string') continue
      if (this.isImageElement(element)) {
        const source = this.pickOptional(element.attrs.src, element.attrs.url, element.attrs.file)
        if (source) sources.push(source)
      }
      const children = (element as any).children
      if (Array.isArray(children)) sources.push(...this.elementsImageSources(children))
    }
    return this.uniqueStrings(sources)
  }

  private elementsText(elements: Array<h | string>) {
    return elements.map((element) => {
      if (typeof element === 'string') return element
      if (element.type === 'text') return element.attrs.content || ''
      if (element.type === 'at') return `@${element.attrs.name || element.attrs.id || ''}`
      if (this.isImageElement(element)) return '[图片]'
      if (this.isEmojiElement(element)) return '[表情包]'
      if (element.type === 'quote' || element.type === 'reply') return ''
      if (element.type === 'br') return '\n'
      return `[${element.type}]`
    }).join('').trim()
  }

  private getElements(session: Session): h[] {
    const elements = (session as any).elements
    if (Array.isArray(elements)) return elements
    return h.parse(session.content || '')
  }

  private cleanup() {
    const now = Date.now()
    for (const [scopeId, messages] of this.messages) {
      const alive = messages.filter((message) => now - message.timestamp <= this.ttl)
      if (alive.length) {
        this.messages.set(scopeId, alive)
      } else {
        this.messages.delete(scopeId)
      }
    }
    for (const [messageId, message] of this.byId) {
      if (now - message.timestamp > this.ttl) this.byId.delete(messageId)
    }
  }

  private pickName(...values: unknown[]) {
    return this.pickOptional(...values) || 'unknown'
  }

  private senderLabel(message: HistoryMessage) {
    const name = this.pickOptional(message.senderCardname, message.senderName) || message.senderId
    return name === message.senderId ? name : `${name}(${message.senderId})`
  }

  private resolveTargetSender(quote: any, target?: HistoryMessage) {
    const id = this.pickOptional(
      quote?.user?.id,
      quote?.author?.id,
      quote?.userId,
      quote?.sender?.userId,
      quote?.sender?.user_id,
      target?.senderId,
    )
    const name = this.pickOptional(
      quote?.member?.nick,
      quote?.author?.nick,
      quote?.user?.name,
      quote?.author?.name,
      quote?.sender?.card,
      quote?.sender?.cardname,
      quote?.sender?.nickname,
      quote?.sender?.name,
      target?.senderCardname,
      target?.senderName,
    )
    const cardname = this.pickOptional(
      quote?.member?.nick,
      quote?.author?.nick,
      quote?.sender?.card,
      quote?.sender?.cardname,
      target?.senderCardname,
    )
    const label = id && name && name !== id ? `${name}(${id})` : name || id
    return { id, name, cardname, label }
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  }

  private pickOptional(...values: unknown[]) {
    for (const value of values) {
      const text = typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' || typeof value === 'bigint'
          ? String(value).trim()
          : ''
      if (text) return text
    }
  }

  private onebotReplyMessageId(message: unknown) {
    if (Array.isArray(message)) {
      for (const segment of message) {
        if (segment?.type !== 'reply') continue
        const id = this.pickOptional(segment.data?.id, segment.attrs?.id, segment.id)
        if (id) return id
      }
      return
    }

    const source = typeof message === 'string' ? message : ''
    const match = /\[CQ:reply,[^\]]*id=([^,\]]+)/.exec(source)
    return match ? this.decodeCQValue(match[1]) : undefined
  }

  private onebotMessageElements(message: unknown): Array<h | string> {
    if (Array.isArray(message)) {
      const elements: Array<h | string> = []
      for (const segment of message) {
        const type = String(segment?.type || '').trim()
        const data = segment?.data || segment?.attrs || {}
        if (type === 'reply') continue
        if (type === 'text') {
          const text = this.pickOptional(data.text, data.content, segment.text)
          if (text) elements.push(text)
          continue
        }
        if (type === 'at') {
          elements.push(`@${this.pickOptional(data.name, data.qq, data.id) || ''}`)
          continue
        }
        if (type === 'image' || this.isEmojiType(type)) {
          const source = this.pickOptional(data.url, data.file, data.src, data.path)
          elements.push(source ? h('img', { src: source }) : `[${this.isEmojiType(type) ? '表情包' : '图片'}]`)
          continue
        }
        elements.push(`[${type || 'unknown'}]`)
      }
      return elements
    }

    if (typeof message !== 'string') return []
    return this.onebotStringElements(message)
  }

  private onebotStringElements(source: string): Array<h | string> {
    const elements: Array<h | string> = []
    const pattern = /\[CQ:([a-zA-Z0-9_-]+),([^\]]*)\]/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      if (match.index > lastIndex) elements.push(source.slice(lastIndex, match.index))
      const type = match[1]
      const attrs = this.parseCQAttrs(match[2])
      if (type === 'reply') {
        lastIndex = pattern.lastIndex
        continue
      }
      if (type === 'at') {
        elements.push(`@${attrs.name || attrs.qq || attrs.id || ''}`)
      } else if (type === 'image' || this.isEmojiType(type)) {
        const src = attrs.url || attrs.file || attrs.src
        elements.push(src ? h('img', { src }) : `[${this.isEmojiType(type) ? '表情包' : '图片'}]`)
      } else {
        elements.push(`[${type}]`)
      }
      lastIndex = pattern.lastIndex
    }
    if (lastIndex < source.length) elements.push(source.slice(lastIndex))
    return elements
  }

  private parseCQAttrs(source: string) {
    const attrs: Record<string, string> = {}
    for (const pair of source.split(',')) {
      const index = pair.indexOf('=')
      if (index <= 0) continue
      attrs[pair.slice(0, index)] = this.decodeCQValue(pair.slice(index + 1))
    }
    return attrs
  }

  private decodeCQValue(value: string) {
    return value
      .replace(/&#44;/g, ',')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/&amp;/g, '&')
  }

  private isImageElement(element: h) {
    return element.type === 'img' || element.type === 'image'
  }

  private isEmojiElement(element: h) {
    return this.isEmojiType(element.type)
  }

  private isEmojiType(type: string) {
    return ['emoji', 'face', 'mface', 'marketface', 'sticker', 'sface', 'bface'].includes(type)
  }
}
