// @ts-nocheck
import { strict as assert } from 'assert'

const { markKoishiCommandSession } = require('../src/service') as any

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
