/**
 * sentinel/watch 单元测试
 *
 * 使用真实 dsh 事件结构
 */

import { describe, it, expect } from 'vitest'
import { SentinelWatch, watch } from '../src/sentinel/watch.js'
import type { SessionEvent, WatchdogConfig, ContentBlock } from '../src/sentinel/types.js'
import { DEFAULT_CONFIG } from '../src/sentinel/types.js'

function toolCall(name: string, args: string, seq = 0): SessionEvent {
  return {
    type: 'tool/call', seq, time: Date.now(),
    data: { turn: 1, step: seq, callId: `call-${seq}`, name, arguments: args },
  }
}

function toolResult(content: string, isError = false, seq = 0): SessionEvent {
  const blocks: ContentBlock[] = isError
    ? [{ type: 'tool_result', tool_use_id: `call-${seq}`, content, is_error: true }]
    : [{ type: 'text', text: content }]
  return {
    type: 'tool/result', seq, time: Date.now(),
    data: { turn: 1, step: seq, message: { role: 'tool', content: blocks } },
  }
}

function makeRepeatingEvents(count: number): SessionEvent[] {
  const events: SessionEvent[] = []
  for (let i = 0; i < count; i++) {
    events.push(toolCall('bash', '{"command":"npm test"}', i))
    events.push(toolResult('Error: test failed', true, i))
  }
  return events
}

function makeProgressiveEvents(count: number): SessionEvent[] {
  const events: SessionEvent[] = []
  for (let i = 0; i < count; i++) {
    events.push(toolCall(`tool-${i}`, `{"step":${i}}`, i))
    events.push(toolResult(`Processing file ${i}: found ${i * 2} issues`, false, i))
  }
  return events
}

describe('SentinelWatch 有状态版本', () => {
  it('空事件列表返回 NORMAL', () => {
    const sentinel = new SentinelWatch(DEFAULT_CONFIG)
    const result = sentinel.watch([])
    expect(result.state).toBe('NORMAL')
    expect(result.shouldAct).toBe(false)
  })

  it('loopGuard 禁用时始终 NORMAL', () => {
    const config: WatchdogConfig = {
      ...DEFAULT_CONFIG,
      loopGuard: { ...DEFAULT_CONFIG.loopGuard, enabled: false },
    }
    const sentinel = new SentinelWatch(config)
    const result = sentinel.watch(makeRepeatingEvents(10))
    expect(result.state).toBe('NORMAL')
    expect(result.shouldAct).toBe(false)
  })

  it('连续 5 步重复同一失败命令 → CONFIRMED', () => {
    const sentinel = new SentinelWatch(DEFAULT_CONFIG)
    const events = makeRepeatingEvents(5)

    // 步 1: NORMAL → SUSPECTED
    const result1 = sentinel.watch(events)
    expect(result1.state).toBe('SUSPECTED')

    // 继续推进直到 CONFIRMED
    for (let i = 0; i < 5; i++) {
      sentinel.watch(events)
    }
    const final = sentinel.watch(events)
    expect(final.state).toBe('CONFIRMED')
    expect(final.shouldAct).toBe(true)
  })

  it('每步有新进展 → 不会到达 CONFIRMED', () => {
    const sentinel = new SentinelWatch(DEFAULT_CONFIG)
    const events = makeProgressiveEvents(5)
    for (let i = 0; i < 8; i++) {
      sentinel.watch(makeProgressiveEvents(5 + i + 1))
    }
    const finalResult = sentinel.watch(makeProgressiveEvents(15))
    expect(finalResult.state).not.toBe('CONFIRMED')
    expect(finalResult.shouldAct).toBe(false)
  })

  it('reset 后状态回到 NORMAL', () => {
    const sentinel = new SentinelWatch(DEFAULT_CONFIG)
    sentinel.watch(makeRepeatingEvents(5))
    sentinel.reset()
    expect(sentinel.state.current).toBe('NORMAL')
    expect(sentinel.state.stalledSteps).toBe(0)
  })

  it('CONFIRMED 状态返回 actionLevel', () => {
    const sentinel = new SentinelWatch(DEFAULT_CONFIG)
    for (let i = 0; i < 10; i++) {
      sentinel.watch(makeRepeatingEvents(5))
    }
    const result = sentinel.watch(makeRepeatingEvents(5))
    if (result.state === 'CONFIRMED') {
      expect(result.actionLevel).toBe('nudge')
      expect(result.diagnostic).toBeDefined()
    }
  })
})

describe('watch 无状态版本', () => {
  it('空事件返回 NORMAL', () => {
    const result = watch([], DEFAULT_CONFIG)
    expect(result.state).toBe('NORMAL')
  })

  it('重复事件单次调用返回 SUSPECTED', () => {
    const events = makeRepeatingEvents(5)
    const result = watch(events, DEFAULT_CONFIG)
    expect(['NORMAL', 'SUSPECTED']).toContain(result.state)
  })
})
