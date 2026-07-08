import { strict as assert } from 'assert'
import { h } from 'koishi'
import { getFallbackRouteHints, maimMessageToFragment } from '../src/bridge/convert'

const { sessionToMaimMessage } = require('../src/bridge/convert') as any
const { RouteRegistry } = require('../src/bridge/routes') as any

describe('mai.ko convert', () => {
  it('converts maim text segment to koishi fragment', () => {
    const fragment = maimMessageToFragment({
      message_info: {
        platform: 'koishi',
        message_id: '1',
        time: 1,
      },
      message_segment: {
        type: 'text',
        data: 'hello',
      },
      message_dim: {
        api_key: 'key',
        platform: 'koishi',
      },
    })
    assert.equal(fragment, 'hello')
  })

  it('converts image segment to koishi img element', () => {
    const fragment = maimMessageToFragment({
      message_info: {
        platform: 'koishi',
        message_id: '1',
        time: 1,
      },
      message_segment: {
        type: 'image',
        data: 'https://example.com/a.png',
      },
      message_dim: {
        api_key: 'key',
        platform: 'koishi',
      },
    })
    assert.deepEqual(fragment, h('img', { src: 'https://example.com/a.png' }))
  })

  it('drops maim reply segments instead of rendering them as text', () => {
    const fragment = maimMessageToFragment({
      message_info: {
        platform: 'koishi',
        message_id: '1',
        time: 1,
      },
      message_segment: {
        type: 'seglist',
        data: [
          {
            type: 'reply',
            data: '897510321',
          },
          {
            type: 'text',
            data: '你好啊',
          },
        ],
      },
      message_dim: {
        api_key: 'key',
        platform: 'koishi',
      },
    })

    assert.deepEqual(fragment, ['你好啊'])
  })

  it('fills maim-required top-level user and group info for group sessions', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'msg-1',
      timestamp: 1000,
      content: 'hello',
      author: {},
      event: {},
      isDirect: false,
    }
    const route = {
      routeId: 'route-1',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: '248727194',
      guildId: '248727194',
      userId: '10001',
      isDirect: false,
      updatedAt: 1,
    }

    const message = await (sessionToMaimMessage as any)(session, route, 'key')

    assert.equal(message.message_info.user_info?.user_id, '10001')
    assert.equal(message.message_info.additional_config.platform_io_account_id, '3876469841')
    assert.equal(message.message_info.user_info?.user_nickname, '10001')
    assert.equal(message.message_info.group_info?.group_id, '248727194')
    assert.equal(message.message_info.group_info?.group_name, '248727194')
    assert.equal(message.message_info.sender_info?.user_info?.user_nickname, '10001')
  })

  it('downloads inbound image urls as base64 image segments', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-2',
      timestamp: 1000,
      content: '<img src="https://example.com/a.png"/>',
      elements: [h('img', { src: 'https://example.com/a.png' })],
      author: {},
      event: {},
      isDirect: false,
    }
    const route = {
      routeId: 'route-1',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: '248727194',
      userId: '10001',
      isDirect: false,
      updatedAt: 1,
    }

    const resolveImage = async () => Buffer.from('hello').toString('base64')
    const message = await (sessionToMaimMessage as any)(session, route, 'key', { resolveImage })

    assert.deepEqual(message.message_segment, {
      type: 'image',
      data: 'aGVsbG8=',
    })
  })

  it('downgrades inbound image urls to text when download fails', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-2',
      timestamp: 1000,
      content: '<img src="https://example.com/a.png"/>',
      elements: [h('img', { src: 'https://example.com/a.png' })],
      author: {},
      event: {},
      isDirect: false,
    }
    const route = {
      routeId: 'route-1',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: '248727194',
      userId: '10001',
      isDirect: false,
      updatedAt: 1,
    }

    const message = await (sessionToMaimMessage as any)(session, route, 'key', {
      resolveImage: async () => undefined,
    })

    assert.deepEqual(message.message_segment, {
      type: 'text',
      data: '[图片: https://example.com/a.png]',
    })
  })

  it('keeps inbound data-url images as base64 image segments', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-3',
      timestamp: 1000,
      content: '<img src="data:image/png;base64,aGVsbG8="/>',
      elements: [h('img', { src: 'data:image/png;base64,aGVsbG8=' })],
      author: {},
      event: {},
      isDirect: false,
    }
    const route = {
      routeId: 'route-1',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: '248727194',
      userId: '10001',
      isDirect: false,
      updatedAt: 1,
    }

    const message = await (sessionToMaimMessage as any)(session, route, 'key')

    assert.deepEqual(message.message_segment, {
      type: 'image',
      data: 'aGVsbG8=',
    })
  })

  it('prepends reply context to inbound messages', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-4',
      timestamp: 1000,
      content: '这是饼干',
      elements: h.parse('这是饼干'),
      author: {},
      event: {},
      isDirect: false,
    }
    const route = {
      routeId: 'route-1',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: '248727194',
      userId: '10001',
      isDirect: false,
      updatedAt: 1,
    }

    const message = await (sessionToMaimMessage as any)(session, route, 'key', {
      replyContext: {
        targetMessageId: 'bot-msg-1',
        targetMessageContent: '[被回复消息]\n这个是什么\n\n[最近 5 条上下文]\n1. mai.ko: 这个是什么 <- 被回复',
        targetMessageSenderId: '3876469841',
        targetMessageSenderNickname: 'mai.ko',
        contextCount: 5,
      },
    })

    assert.equal(message.message_info.additional_config.koishi_reply_to_message_id, 'bot-msg-1')
    assert.equal(message.message_info.additional_config.koishi_reply_context_count, 5)
    assert.deepEqual(message.message_segment, {
      type: 'seglist',
      data: [
        {
          type: 'reply',
          data: {
            target_message_id: 'bot-msg-1',
            target_message_content: '[被回复消息]\n这个是什么\n\n[最近 5 条上下文]\n1. mai.ko: 这个是什么 <- 被回复',
            target_message_sender_id: '3876469841',
            target_message_sender_nickname: 'mai.ko',
            koishi_context_count: 5,
          },
        },
        {
          type: 'text',
          data: '这是饼干',
        },
      ],
    })
  })

  it('extracts private route hints from maimai platform io target user', () => {
    const hints = getFallbackRouteHints({
      message_info: {
        platform: 'koishi',
        message_id: 'send-api-1',
        time: 1,
        user_info: {
          platform: 'koishi',
          user_id: '3876469841',
        },
        additional_config: {
          platform_io_target_user_id: '1970871278',
        },
      },
      message_segment: {
        type: 'text',
        data: 'hello',
      },
      message_dim: {
        api_key: 'key',
        platform: 'koishi',
      },
    })

    assert.equal(hints.userId, '1970871278')
    assert.equal(hints.isDirect, true)
  })

  it('falls back to the latest direct route', () => {
    const registry = new RouteRegistry(60000)
    const groupSession: any = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      isDirect: false,
    }
    const directSession: any = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '1970871278',
      channelId: 'private:1970871278',
      isDirect: true,
    }

    ;(registry as any).remember(groupSession)
    const directRoute = (registry as any).remember(directSession)

    assert.equal(registry.latest({ isDirect: true })?.routeId, directRoute.routeId)
  })
})
