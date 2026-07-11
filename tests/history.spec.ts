import { strict as assert } from 'assert'
import { h } from 'koishi'

const { MessageHistory } = require('../src/bridge/history') as any

function route(overrides: Record<string, any> = {}) {
  return {
    routeId: 'koishi:onebot:3876469841:248727194:248727194:10001',
    session: {},
    botSelfId: '3876469841',
    platform: 'onebot',
    channelId: '248727194',
    guildId: '248727194',
    userId: '10001',
    isDirect: false,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('mai.ko message history', () => {
  it('builds reply context from recent group messages', () => {
    const history = new MessageHistory(60000)
    const groupRoute = route()
    history.rememberMaimMessage(groupRoute, {
      message_info: {
        platform: 'koishi',
        message_id: 'maim-1',
        time: 1,
        sender_info: {
          user_info: {
            platform: 'koishi',
            user_id: '3876469841',
            user_nickname: 'mai.ko',
          },
        },
      },
      message_segment: { type: 'text', data: '这个是什么' },
      message_dim: { api_key: 'key', platform: 'koishi' },
    }, 'bot-msg-1', '这个是什么')

    for (let index = 0; index < 4; index += 1) {
      const userId = `1000${index}`
      history.rememberSession({
        platform: 'onebot',
        selfId: '3876469841',
        userId,
        channelId: '248727194',
        guildId: '248727194',
        messageId: `user-msg-${index}`,
        timestamp: Date.now(),
        username: `用户${index}`,
        content: `补充${index}`,
        elements: h.parse(`补充${index}`),
        author: {},
        event: {},
        isDirect: false,
      }, route({ userId }))
    }

    const context = history.resolveReplyContext({
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'user-reply',
      timestamp: Date.now(),
      username: '用户A',
      content: '这是饼干',
      elements: h.parse('这是饼干'),
      quote: {
        id: 'bot-msg-1',
        messageId: 'bot-msg-1',
      },
      author: {},
      event: {},
      isDirect: false,
    }, groupRoute)

    assert.equal(context.targetMessageId, 'bot-msg-1')
    assert.equal(context.contextCount, 5)
    assert.match(context.targetMessageContent, /发送者: mai\.ko\(3876469841\)/)
    assert.match(context.targetMessageContent, /mai\.ko\(3876469841\): 这个是什么 <- 被回复/)
    assert.match(context.targetMessageContent, /补充3/)
    assert.equal(context.targetMessageSenderId, '3876469841')
  })

  it('keeps quoted sender and image sources in reply context', () => {
    const history = new MessageHistory(60000)
    const groupRoute = route({ userId: '20002' })
    history.rememberSession({
      platform: 'onebot',
      selfId: '3876469841',
      userId: '20002',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'image-msg-1',
      timestamp: Date.now(),
      username: '用户B',
      content: '<img src="https://example.com/cat.png"/>',
      elements: [h('img', { src: 'https://example.com/cat.png' })],
      author: {
        name: '用户B',
        nick: 'B卡片',
      },
      event: {},
      isDirect: false,
    }, groupRoute)

    const context = history.resolveReplyContext({
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'reply-image-msg',
      timestamp: Date.now(),
      username: '用户A',
      content: '这是什么',
      elements: h.parse('这是什么'),
      quote: {
        id: 'image-msg-1',
        messageId: 'image-msg-1',
      },
      author: {},
      event: {},
      isDirect: false,
    }, groupRoute)

    assert.equal(context.targetMessageSenderId, '20002')
    assert.equal(context.targetMessageSenderNickname, 'B卡片')
    assert.match(context.targetMessageContent, /发送者: B卡片\(20002\)/)
    assert.deepEqual(context.targetMessageImageSources, ['https://example.com/cat.png'])
  })

  it('extracts reply target id from raw OneBot reply segments', () => {
    const history = new MessageHistory(60000)
    const groupRoute = route()
    history.rememberSession({
      platform: 'onebot',
      selfId: '3876469841',
      userId: '20002',
      channelId: '248727194',
      guildId: '248727194',
      messageId: '123456',
      timestamp: Date.now(),
      username: '用户B',
      content: '这是被回复的消息',
      elements: h.parse('这是被回复的消息'),
      author: {
        name: '用户B',
      },
      event: {},
      isDirect: false,
    }, route({ userId: '20002' }))

    const replySession = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'reply-raw-onebot',
      timestamp: Date.now(),
      username: '用户A',
      content: '我回复一下',
      elements: h.parse('我回复一下'),
      onebot: {
        message: [
          {
            type: 'reply',
            data: {
              id: '123456',
            },
          },
          {
            type: 'text',
            data: {
              text: '我回复一下',
            },
          },
        ],
      },
      author: {},
      event: {},
      isDirect: false,
    }

    const context = history.resolveReplyContext(replySession, groupRoute)

    assert.equal(context.targetMessageId, '123456')
    assert.match(context.targetMessageContent, /内容: 这是被回复的消息/)
    assert.match(context.targetMessageContent, /用户B\(20002\): 这是被回复的消息 <- 被回复/)
  })

  it('builds quoted content from loaded OneBot messages', () => {
    const history = new MessageHistory(60000)
    const groupRoute = route()
    const replySession = {
      platform: 'onebot',
      selfId: '3876469841',
      userId: '10001',
      channelId: '248727194',
      guildId: '248727194',
      messageId: 'reply-loaded-onebot',
      timestamp: Date.now(),
      username: '用户A',
      content: '这张呢',
      elements: h.parse('这张呢'),
      onebot: {
        message: '[CQ:reply,id=654321]这张呢',
      },
      author: {},
      event: {},
      isDirect: false,
    }
    const loadedQuote = history.onebotMessageToQuote({
      message_id: 654321,
      sender: {
        user_id: 20002,
        nickname: '用户B',
        card: 'B卡片',
      },
      message: [
        {
          type: 'text',
          data: {
            text: '看图',
          },
        },
        {
          type: 'image',
          data: {
            url: 'https://example.com/quote.png',
          },
        },
      ],
    })

    const context = history.resolveReplyContext(replySession, groupRoute, loadedQuote)

    assert.equal(context.targetMessageId, '654321')
    assert.equal(context.targetMessageSenderId, '20002')
    assert.equal(context.targetMessageSenderNickname, 'B卡片')
    assert.match(context.targetMessageContent, /发送者: B卡片\(20002\)/)
    assert.match(context.targetMessageContent, /内容: 看图\[图片\]/)
    assert.deepEqual(context.targetMessageImageSources, ['https://example.com/quote.png'])
  })
})
