import { Logger, type Context } from 'koishi'
import type { Config } from '../config'
import type { MaimApiMessage, MaimPacket } from '../types'
import { describeMaimMessage, redactTransportUrl } from './logging'

type SocketLike = WebSocket & {
  on?: (event: string, listener: (...args: any[]) => void) => void
  off?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
}

export interface MaimTransportEvents {
  onMessage(message: MaimApiMessage): void | Promise<void>
  onClose?(): void
  onError?(error: Error): void
  onPacketSent?(packet: MaimPacket): void
  onPacketReceived?(packet: MaimPacket): void
}

export class MaimTransport {
  private logger = new Logger('mai.ko/transport')
  private socket?: SocketLike
  private connectedAt?: number
  private lastError?: string
  private intentionallyClosing?: SocketLike

  constructor(
    private ctx: Context,
    private config: Config,
    private apiKey: string,
    private events: MaimTransportEvents,
  ) {}

  get url() {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      platform: 'koishi',
    })
    return `ws://${this.config.apiHost}:${this.config.apiPort}/ws?${params}`
  }

  get status() {
    return {
      url: redactTransportUrl(this.url),
      connectedAt: this.connectedAt,
      lastError: this.lastError,
    }
  }

  async connect(timeout = 10000) {
    await this.disconnect()
    this.logger.info(`connecting mai.ko websocket: ${redactTransportUrl(this.url)}`)
    const socket = this.ctx.http.ws(this.url) as SocketLike
    this.intentionallyClosing = undefined
    this.socket = socket
    this.bindSocket(socket)
    await this.waitOpen(socket, timeout)
    this.connectedAt = Date.now()
    this.lastError = undefined
    this.logger.info(`mai.ko websocket connected: ${redactTransportUrl(this.url)}`)
  }

  async disconnect() {
    const socket = this.socket
    this.socket = undefined
    this.connectedAt = undefined
    if (!socket) return
    this.intentionallyClosing = socket
    try {
      socket.close()
    } catch (error) {
      this.logger.debug(error)
    }
  }

  sendMessage(message: MaimApiMessage) {
    const packet = {
      ver: 1,
      msg_id: this.nextId('msg'),
      type: 'sys_std',
      meta: {
        sender_user: this.apiKey,
        platform: 'koishi',
        timestamp: Date.now() / 1000,
      },
      payload: message,
    } satisfies MaimPacket
    this.logger.debug(`send to maimai: packet=${packet.msg_id} ${describeMaimMessage(message)}`)
    return this.sendPacket(packet)
  }

  sendEcho(echo: string, actualId: string) {
    const packet = {
      ver: 1,
      msg_id: this.nextId('custom'),
      type: 'custom_message_id_echo',
      meta: {
        sender_user: this.apiKey,
        platform: 'koishi',
        timestamp: Date.now() / 1000,
      },
      payload: {
        content: {
          type: 'echo',
          echo,
          actual_id: actualId,
        },
      },
    } satisfies MaimPacket
    this.logger.debug(`send echo to maimai: echo=${echo} actual=${actualId}`)
    return this.sendPacket(packet)
  }

  private sendPacket(packet: MaimPacket) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error('mai.ko transport is not connected')
    }
    this.socket.send(JSON.stringify(packet))
    this.events.onPacketSent?.(packet)
  }

  private bindSocket(socket: SocketLike) {
    const onMessage = (event: MessageEvent | any) => {
      const raw = event?.data ?? event
      void this.handleRawMessage(raw)
    }
    const onClose = () => {
      if (this.socket !== socket) return
      this.connectedAt = undefined
      this.events.onClose?.()
    }
    const onError = (event: Event | Error | any) => {
      if (this.socket !== socket || this.intentionallyClosing === socket) return
      const error = event instanceof Error ? event : new Error(event?.message || 'mai.ko websocket error')
      this.lastError = error.message
      this.events.onError?.(error)
    }

    this.addListener(socket, 'message', onMessage)
    this.addListener(socket, 'close', onClose)
    this.addListener(socket, 'error', onError)
  }

  private async handleRawMessage(raw: any) {
    try {
      const text = typeof raw === 'string'
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString('utf8')
          : Buffer.isBuffer(raw)
            ? raw.toString('utf8')
            : String(raw)
      const packet = JSON.parse(text) as MaimPacket
      this.events.onPacketReceived?.(packet)
      if (packet.type === 'sys_ack') return
      if (packet.type !== 'sys_std') {
        this.logger.debug(`ignored mai.ko packet type: ${packet.type}`)
        return
      }
      if (!packet.payload) return
      await this.events.onMessage(packet.payload as MaimApiMessage)
    } catch (error) {
      this.logger.warn(error)
    }
  }

  private waitOpen(socket: SocketLike, timeout: number) {
    if (socket.readyState === 1) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = this.ctx.setTimeout(() => {
        cleanup()
        reject(new Error(`connect mai.ko websocket timeout after ${timeout}ms`))
      }, timeout)
      const cleanup = () => {
        timer()
        this.removeListener(socket, 'open', onOpen)
        this.removeListener(socket, 'error', onError)
      }
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (event: any) => {
        cleanup()
        reject(event instanceof Error ? event : new Error(event?.message || 'mai.ko websocket connect failed'))
      }
      this.addListener(socket, 'open', onOpen)
      this.addListener(socket, 'error', onError)
    })
  }

  private addListener(socket: SocketLike, event: string, listener: (...args: any[]) => void) {
    if (socket.addEventListener) {
      socket.addEventListener(event, listener as EventListener)
    } else {
      socket.on?.(event, listener)
    }
  }

  private removeListener(socket: SocketLike, event: string, listener: (...args: any[]) => void) {
    if (socket.removeEventListener) {
      socket.removeEventListener(event, listener as EventListener)
    } else {
      socket.off?.(event, listener) ?? socket.removeListener?.(event, listener)
    }
  }

  private nextId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}
