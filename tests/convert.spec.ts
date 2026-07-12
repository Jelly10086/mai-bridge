import { strict as assert } from 'assert'
import { h } from 'koishi'
import { getFallbackRouteHints, maimMessageToFragment } from '../src/bridge/convert'

const { isMentioningBot, sessionToMaimMessage, shouldForwardSession } = require('../src/bridge/convert') as any
const { RouteRegistry } = require('../src/bridge/routes') as any

function forwardConfig(overrides: Record<string, any> = {}) {
  return {
    messageMode: 'coexist',
    commandPrefix: 'mai.ko',
    groupAutoReplyMode: 'all',
    groupAutoReplyChannelIds: [],
    ...overrides,
  } as any
}

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

  it('converts maim reply segments to koishi quote elements', () => {
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

    assert.deepEqual(fragment, [
      h('quote', { id: '897510321' }),
      '你好啊',
    ])
  })

  it('keeps maim quote segments before text even when maibot appends reply later', () => {
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
            type: 'text',
            data: '收到，',
          },
          {
            type: 'reply',
            data: {
              target_message_id: '897510321',
              target_message_content: '这个是什么',
            },
          },
          {
            type: 'text',
            data: '这是饼干',
          },
        ],
      },
      message_dim: {
        api_key: 'key',
        platform: 'koishi',
      },
    })

    assert.deepEqual(fragment, [
      h('quote', { id: '897510321' }),
      '收到，',
      '这是饼干',
    ])
  })

  it('converts maim at segments to koishi at elements', () => {
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
            type: 'text',
            data: '你好 ',
          },
          {
            type: 'at',
            data: {
              target_user_id: '20002',
              target_user_nickname: 'Soyo',
            },
          },
        ],
      },
      message_dim: {
        api_key: 'key',
        platform: 'koishi',
      },
    })

    assert.deepEqual(fragment, [
      '你好 ',
      h('at', { id: '20002', name: 'Soyo' }),
    ])
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

  it('marks a group-triggered message as mentioned without changing its text', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'msg-force',
      timestamp: 1000,
      content: '第六条',
      elements: h.parse('第六条'),
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

    const message = await (sessionToMaimMessage as any)(session, route, 'key', {
      forceMention: true,
    })

    assert.equal(message.message_info.additional_config.at_bot, true)
    assert.equal(message.message_info.additional_config.is_mentioned, true)
    assert.equal(message.message_info.additional_config.koishi_group_trigger_forced, true)
    assert.deepEqual(message.message_segment, {
      type: 'text',
      data: '第六条',
    })
  })

  it('marks a replied bot message as a bot mention', () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      content: '这个呢',
      elements: h.parse('这个呢'),
      quote: {
        user: {
          id: '3876469841',
        },
      },
      isDirect: false,
    } as any

    assert.equal(isMentioningBot(session as any), true)
  })

  it('forwards group mentions even outside the auto-reply allowlist', () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      content: '醒醒',
      elements: h.parse('醒醒'),
      stripped: {
        atSelf: true,
      },
      isDirect: false,
    } as any

    assert.equal(shouldForwardSession(session as any, forwardConfig({
      groupAutoReplyMode: 'allowlist',
      groupAutoReplyChannelIds: ['10000'],
    })), true)
  })

  it('skips normal messages outside the group auto-reply allowlist', () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      content: '普通群消息',
      elements: h.parse('普通群消息'),
      isDirect: false,
    } as any

    assert.equal(shouldForwardSession(session as any, forwardConfig({
      groupAutoReplyMode: 'allowlist',
      groupAutoReplyChannelIds: ['10000'],
    })), false)
  })

  it('forwards normal messages inside the group auto-reply allowlist', () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      content: '普通群消息',
      elements: h.parse('普通群消息'),
      isDirect: false,
    } as any

    assert.equal(shouldForwardSession(session as any, forwardConfig({
      groupAutoReplyMode: 'allowlist',
      groupAutoReplyChannelIds: ['248727194'],
    })), true)
  })

  it('skips normal group messages in mention-only mode', () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      content: '普通群消息',
      elements: h.parse('普通群消息'),
      isDirect: false,
    } as any

    assert.equal(shouldForwardSession(session as any, forwardConfig({
      groupAutoReplyMode: 'mention-only',
    })), false)
  })

  it('marks forced direct messages as mentioned without changing their text', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: 'private:10001',
      messageId: 'msg-direct',
      timestamp: 1000,
      content: '你好',
      elements: h.parse('你好'),
      author: {},
      event: {},
      isDirect: true,
    }
    const route = {
      routeId: 'route-direct',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: 'private:10001',
      userId: '10001',
      isDirect: true,
      updatedAt: 1,
    }

    const message = await (sessionToMaimMessage as any)(session, route, 'key', {
      forceMention: true,
    })

    assert.equal(message.message_info.additional_config.at_bot, true)
    assert.equal(message.message_info.additional_config.is_mentioned, true)
    assert.equal(message.message_info.additional_config.koishi_is_direct, true)
    assert.equal(message.message_info.additional_config.koishi_group_trigger_forced, false)
    assert.equal(message.message_info.additional_config.koishi_direct_trigger_forced, true)
    assert.deepEqual(message.message_segment, {
      type: 'text',
      data: '你好',
    })
  })

  it('keeps unforced direct messages as context-only messages', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: 'private:10001',
      messageId: 'msg-direct-context',
      timestamp: 1000,
      content: '前文',
      elements: h.parse('前文'),
      author: {},
      event: {},
      isDirect: true,
    }
    const route = {
      routeId: 'route-direct',
      session,
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: 'private:10001',
      userId: '10001',
      isDirect: true,
      updatedAt: 1,
    }

    const message = await (sessionToMaimMessage as any)(session, route, 'key')

    assert.equal(message.message_info.additional_config.at_bot, false)
    assert.equal(message.message_info.additional_config.is_mentioned, false)
    assert.equal(message.message_info.additional_config.koishi_is_direct, true)
    assert.equal(message.message_info.additional_config.koishi_direct_trigger_forced, false)
    assert.deepEqual(message.message_segment, {
      type: 'text',
      data: '前文',
    })
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

  it('downloads inbound mface urls as base64 emoji segments', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-mface',
      timestamp: 1000,
      content: '<mface url="https://example.com/e.webp"/>',
      elements: [h('mface', { url: 'https://example.com/e.webp' })],
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

    const resolveImage = async () => Buffer.from('emoji').toString('base64')
    const message = await (sessionToMaimMessage as any)(session, route, 'key', { resolveImage })

    assert.deepEqual(message.message_segment, {
      type: 'emoji',
      data: 'ZW1vamk=',
    })
    assert.deepEqual(message.message_info.format_info?.content_format, ['text', 'image', 'emoji'])
    assert.deepEqual(message.message_info.format_info?.accept_format, ['text', 'image', 'emoji'])
  })

  it('treats image elements with sticker hints as emoji segments', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-sticker',
      timestamp: 1000,
      content: '<img subType="sticker" src="base64://aGVsbG8="/>',
      elements: [h('img', { subType: 'sticker', src: 'base64://aGVsbG8=' })],
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
      type: 'emoji',
      data: 'aGVsbG8=',
    })
  })

  it('treats NapCat image summary emoji hints as emoji segments', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-napcat-summary',
      timestamp: 1000,
      content: '<img summary="[动画表情]" src="base64://aGVsbG8="/>',
      elements: [h('img', { summary: '[动画表情]', src: 'base64://aGVsbG8=' })],
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
      type: 'emoji',
      data: 'aGVsbG8=',
    })
  })

  it('uses the child image source of face elements as emoji data', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-face-child',
      timestamp: 1000,
      content: '<face id="14"><img src="https://example.com/face.png"/></face>',
      elements: [h('face', { id: '14', name: '微笑' }, h('img', { src: 'https://example.com/face.png' }))],
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
      resolveImage: async () => Buffer.from('face').toString('base64'),
    })

    assert.deepEqual(message.message_segment, {
      type: 'emoji',
      data: 'ZmFjZQ==',
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
        targetMessageContent: '[当前消息正在回复的目标]\n这个是什么\n[引用目标结束]\n\n[最近 5 条上下文，仅供参考，不是当前被回复目标]\n1. mai.ko: 这个是什么 <- 被回复',
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
            target_message_content: '[当前消息正在回复的目标]\n这个是什么\n[引用目标结束]\n\n[最近 5 条上下文，仅供参考，不是当前被回复目标]\n1. mai.ko: 这个是什么 <- 被回复',
            target_message_sender_id: '3876469841',
            target_message_sender_nickname: 'mai.ko',
            koishi_context_count: 5,
          },
        },
        {
          type: 'text',
          data: '[当前消息正在回复的目标]\n这个是什么\n[引用目标结束]\n\n[最近 5 条上下文，仅供参考，不是当前被回复目标]\n1. mai.ko: 这个是什么 <- 被回复\n\n[判断“这是什么/他说了什么/他发了什么”时，只以“当前消息正在回复的目标”为准。]\n[当前消息]\n',
        },
        {
          type: 'text',
          data: '这是饼干',
        },
      ],
    })
  })

  it('adds quoted images from reply context as maim image segments', async () => {
    const session = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      messageId: 'msg-reply-image',
      timestamp: 1000,
      content: '这是什么',
      elements: h.parse('这是什么'),
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
      resolveImage: async () => Buffer.from('cat').toString('base64'),
      replyContext: {
        targetMessageId: 'image-msg-1',
        targetMessageContent: '[当前消息正在回复的目标]\n发送者: 用户B(20002)\n内容: [图片]\n[引用目标结束]',
        targetMessageSenderId: '20002',
        targetMessageSenderNickname: '用户B',
        targetMessageImageSources: ['https://example.com/cat.png'],
        contextCount: 1,
      },
    })

    assert.deepEqual(message.message_segment, {
      type: 'seglist',
      data: [
        {
          type: 'reply',
          data: {
            target_message_id: 'image-msg-1',
            target_message_content: '[当前消息正在回复的目标]\n发送者: 用户B(20002)\n内容: [图片]\n[引用目标结束]',
            target_message_sender_id: '20002',
            target_message_sender_nickname: '用户B',
            koishi_context_count: 1,
          },
        },
        {
          type: 'image',
          data: 'Y2F0',
        },
        {
          type: 'text',
          data: '[当前消息正在回复的目标]\n发送者: 用户B(20002)\n内容: [图片]\n[引用目标结束]\n\n[判断“这是什么/他说了什么/他发了什么”时，只以“当前消息正在回复的目标”为准。]\n[当前消息]\n',
        },
        {
          type: 'text',
          data: '这是什么',
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
