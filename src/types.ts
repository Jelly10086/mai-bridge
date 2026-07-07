import type { Awaitable, Context, Fragment, Session } from 'koishi'

export type MessageMode = 'coexist' | 'exclusive' | 'command'
export type ProcessMode = 'docker' | 'managed' | 'external'
export type ProcessState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'blocked' | 'error'
export type TransportState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
export type MessageLogLevel = 'silent' | 'summary' | 'detail'
export type PrepareState = 'not-prepared' | 'preparing' | 'ready' | 'blocked' | 'error'
export type DockerState = 'idle' | 'building' | 'starting' | 'running' | 'stopping' | 'stopped' | 'blocked' | 'error'

export interface RuntimeStatus {
  prepare: {
    state: PrepareState
    root: string
    gitUrl: string
    gitRef: string
    patchApplied?: boolean
    patchChecksum?: string
    commit?: string
    blockedReason?: string
    lastError?: string
    updatedAt?: number
  }
  docker: {
    state: DockerState
    containerName: string
    imageName: string
    lastError?: string
    updatedAt?: number
  }
  process: {
    state: ProcessState
    pid?: number
    exitCode?: number | null
    signal?: NodeJS.Signals | null
    blockedReason?: string
    lastError?: string
    startedAt?: number
    stoppedAt?: number
  }
  transport: {
    state: TransportState
    url?: string
    reconnectAttempts: number
    lastError?: string
    connectedAt?: number
    disconnectedAt?: number
  }
  bridge: {
    koishiReceived: number
    maimSent: number
    maimReceived: number
    koishiSent: number
    routeMissed: number
    sendFailed: number
    lastKoishiMessageAt?: number
    lastMaimSendAt?: number
    lastMaimMessageAt?: number
    lastKoishiSendAt?: number
    lastRouteId?: string
    lastMessageId?: string
    lastError?: string
  }
  webui: {
    enabled: boolean
    host: string
    port: number
    url?: string
    publicUrl?: string
    token?: {
      value?: string
      source?: string
      path?: string
      lastError?: string
      loggedAt?: number
    }
  }
  logs: string[]
  logsHint?: string
}

export interface MaimSeg {
  type: string
  data: string | MaimSeg[] | Record<string, any>
}

export interface MaimInfoBase {
  group_info?: MaimGroupInfo
  user_info?: MaimUserInfo
}

export interface MaimGroupInfo {
  platform: string
  group_id: string
  group_name?: string
}

export interface MaimUserInfo {
  platform: string
  user_id: string
  user_nickname?: string
  user_cardname?: string
}

export interface MaimApiMessage {
  message_info: {
    platform: string
    message_id: string
    time: number
    group_info?: MaimGroupInfo
    user_info?: MaimUserInfo
    additional_config?: Record<string, any>
    sender_info?: MaimInfoBase
    receiver_info?: MaimInfoBase
    format_info?: {
      content_format?: string[]
      accept_format?: string[]
    }
  }
  message_segment: MaimSeg
  message_dim: {
    api_key: string
    platform: string
  }
}

export interface MaimPacket {
  ver: 1
  msg_id: string
  type: string
  meta?: Record<string, any>
  payload?: any
}

export interface KoishiRoute {
  routeId: string
  session: Session
  botSelfId: string
  platform: string
  channelId: string
  guildId?: string
  userId: string
  isDirect: boolean
  updatedAt: number
}

export interface MaibotServiceApi {
  launch(): Promise<RuntimeStatus>
  shutdown(): Promise<RuntimeStatus>
  restart(): Promise<RuntimeStatus>
  reconnect(): Promise<RuntimeStatus>
  prepare(): Promise<RuntimeStatus>
  dockerStart(): Promise<RuntimeStatus>
  dockerStop(): Promise<RuntimeStatus>
  dockerRestart(): Promise<RuntimeStatus>
  getStatus(): RuntimeStatus
  handleSession(session: Session, next: () => Awaitable<void | Fragment>): Promise<void | Fragment>
}

declare module 'koishi' {
  interface Context {
    maimai: MaibotServiceApi
  }
}

export interface ConsoleEvents {
  'mai-ko/status'(): RuntimeStatus
  'mai-ko/start'(): Promise<RuntimeStatus>
  'mai-ko/stop'(): Promise<RuntimeStatus>
  'mai-ko/restart'(): Promise<RuntimeStatus>
  'mai-ko/reconnect'(): Promise<RuntimeStatus>
  'mai-ko/prepare'(): Promise<RuntimeStatus>
  'mai-ko/docker-start'(): Promise<RuntimeStatus>
  'mai-ko/docker-stop'(): Promise<RuntimeStatus>
  'mai-ko/docker-restart'(): Promise<RuntimeStatus>
}

export type KoishiContext = Context
