// @ts-nocheck
import { strict as assert } from 'assert'

const { sendCommandResult } = require('../src/commands') as any

function config(overrides: Record<string, unknown> = {}) {
  return {
    commandResultMode: 'source',
    commandResultAdminUserId: '',
    commandResultAdminGuildId: '',
    commandResultNotifySource: false,
    ...overrides,
  }
}

function session(overrides: Record<string, unknown> = {}) {
  const sent: Array<[string, string, string | undefined, unknown]> = []
  const sourceSent: string[] = []
  return {
    userId: '10001',
    isDirect: false,
    send: async (content: string) => {
      sourceSent.push(content)
      return ['source-message-id']
    },
    bot: {
      sendPrivateMessage: async (userId: string, content: string, guildId?: string, options?: unknown) => {
        sent.push([userId, content, guildId, options])
        return ['private-message-id']
      },
    },
    sent,
    sourceSent,
    ...overrides,
  }
}

describe('mai.ko commands', () => {
  it('returns command result to the source session by default', async () => {
    const result = await sendCommandResult(session(), config(), 'status text')

    assert.equal(result, 'status text')
  })

  it('sends command result to the configured admin user', async () => {
    const currentSession = session()
    const result = await sendCommandResult(currentSession, config({
      commandResultMode: 'admin',
      commandResultAdminUserId: '20002',
      commandResultAdminGuildId: '30003',
    }), 'status text')

    assert.equal(result, undefined)
    assert.deepEqual(currentSession.sent, [[
      '20002',
      'status text',
      '30003',
      undefined,
    ]])
  })

  it('sends admin result through the current direct session when it targets the caller', async () => {
    const currentSession = session({ isDirect: true })
    const result = await sendCommandResult(currentSession, config({
      commandResultMode: 'admin',
    }), 'status text')

    assert.equal(result, undefined)
    assert.deepEqual(currentSession.sourceSent, ['status text'])
    assert.deepEqual(currentSession.sent, [])
  })

  it('can notify the source session after sending to admin', async () => {
    const result = await sendCommandResult(session(), config({
      commandResultMode: 'admin',
      commandResultNotifySource: true,
    }), 'status text')

    assert.equal(result, 'mai.ko 指令结果已发送给管理员。')
  })

  it('does not send command result in silent mode', async () => {
    const currentSession = session()
    const result = await sendCommandResult(currentSession, config({
      commandResultMode: 'silent',
    }), 'status text')

    assert.equal(result, undefined)
    assert.deepEqual(currentSession.sent, [])
  })
})
