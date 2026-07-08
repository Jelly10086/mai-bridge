import { strict as assert } from 'assert'

const { DirectMessageTrigger, GroupMessageTrigger } = require('../src/bridge/group-trigger') as any

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
  it('flushes cached group messages when a group reaches the configured message count', () => {
    const trigger = new GroupMessageTrigger(3)
    const firstSession = session({ messageId: 'msg-1' })
    const secondSession = session({ messageId: 'msg-2' })
    const thirdSession = session({ messageId: 'msg-3' })
    const groupRoute = route()

    assert.deepEqual(trigger.test(firstSession, groupRoute), {
      shouldForward: false,
      count: 1,
      threshold: 3,
      key: 'onebot:3876469841:248727194:248727194',
      entries: [],
    })
    assert.equal(trigger.test(secondSession, groupRoute).shouldForward, false)
    const result = trigger.test(thirdSession, groupRoute)

    assert.equal(result.shouldForward, true)
    assert.equal(result.count, 3)
    assert.equal(result.threshold, 3)
    assert.equal(result.key, 'onebot:3876469841:248727194:248727194')
    assert.equal(result.forceMention, true)
    assert.deepEqual([
      result.entries[0].session.messageId,
      result.entries[1].session.messageId,
      result.entries[2].session.messageId,
    ], ['msg-1', 'msg-2', 'msg-3'])
    assert.deepEqual(trigger.test(session({ messageId: 'msg-4' }), groupRoute), {
      shouldForward: false,
      count: 1,
      threshold: 3,
      key: 'onebot:3876469841:248727194:248727194',
      entries: [],
    })
  })

  it('does not gate direct messages', () => {
    const trigger = new GroupMessageTrigger(3)
    const directSession = session({ isDirect: true, channelId: '' })
    const directRoute = route({
      isDirect: true,
      channelId: '',
      guildId: '',
    })
    const result = trigger.test(directSession, directRoute)

    assert.deepEqual(result, {
      shouldForward: true,
      count: 1,
      threshold: 3,
      entries: [{ session: directSession, route: directRoute }],
    })
  })

  it('flushes cached direct messages when a private chat reaches the configured message count', () => {
    const trigger = new DirectMessageTrigger(3)
    const firstSession = session({ isDirect: true, channelId: 'private:10001', guildId: '', messageId: 'dm-1' })
    const secondSession = session({ isDirect: true, channelId: 'private:10001', guildId: '', messageId: 'dm-2' })
    const thirdSession = session({ isDirect: true, channelId: 'private:10001', guildId: '', messageId: 'dm-3' })
    const directRoute = route({
      isDirect: true,
      channelId: 'private:10001',
      guildId: '',
      userId: '10001',
    })

    assert.equal(trigger.test(firstSession, directRoute).shouldForward, false)
    assert.equal(trigger.test(secondSession, directRoute).shouldForward, false)
    const result = trigger.test(thirdSession, directRoute)

    assert.equal(result.shouldForward, true)
    assert.equal(result.count, 3)
    assert.equal(result.threshold, 3)
    assert.equal(result.key, 'onebot:3876469841:10001')
    assert.equal(result.forceMention, true)
    assert.deepEqual([
      result.entries[0].session.messageId,
      result.entries[1].session.messageId,
      result.entries[2].session.messageId,
    ], ['dm-1', 'dm-2', 'dm-3'])
  })

  it('forwards direct messages immediately when direct trigger count is one', () => {
    const trigger = new DirectMessageTrigger(1)
    const directSession = session({ isDirect: true, channelId: 'private:10001', guildId: '', messageId: 'dm-1' })
    const directRoute = route({
      isDirect: true,
      channelId: 'private:10001',
      guildId: '',
      userId: '10001',
    })
    const result = trigger.test(directSession, directRoute)

    assert.equal(result.shouldForward, true)
    assert.equal(result.count, 1)
    assert.equal(result.threshold, 1)
    assert.equal(result.forceMention, true)
    assert.deepEqual(result.entries, [{ session: directSession, route: directRoute }])
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
