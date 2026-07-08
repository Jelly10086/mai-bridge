# mai-bridge

将 maibot 作为 Docker 托管的消息回复后端运行，使用 mai.ko 桥接 Koishi 与 maibot 的消息收发。

mai-bridge 不重写 maibot 的对话链、记忆系统和插件机制。它负责在 Koishi 侧完成三件事：

- 自动准备 MaiBot 源码，应用 Koishi 适配补丁。
- 构建并启动 `maimai-ko` Docker 容器。
- 把 Koishi 消息转发给 maibot，再把 maibot 回复发回原会话。

## 安装

在 Koishi 控制台打开插件市场，搜索并安装：

```text
mai-bridge
```

插件包名：

```text
koishi-plugin-mai-bridge
```

同时需要启用 Koishi 的 HTTP 服务：

```text
@koishijs/plugin-http
```

## 运行要求

默认模式使用 Docker。

Koishi 所在环境需要能执行 Docker 命令，并能访问 Docker socket：

```text
/var/run/docker.sock
```

如果 Koishi 本身也运行在 Docker 内，需要把 Docker socket 挂载进 Koishi 容器，并确保容器里有 `docker`、`git`、`patch` 命令。

## 基础配置

插件市场安装后，进入插件配置页。

常用配置：

```yaml
processMode: docker
autoPrepareMaibot: true
acceptMaibotAgreements: true
dockerContainerName: maimai-ko
dockerImageName: maimai-ko:latest
apiHost: maimai-ko
apiPort: 8090
webuiEnabled: true
webuiHost: 0.0.0.0
webuiPort: 8002
messageMode: coexist
groupMessageTriggerCount: 1
directMessageTriggerCount: 1
commandResultMode: source
```

说明：

- `processMode` 保持 `docker`，插件会自动拉取 MaiBot、打补丁、构建镜像并启动容器。
- `acceptMaibotAgreements` 默认关闭。确认接受 MaiBot 的 EULA 和隐私条款后再开启。
- `apiKey` 可以留空。插件会生成并复用运行期密钥。
- `dockerNetwork` 按你的 Koishi Docker 网络填写。Koishi 需要能通过 `apiHost` 访问 `maimai-ko`。
- `webuiPublicUrl` 可填写反代或宿主机映射后的 WebUI 地址，用于 Koishi 控制台显示入口。
- `groupMessageTriggerCount` 控制群聊累计多少条消息后批量转发并强制触发 maibot 思考。设为 `3` 时，同一群前两条先缓存，第 3 条会连同前两条一起转发。
- `directMessageTriggerCount` 控制私聊累计多少条消息后批量转发并强制触发 maibot 思考。默认 `1`，表示每条私信都会触发；设为 `3` 时，同一私聊前两条只缓存，第 3 条统一转发并触发回复。
- `commandResultMode` 控制聊天中执行 `mai.ko.*` 管理指令后的结果发送方式。`source` 发回原群聊/私聊，`admin` 发到管理员私聊，`silent` 不发送结果。
- `commandResultAdminUserId` 仅在 `commandResultMode: admin` 时使用。填写管理员 QQ 号；留空时发给指令调用者。

## 消息模式

```yaml
messageMode: coexist
```

可选值：

- `coexist`：消息转发给 maibot 后，继续交给其他 Koishi 插件处理。
- `exclusive`：消息转发给 maibot 后，不再交给后续插件。
- `command`：只有命中指定前缀时才转发。

## 常用命令

```text
mai.ko.status
mai.ko.prepare
mai.ko.docker.start
mai.ko.docker.stop
mai.ko.docker.restart
mai.ko.reconnect
```

## 开发

```bash
npm install
npm test -- --reporter dot
npm run build
```

发布 npm 前检查打包内容：

```bash
npm pack --dry-run
```

## 许可证

GPL-3.0-or-later
