import { Schema } from 'koishi'
import type { CommandResultMode, GroupAutoReplyMode, MessageLogLevel, MessageMode, ProcessMode } from './types'

export interface Config {
  processMode: ProcessMode
  maibotRoot: string
  maibotGitUrl: string
  maibotGitRef: string
  autoPrepareMaibot: boolean
  applyBundledPatch: boolean
  pythonCommand: string
  entryScript: string
  autoStart: boolean
  apiHost: string
  apiPort: number
  legacyHost: string
  legacyPort: number
  apiKey: string
  webuiEnabled: boolean
  webuiHost: string
  webuiPort: number
  webuiPublicUrl: string
  webuiTokenPath: string
  showWebuiToken: boolean
  messageMode: MessageMode
  commandPrefix: string
  groupAutoReplyMode: GroupAutoReplyMode
  groupAutoReplyChannelIds: string[]
  groupMessageTriggerCount: number
  directMessageTriggerCount: number
  imageDownloadEnabled: boolean
  imageDownloadTimeout: number
  imageDownloadMaxBytes: number
  messageLogLevel: MessageLogLevel
  commandAuthority: number
  commandResultMode: CommandResultMode
  commandResultAdminUserId: string
  commandResultAdminGuildId: string
  commandResultNotifySource: boolean
  acceptMaibotAgreements: boolean
  startupTimeout: number
  shutdownTimeout: number
  reconnectMaxAttempts: number
  reconnectBaseDelay: number
  routeTtl: number
  logLines: number
  forwardStartupLogs: boolean
  externalLogsEnabled: boolean
  externalLogsCommand: string
  externalLogsContainer: string
  externalLogsTail: number
  externalLogsSkipDebug: boolean
  dockerCommand: string
  dockerContainerName: string
  dockerImageName: string
  dockerNetwork: string
  dockerPublishedWebuiPort: number
  dockerRecreateOnStart: boolean
  enableConsole: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    processMode: Schema.union([
      Schema.const('docker').description('Docker：插件自动准备 MaiBot 源码、构建镜像并启动 maimai-ko 容器。'),
      Schema.const('managed').description('托管：由 Koishi 插件启动并停止 mai.ko Python 进程。'),
      Schema.const('external').description('外部：mai.ko 已由其他进程或容器启动，插件只连接 API Bridge。'),
    ]).default('docker').description('mai.ko 进程管理模式。默认使用 Docker 外部模式。'),
    maibotRoot: Schema.path({
      filters: ['directory'],
    }).default('data/mai.ko/maimai').description('MaiBot 源码目录。相对路径基于 Koishi 工作目录。'),
    maibotGitUrl: Schema.string().default('https://github.com/Mai-with-u/MaiBot.git').description('自动准备时拉取 MaiBot 源码的 Git 地址。'),
    maibotGitRef: Schema.string().default('main').description('自动准备时检出的 MaiBot 分支、标签或提交。'),
    autoPrepareMaibot: Schema.boolean().default(true).description('启动前自动 clone/fetch MaiBot、应用补丁并准备运行环境。'),
    applyBundledPatch: Schema.boolean().default(true).description('自动准备时应用插件内置 maimai-koishi.patch。'),
    pythonCommand: Schema.string().default('python3').description('用于启动 mai.ko 的 Python 命令。'),
    entryScript: Schema.string().default('bot.py').description('相对于 mai.ko 根目录的启动脚本。'),
    autoStart: Schema.boolean().default(true).description('Koishi ready 后自动启动 mai.ko。'),
    acceptMaibotAgreements: Schema.boolean().default(false).description('确认同意 MaiBot 的 EULA/Privacy。'),
  }).description('mai.ko 进程'),
  Schema.object({
    apiHost: Schema.string().default('maimai-ko').description('Koishi 连接 maim_message 新版 API Server 的地址。Docker 模式默认使用容器名。'),
    apiPort: Schema.number().min(1).max(65535).default(8090).description('maim_message 新版 API Server 监听端口。'),
    legacyHost: Schema.string().default('127.0.0.1').description('maim_message 旧版 WS 服务监听地址。'),
    legacyPort: Schema.number().min(1).max(65535).default(8000).description('maim_message 旧版 WS 服务监听端口。'),
    apiKey: Schema.string().role('secret').default('').description('Koishi 连接 mai.ko API Server 的 API Key；留空时自动生成运行期密钥。'),
  }).description('桥接网络'),
  Schema.object({
    webuiEnabled: Schema.boolean().default(true).description('启动 mai.ko 原生 WebUI。仅托管模式会注入到 Python 进程。'),
    webuiHost: Schema.string().default('0.0.0.0').description('mai.ko WebUI 监听地址。Docker 暴露端口时通常应设为 0.0.0.0。'),
    webuiPort: Schema.number().min(1).max(65535).default(8002).description('mai.ko WebUI 监听端口。'),
    webuiPublicUrl: Schema.string().default('').description('Koishi 控制台中展示的 WebUI 访问地址；留空时按监听地址自动生成。'),
    webuiTokenPath: Schema.path({ filters: ['file'] }).default('').description('WebUI Token 文件路径；留空时读取 maibotRoot/data/webui.json。Docker external 模式需把 maimai data 目录挂进 Koishi 后填写。'),
    showWebuiToken: Schema.boolean().default(true).description('启动或连接成功后在 Koishi 日志与控制台状态页显示完整 WebUI Token。仅建议私有控制台开启。'),
  }).description('mai.ko WebUI'),
  Schema.object({
    messageMode: Schema.union([
      Schema.const('coexist').description('共存：转发给 mai.ko 后继续 Koishi 后续中间件。'),
      Schema.const('exclusive').description('独占：转发给 mai.ko 后阻断后续中间件。'),
      Schema.const('command').description('命令：仅命中指令前缀时转发。'),
    ]).default('coexist').description('消息转发模式。'),
    commandPrefix: Schema.string().default('mai.ko').description('command 模式下触发 mai.ko 的文本前缀。'),
    groupAutoReplyMode: Schema.union([
      Schema.const('all').description('所有群聊都允许自动回复。'),
      Schema.const('allowlist').description('仅名单内群聊允许自动回复，其他群聊只响应 @ 或回复机器人消息。'),
      Schema.const('mention-only').description('所有群聊只响应 @ 或回复机器人消息。'),
    ]).default('all').description('群聊自动回复范围。@ 机器人和回复机器人消息始终会强制触发。'),
    groupAutoReplyChannelIds: Schema.array(String).role('table').default([]).description('允许自动回复的群聊 ID 名单。groupAutoReplyMode=allowlist 时生效，可填写 channelId 或 guildId。'),
    groupMessageTriggerCount: Schema.number().min(1).default(1).description('同一群聊累计达到多少条消息后批量转发并强制触发 mai.ko 思考；1 表示每条群消息都转发。'),
    directMessageTriggerCount: Schema.number().min(1).default(1).description('同一私聊累计达到多少条消息后批量转发并强制触发 mai.ko 思考；1 表示每条私信都转发。'),
    imageDownloadEnabled: Schema.boolean().default(true).description('转发图片消息前由 Koishi 下载图片并转为 mai.ko 可识别的 base64 图片段。'),
    imageDownloadTimeout: Schema.number().min(1000).default(10000).description('下载单张入站图片的超时时间，单位毫秒。'),
    imageDownloadMaxBytes: Schema.number().min(1024).default(10 * 1024 * 1024).description('允许转发给 mai.ko 的单张图片最大字节数。'),
    messageLogLevel: Schema.union([
      Schema.const('silent').description('静默：只输出异常和生命周期日志。'),
      Schema.const('summary').description('摘要：输出简短消息中转成功日志。'),
      Schema.const('detail').description('详细：输出每一步消息中转细节。'),
    ]).default('summary').description('mai.ko 消息中转日志详细程度。'),
    commandAuthority: Schema.number().min(0).max(5).default(3).description('管理指令需要的权限等级。'),
    commandResultMode: Schema.union([
      Schema.const('source').description('原会话：指令结果发送到触发指令的群聊或私聊。'),
      Schema.const('admin').description('管理员私聊：指令结果发送到指定管理员；未填写管理员时发送给指令调用者。'),
      Schema.const('silent').description('静默：执行指令但不发送结果。'),
    ]).default('source').description('聊天中执行 mai.ko 管理指令后的结果发送方式。'),
    commandResultAdminUserId: Schema.string().default('').description('管理员用户 ID。仅 commandResultMode=admin 时使用；留空时发送给指令调用者。'),
    commandResultAdminGuildId: Schema.string().default('').description('发送管理员私聊时附带的群组/频道 ID。通常可留空。'),
    commandResultNotifySource: Schema.boolean().default(false).description('结果发送给管理员后，是否在原会话发送一条简短提示。'),
  }).description('消息路由'),
  Schema.object({
    startupTimeout: Schema.number().min(1000).default(60000).description('等待 mai.ko API 可连接的超时时间，单位毫秒。'),
    shutdownTimeout: Schema.number().min(1000).default(10000).description('等待 mai.ko 优雅退出的超时时间，单位毫秒。'),
    reconnectMaxAttempts: Schema.number().min(0).default(10).description('WebSocket 断线后的最大自动重连次数，0 表示无限。'),
    reconnectBaseDelay: Schema.number().min(100).default(1000).description('WebSocket 重连基础延迟，单位毫秒。'),
    routeTtl: Schema.number().min(60000).default(1800000).description('最近会话路由缓存时间，单位毫秒。'),
    logLines: Schema.number().min(20).max(1000).default(200).description('保留的 mai.ko 进程日志行数。'),
    forwardStartupLogs: Schema.boolean().default(true).description('托管模式下将 mai.ko 启动阶段 stdout/stderr 转写到 Koishi 日志。'),
    externalLogsEnabled: Schema.boolean().default(false).description('外部模式下转发 maimai 容器日志到 Koishi 日志与 mai.ko 状态页。需要 Koishi 运行环境可执行 Docker 日志命令。'),
    externalLogsCommand: Schema.string().default('docker logs --tail {tail} -f {container}').description('外部日志命令模板，支持 {container} 与 {tail} 占位。'),
    externalLogsContainer: Schema.string().default('maimai-ko').description('要读取 docker logs 的 maimai 容器名。'),
    externalLogsTail: Schema.number().min(0).max(1000).default(40).description('启动转发时读取的历史日志行数，0 表示不读取历史。'),
    externalLogsSkipDebug: Schema.boolean().default(true).description('转发 maimai 容器日志时跳过 DEBUG 级别刷屏日志。'),
    dockerCommand: Schema.string().default('docker').description('Docker CLI 命令。Koishi 容器内运行时需确保可执行 docker。'),
    dockerContainerName: Schema.string().default('maimai-ko').description('插件管理的 MaiBot Docker 容器名。'),
    dockerImageName: Schema.string().default('maimai-ko:latest').description('插件构建的 MaiBot Docker 镜像名。'),
    dockerNetwork: Schema.string().default('').description('运行 maimai-ko 的 Docker 网络；留空时由 Docker 使用默认网络。'),
    dockerPublishedWebuiPort: Schema.number().min(0).max(65535).default(0).description('宿主机暴露的 WebUI 端口；0 表示不添加 -p 映射。'),
    dockerRecreateOnStart: Schema.boolean().default(false).description('每次启动 Docker 模式时重建容器，以应用最新环境变量。'),
    enableConsole: Schema.boolean().default(true).description('启用 Koishi Console 最小状态页。'),
  }).description('运行时'),
])
