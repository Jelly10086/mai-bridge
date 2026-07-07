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
    assert.match(context.targetMessageContent, /这个是什么 <- 被回复/)
    assert.match(context.targetMessageContent, /补充3/)
    assert.equal(context.targetMessageSenderId, '3876469841')
  })
})
