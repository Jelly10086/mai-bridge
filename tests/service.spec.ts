// @ts-nocheck
import { strict as assert } from 'assert'

const { MaibotService, markKoishiCommandSession } = require('../src/service') as any
const { MessageHistory } = require('../src/bridge/history') as any

function session(content: string) {
  return {
    content,
    stripped: {
      content,
      prefix: undefined,
      hasAt: false,
      appel: false,
      atSelf: false,
    },
  }
}

function context(names: string[]) {
  return {
    $commander: {
      resolve: (name: string) => names.includes(name),
      resolveCommand: () => false,
    },
  }
}

describe('mai.ko service command passthrough', () => {
  it('marks bare koishi commands as appel sessions', () => {
    const currentSession = session('help')

    const matched = markKoishiCommandSession(context(['help']), currentSession)

    assert.equal(matched, true)
    assert.equal(currentSession.stripped.hasAt, true)
    assert.equal(currentSession.stripped.appel, true)
    assert.equal(currentSession.stripped.atSelf, true)
    assert.equal(currentSession.stripped.prefix, '')
  })

  it('recognizes koishi commands with common command prefixes', () => {
    const currentSession = session('/视频 猫')

    const matched = markKoishiCommandSession(context(['视频']), currentSession)

    assert.equal(matched, true)
    assert.equal(currentSession.stripped.atSelf, true)
  })

  it('does not mark normal chat messages', () => {
    const currentSession = session('普通聊天')

    const matched = markKoishiCommandSession(context(['help']), currentSession)

    assert.equal(matched, false)
    assert.equal(currentSession.stripped.atSelf, false)
  })
})

describe('mai.ko service reply quote loading', () => {
  function serviceHarness() {
    const logs: string[] = []
    return {
      service: {
        history: new MessageHistory(60000),
        logMessageDetail: (message: string) => logs.push(message),
        log: {
          debug: (message: string) => logs.push(message),
        },
      },
      logs,
    }
  }

  it('loads quoted message through Koishi bot.getMessage for NapCat sessions', async () => {
    const { service, logs } = serviceHarness()
    const calls: any[] = []
    const session = {
      channelId: '248727194',
      bot: {
        async getMessage(channelId: string, messageId: string) {
          calls.push({ channelId, messageId })
          return {
            id: messageId,
            messageId,
            content: '被引用的原消息',
            user: {
              id: '20002',
              name: '用户B',
            },
          }
        },
      },
    }

    const quote = await MaibotService.prototype.loadReplyQuote.call(service, session, '123456')

    assert.equal(quote.content, '被引用的原消息')
    assert.deepEqual(calls, [{ channelId: '248727194', messageId: '123456' }])
    assert.match(logs.join('\n'), /source=bot\.getMessage/)
  })

  it('falls back to bot.internal.getMsg when Koishi quote is unavailable', async () => {
    const { service, logs } = serviceHarness()
    const session = {
      channelId: '248727194',
      bot: {
        internal: {
          async getMsg(messageId: string) {
            return {
              message_id: Number(messageId),
              sender: {
                user_id: 20002,
                nickname: '用户B',
                card: 'B卡片',
              },
              message: [
                {
                  type: 'text',
                  data: {
                    text: 'OneBot 原消息',
                  },
                },
              ],
            }
          },
        },
      },
    }

    const quote = await MaibotService.prototype.loadReplyQuote.call(service, session, '654321')

    assert.equal(quote.content, 'OneBot 原消息')
    assert.equal(quote.sender.user_id, '20002')
    assert.match(logs.join('\n'), /source=onebot\.getMsg/)
  })
})
