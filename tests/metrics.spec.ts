/**
 * sentinel/metrics 单元测试
 *
 * 覆盖：动作签名、信息增量、去重率、token斜率、computeMetrics 主函数
 * 使用真实 dsh 事件结构（ContentBlock[] + assistant/message usage）
 */

import { describe, it, expect } from 'vitest'
import { computeMetrics, actionSignature, computeInfoGain } from '../src/sentinel/metrics.js'
import type { SessionEvent, LoopGuardConfig, ContentBlock } from '../src/sentinel/types.js'

const defaultConfig: LoopGuardConfig = {
  enabled: true,
  windowK: 5,
  dedupSoft: 0.6,
  dedupHard: 0.9,
  infoGain: 0.2,
  stallSteps: 3,
}

/** 创建 tool/call 事件 */
function toolCall(name: string, args: string, seq = 0): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: Date.now(),
    data: { turn: 1, step: seq, callId: `call-${seq}`, name, arguments: args },
  }
}

/** 创建 tool/result 事件（真实 ContentBlock[] 结构） */
function toolResult(content: string, isError = false, seq = 0): SessionEvent {
  const blocks: ContentBlock[] = isError
    ? [{ type: 'tool_result', tool_use_id: `call-${seq}`, content, is_error: true }]
    : [{ type: 'text', text: content }]
  return {
    type: 'tool/result',
    seq,
    time: Date.now(),
    data: { turn: 1, step: seq, message: { role: 'tool', content: blocks } },
  }
}

/** 创建 assistant/message 事件（含 usage） */
function assistantMessage(inputTokens: number, outputTokens: number, seq = 0): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: Date.now(),
    data: {
      turn: 1,
      step: seq,
      message: {},
      usage: { inputTokens, outputTokens },
    },
  }
}

// ─── actionSignature 测试 ───

describe('actionSignature', () => {
  it('对 JSON 参数进行归一化', () => {
    // 绝对路径值（以 / 开头的整个字符串）被归一化为 <path>
    const sig1 = actionSignature('bash', '{"path":"/tmp/abc"}')
    const sig2 = actionSignature('bash', '{"path":"/tmp/def"}')
    expect(sig1).toBe(sig2)
  })

  it('数字被归一化为 <num>', () => {
    const sig1 = actionSignature('read', '{"offset":100}')
    const sig2 = actionSignature('read', '{"offset":200}')
    expect(sig1).toBe(sig2)
  })

  it('UUID 被归一化', () => {
    const sig1 = actionSignature('query', '{"id":"550e8400-e29b-41d4-a716-446655440000"}')
    const sig2 = actionSignature('query', '{"id":"6ba7b810-9dad-11d1-80b4-00c04fd430c8"}')
    expect(sig1).toBe(sig2)
  })

  it('不同工具名产生不同签名', () => {
    const sig1 = actionSignature('bash', '{"command":"ls"}')
    const sig2 = actionSignature('read', '{"command":"ls"}')
    expect(sig1).not.toBe(sig2)
  })

  it('非 JSON 参数用截断处理', () => {
    const sig = actionSignature('tool', 'plain text args')
    expect(sig).toContain('tool(')
  })

  it('路径归一化不误判含路径片段的命令（M6 修复）', () => {
    // "ls /tmp/abc" 不应以 / 开头，不应被归一化为 <path>
    const sig1 = actionSignature('bash', '{"command":"ls /tmp/abc"}')
    const sig2 = actionSignature('bash', '{"command":"cat /var/log/syslog"}')
    // 这两个命令不同，不应被归一化为同一个签名
    expect(sig1).not.toBe(sig2)
  })
})

// ─── computeInfoGain 测试 ───

describe('computeInfoGain', () => {
  it('空历史返回 1（全新）', () => {
    expect(computeInfoGain('hello world', [])).toBe(1)
  })

  it('完全重复内容返回 0', () => {
    const content = 'the quick brown fox jumps over the lazy dog'
    expect(computeInfoGain(content, [content])).toBe(0)
  })

  it('全新内容返回接近 1', () => {
    const gain = computeInfoGain('brand new unique content here', ['completely different old stuff'])
    expect(gain).toBeGreaterThan(0.5)
  })

  it('空内容返回 0', () => {
    expect(computeInfoGain('', ['some history'])).toBe(0)
    expect(computeInfoGain('   ', ['some history'])).toBe(0)
  })

  it('部分重叠返回中间值', () => {
    const gain = computeInfoGain(
      'error: file not found at /tmp/test',
      ['error: file not found at /var/log'],
    )
    expect(gain).toBeGreaterThan(0)
    expect(gain).toBeLessThan(1)
  })
})

// ─── computeMetrics 测试（使用真实 dsh 事件结构） ───

describe('computeMetrics', () => {
  it('空事件列表返回零度量', () => {
    const metrics = computeMetrics([], defaultConfig)
    expect(metrics.dedupRatio).toBe(0)
    expect(metrics.infoGain).toBe(1)
    expect(metrics.tokenSlope).toBe(0)
    expect(metrics.windowSize).toBe(0)
    expect(metrics.topSignatures).toEqual([])
  })

  it('连续 5 步重复同一命令 → 高去重率', () => {
    const events: SessionEvent[] = []
    for (let i = 0; i < 5; i++) {
      events.push(toolCall('bash', '{"command":"npm test"}', i))
      events.push(toolResult('Error: test failed', true, i))
    }

    const metrics = computeMetrics(events, defaultConfig)
    expect(metrics.dedupRatio).toBe(1)
    expect(metrics.windowSize).toBe(5)
    expect(metrics.topSignatures.length).toBeGreaterThan(0)
    expect(metrics.topSignatures[0].count).toBe(5)
  })

  it('每步不同命令 → 低去重率', () => {
    const events: SessionEvent[] = []
    for (let i = 0; i < 5; i++) {
      events.push(toolCall(`tool-${i}`, `{"step":${i}}`, i))
      events.push(toolResult(`result for step ${i}`, false, i))
    }

    const metrics = computeMetrics(events, defaultConfig)
    expect(metrics.dedupRatio).toBe(0.2)
    expect(metrics.infoGain).toBeGreaterThan(0)
  })

  it('从 assistant/message 读取 token 用量（C3 修复）', () => {
    const events: SessionEvent[] = []
    for (let i = 0; i < 3; i++) {
      events.push(toolCall('llm', '{"prompt":"hello"}', i))
      events.push(toolResult(`response ${i}`, false, i))
      events.push(assistantMessage(100, 50, i))
    }

    const metrics = computeMetrics(events, { ...defaultConfig, windowK: 3 })
    expect(metrics.tokenSlope).toBe(50) // 平均每步 50 输出 token
  })

  it('窗口大小限制生效', () => {
    const events: SessionEvent[] = []
    for (let i = 0; i < 10; i++) {
      events.push(toolCall('step', `{"i":${i}}`, i))
    }

    const metrics = computeMetrics(events, defaultConfig)
    expect(metrics.windowSize).toBe(5)
  })

  it('ContentBlock[] 正确提取文本（C3 修复）', () => {
    const events: SessionEvent[] = []
    // 5 个相同的 tool/result（使用 ContentBlock[] 格式）
    for (let i = 0; i < 5; i++) {
      events.push(toolCall('fetch', '{"url":"http://localhost:3000/api"}', i))
      events.push(toolResult('Error: ECONNREFUSED connection refused at 127.0.0.1:3000', true, i))
    }

    const metrics = computeMetrics(events, defaultConfig)
    // 相同参数 → 高去重率
    expect(metrics.dedupRatio).toBe(1)
    // 相同内容 → 低信息增量（渐进式比较，第一个结果对空历史=1，其余≈0）
    expect(metrics.infoGain).toBeLessThanOrEqual(0.3)
  })
})
