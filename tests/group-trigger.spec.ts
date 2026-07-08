import { strict as assert } from 'assert'

const { GroupMessageTrigger } = require('../src/bridge/group-trigger') as any

function session(overrides: Record<string, any> = {}) {
  return {
    platform: 'onebot',
    selfId: '3876469841',
    channelId: '248727194',
    guildId: '248727194',
    userId: '10001',
    isDirect: false,
    ...overrides,
  }
}

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

describe('mai.ko group message trigger', () => {
  it('forwards only when a group reaches the configured message count', () => {
    const trigger = new GroupMessageTrigger(3)
    const groupSession = session()
    const groupRoute = route()

    assert.deepEqual(trigger.test(groupSession, groupRoute), {
      shouldForward: false,
      count: 1,
      threshold: 3,
      key: 'onebot:3876469841:248727194:248727194',
    })
    assert.equal(trigger.test(groupSession, groupRoute).shouldForward, false)
    assert.deepEqual(trigger.test(groupSession, groupRoute), {
      shouldForward: true,
      count: 3,
      threshold: 3,
      key: 'onebot:3876469841:248727194:248727194',
    })
    assert.equal(trigger.test(groupSession, groupRoute).count, 1)
  })

  it('does not gate direct messages', () => {
    const trigger = new GroupMessageTrigger(3)
    const result = trigger.test(session({ isDirect: true, channelId: '' }), route({
      isDirect: true,
      channelId: '',
      guildId: '',
    }))

    assert.deepEqual(result, {
      shouldForward: true,
      count: 1,
      threshold: 3,
    })
  })

  it('keeps counters isolated between groups', () => {
    const trigger = new GroupMessageTrigger(2)
    const firstGroup = route({ channelId: 'group-a', guildId: 'guild-a' })
    const secondGroup = route({ channelId: 'group-b', guildId: 'guild-b' })

    assert.equal(trigger.test(session({ channelId: 'group-a', guildId: 'guild-a' }), firstGroup).shouldForward, false)
    assert.equal(trigger.test(session({ channelId: 'group-b', guildId: 'guild-b' }), secondGroup).shouldForward, false)
    assert.equal(trigger.test(session({ channelId: 'group-a', guildId: 'guild-a' }), firstGroup).shouldForward, true)
    assert.equal(trigger.test(session({ channelId: 'group-b', guildId: 'guild-b' }), secondGroup).shouldForward, true)
  })
})
