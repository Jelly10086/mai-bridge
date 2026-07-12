// @ts-nocheck
import { strict as assert } from 'assert'
import { Argv, h } from 'koishi'

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

function context(names: string[], options: { requireAt?: boolean } = {}) {
  return {
    bail: (_event: string, content: string) => Argv.parse(content),
    $commander: {
      resolveCommand: (argv: any) => {
        const name = argv.tokens?.[0]?.content
        if (!names.includes(name)) return
        if (options.requireAt && !argv.session.stripped.atSelf) return
        argv.command = { name }
        return argv.command
      },
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

  it('recognizes commands that require bot mention', () => {
    const currentSession = {
      ...session('<at id="3876469841"/> 猜 24点'),
      selfId: '3876469841',
      elements: [
        h('at', { id: '3876469841' }),
        h('text', { content: ' 猜 24点' }),
      ],
    }

    const matched = markKoishiCommandSession(context(['猜'], { requireAt: true }), currentSession)

    assert.equal(matched, true)
    assert.equal(currentSession.stripped.hasAt, true)
    assert.equal(currentSession.stripped.appel, true)
    assert.equal(currentSession.stripped.atSelf, true)
  })

  it('does not mark normal chat messages', () => {
    const currentSession = session('普通聊天')

    const matched = markKoishiCommandSession(context(['help']), currentSession)

    assert.equal(matched, false)
    assert.equal(currentSession.stripped.atSelf, false)
  })

  it('does not block mentioned normal chat messages', () => {
    const currentSession = {
      ...session('<at id="3876469841"/> 你好'),
      selfId: '3876469841',
      elements: [
        h('at', { id: '3876469841' }),
        h('text', { content: ' 你好' }),
      ],
    }

    const matched = markKoishiCommandSession(context(['猜']), currentSession)

    assert.equal(matched, false)
    assert.equal(currentSession.stripped.appel, false)
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

  it('drops stale quote elements before sending to Koishi', () => {
    const history = new MessageHistory(60000)
    const currentRoute = {
      routeId: 'koishi:onebot:3876469841::private:1970871278:1970871278',
      session: {},
      botSelfId: '3876469841',
      platform: 'onebot',
      channelId: 'private:1970871278',
      userId: '1970871278',
      isDirect: true,
      updatedAt: Date.now(),
    }
    const service = Object.assign(Object.create(MaibotService.prototype), {
      history,
      log: {
        debug: () => {},
      },
    })

    const fragment = MaibotService.prototype.sanitizeReplyQuotes.call(service, [
      h('quote', { id: 'missing-message' }),
      '还在躺着呢',
    ], currentRoute)

    assert.deepEqual(fragment, ['还在躺着呢'])
  })
})
