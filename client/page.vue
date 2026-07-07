<template>
  <k-layout>
    <k-card>
      <template #header>
        <span>mai.ko 托管状态</span>
      </template>
      <p>进程：{{ status?.process.state || 'unknown' }}</p>
      <p>准备：{{ status?.prepare.state || 'unknown' }} / {{ status?.prepare.root || '-' }}</p>
      <p>Docker：{{ status?.docker.state || 'unknown' }} / {{ status?.docker.containerName || '-' }}</p>
      <p>Bridge：{{ status?.transport.state || 'unknown' }}</p>
      <p v-if="status?.bridge">中转：Koishi 收 {{ status.bridge.koishiReceived }} / 发往 mai.ko {{ status.bridge.maimSent }} / 收到 mai.ko {{ status.bridge.maimReceived }} / 回发 Koishi {{ status.bridge.koishiSent }}</p>
      <p v-if="status?.bridge">中转异常：路由失败 {{ status.bridge.routeMissed }} / 发送失败 {{ status.bridge.sendFailed }}</p>
      <p>WebUI：{{ webuiText }}</p>
      <p v-if="status?.webui.token?.value">WebUI Token：<code>{{ status.webui.token.value }}</code></p>
      <p v-else-if="status?.webui.token?.lastError">WebUI Token：{{ status.webui.token.lastError }}</p>
      <p>PID：{{ status?.process.pid || '-' }}</p>
      <p v-if="status?.process.blockedReason">阻塞原因：{{ status.process.blockedReason }}</p>
      <p v-if="status?.prepare.blockedReason">准备阻塞：{{ status.prepare.blockedReason }}</p>
      <p v-if="status?.prepare.lastError">准备错误：{{ status.prepare.lastError }}</p>
      <p v-if="status?.docker.lastError">Docker 错误：{{ status.docker.lastError }}</p>
      <p v-if="status?.transport.lastError">Bridge 错误：{{ status.transport.lastError }}</p>
      <p v-if="status?.bridge?.lastError">中转错误：{{ status.bridge.lastError }}</p>
      <k-button @click="refresh">刷新</k-button>
      <k-button @click="start">启动</k-button>
      <k-button @click="stop">停止</k-button>
      <k-button @click="restart">重启</k-button>
      <k-button @click="reconnect">重连</k-button>
      <k-button @click="prepare">准备</k-button>
      <k-button @click="dockerStart">Docker 启动</k-button>
      <k-button @click="dockerStop">Docker 停止</k-button>
      <k-button @click="dockerRestart">Docker 重启</k-button>
      <k-button v-if="status?.webui.enabled && status?.webui.url" @click="openWebui">打开 WebUI</k-button>
      <p v-if="status?.logsHint">{{ status.logsHint }}</p>
      <pre v-if="status?.logs.length">{{ status.logs.slice(-20).join('\n') }}</pre>
    </k-card>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { send } from '@koishijs/client'

interface RuntimeStatus {
  prepare: {
    state: string
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
    state: string
    containerName: string
    imageName: string
    lastError?: string
    updatedAt?: number
  }
  process: {
    state: string
    pid?: number
    blockedReason?: string
  }
  transport: {
    state: string
    lastError?: string
  }
  bridge: {
    koishiReceived: number
    maimSent: number
    maimReceived: number
    koishiSent: number
    routeMissed: number
    sendFailed: number
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

const status = ref<RuntimeStatus>()
const webuiText = computed(() => {
  if (!status.value) return 'unknown'
  if (!status.value.webui.enabled) return 'disabled'
  return status.value.webui.url || `${status.value.webui.host}:${status.value.webui.port}`
})

async function refresh() {
  status.value = await send('mai-ko/status')
}

async function start() {
  status.value = await send('mai-ko/start')
}

async function stop() {
  status.value = await send('mai-ko/stop')
}

async function restart() {
  status.value = await send('mai-ko/restart')
}

async function reconnect() {
  status.value = await send('mai-ko/reconnect')
}

async function prepare() {
  status.value = await send('mai-ko/prepare')
}

async function dockerStart() {
  status.value = await send('mai-ko/docker-start')
}

async function dockerStop() {
  status.value = await send('mai-ko/docker-stop')
}

async function dockerRestart() {
  status.value = await send('mai-ko/docker-restart')
}

function openWebui() {
  if (!status.value?.webui.url) return
  window.open(status.value.webui.url, '_blank', 'noopener,noreferrer')
}

onMounted(refresh)
</script>
