/**
 * plugin.spec.ts — waterfall 契约测试
 *
 * 断言：
 * 1. loop-guard 返回 LoopGuardResult（含 metrics、seed）
 * 2. context-guard 返回 ContextGuardResult（含 seed、compressionPrompt、needsTrim）
 * 3. 插件 disabled 时不干预
 * 4. tool-retry 守卫正确工作
 * 5. 配置合并校验
 * 6. 诊断报告构建器
 */

import { describe, it, expect } from 'vitest'
import { createLoopGuard } from '../src/guards/loop-guard.js'
import { createContextGuard } from '../src/guards/context-guard.js'
import { createToolRetryGuard } from '../src/guards/tool-retry.js'
import { createActionChain } from '../src/actions/index.js'
import { DiagnosticReportBuilder } from '../src/report/diagnostic.js'
import { DEFAULT_CONFIG, type WatchdogConfig, type SessionEvent, type ContentBlock } from '../src/sentinel/types.js'
import { mergeConfig } from '../src/settings.js'

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

function assistantMessage(inputTokens: number, outputTokens: number, seq = 0): SessionEvent {
  return {
    type: 'assistant/message', seq, time: Date.now(),
    data: { turn: 1, step: seq, message: {}, usage: { inputTokens, outputTokens } },
  }
}

function createMockSeed(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: 'high' as const,
    temperature: 0.7,
    maxTokens: 4096,
    ...overrides,
  }
}

function createMockPayload(events: SessionEvent[] = [], agent?: any) {
  return {
    agent: agent ?? {
      session: { events },
      cancel: () => {},
      steer: () => {},
    },
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }
}

// ─── loop-guard 契约测试 ───

describe('loop-guard 契约测试', () => {
  it('返回 LoopGuardResult 含 metrics 和 seed', async () => {
    const config = DEFAULT_CONFIG
    const guard = createLoopGuard(config)
    const seed = createMockSeed()
    const payload = createMockPayload([])

    const result = await guard.handleRequest(payload, async () => seed)

    // 验证 LoopGuardResult 结构
    expect(result.seed).toBeDefined()
    expect(result.metrics).toBeDefined()
    expect(result.state).toBe('NORMAL')
    expect(result.shouldAct).toBe(false)
    // seed 的原始字段透传
    expect(result.seed.provider).toBe('deepseek')
  })

  it('loop-guard disabled 时返回 metrics=null', async () => {
    const config: WatchdogConfig = {
      ...DEFAULT_CONFIG,
      loopGuard: { ...DEFAULT_CONFIG.loopGuard, enabled: false },
    }
    const guard = createLoopGuard(config)
    const seed = createMockSeed()
    const payload = createMockPayload([])

    const result = await guard.handleRequest(payload, async () => seed)
    expect(result.metrics).toBeNull()
    expect(result.state).toBe('NORMAL')
  })
})

// ─── context-guard 契约测试 ───

describe('context-guard 契约测试', () => {
  it('返回 ContextGuardResult 含 compressionPrompt', async () => {
    const config = DEFAULT_CONFIG
    const guard = createContextGuard(config)
    const seed = createMockSeed()
    const payload = createMockPayload([])

    const result = await guard.handleRequest(payload, async () => seed)
    expect(result.seed).toBeDefined()
    expect(result.compressionPrompt).toBeNull() // 低 token 时不触发
    expect(result.needsTrim).toBe(false)
  })

  it('context-guard: 超硬阈值时限制 maxTokens + needsTrim', async () => {
    const config: WatchdogConfig = {
      ...DEFAULT_CONFIG,
      contextGuard: { ...DEFAULT_CONFIG.contextGuard, hardTokens: 100 },
    }
    const guard = createContextGuard(config)

    const events: SessionEvent[] = []
    for (let i = 0; i < 50; i++) {
      events.push(toolCall('bash', '{"command":"' + 'x'.repeat(100) + '"}', i))
      events.push(toolResult('y'.repeat(100), false, i))
      events.push(assistantMessage(2000, 1000, i))
    }

    const seed = createMockSeed()
    const payload = createMockPayload(events)
    const result = await guard.handleRequest(payload, async () => seed)

    // 硬阈值：maxTokens 限制 + needsTrim
    expect(result.seed.maxTokens).toBeLessThanOrEqual(1024)
    expect(result.needsTrim).toBe(true)
    expect(result.compressionPrompt).toBeTruthy()
  })

  it('context-guard disabled 时不干预', async () => {
    const config: WatchdogConfig = {
      ...DEFAULT_CONFIG,
      contextGuard: { ...DEFAULT_CONFIG.contextGuard, enabled: false },
    }
    const guard = createContextGuard(config)
    const seed = createMockSeed()
    const payload = createMockPayload([])

    const result = await guard.handleRequest(payload, async () => seed)
    expect(result.compressionPrompt).toBeNull()
    expect(result.needsTrim).toBe(false)
  })

  it('context-guard: 估算 token 从 assistant/message.usage 读取（C3 修复）', () => {
    const config = DEFAULT_CONFIG
    const guard = createContextGuard(config)

    const events: SessionEvent[] = []
    for (let i = 0; i < 5; i++) {
      events.push(assistantMessage(10000, 5000, i))
    }

    const tokens = guard.estimateTokens(events)
    expect(tokens).toBe(75000) // (10000+5000) * 5
  })
})

// ─── tool-retry 守卫测试 ───

describe('tool-retry 守卫', () => {
  it('成功时不重试', () => {
    const guard = createToolRetryGuard(DEFAULT_CONFIG)
    const decision = guard.handleResult(
      { name: 'bash', arguments: '{}', callId: 'c1', attempt: 0 },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    expect(decision.kind).toBe('accept')
  })

  it('失败时指数退避重试', () => {
    const guard = createToolRetryGuard(DEFAULT_CONFIG)
    const ctx = { name: 'bash', arguments: '{}', callId: 'c1', attempt: 0 }

    const d1 = guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    expect(d1.kind).toBe('retry')
    if (d1.kind === 'retry') {
      expect(d1.delay).toBe(1000)
      expect(d1.attempt).toBe(1)
    }

    const d2 = guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    expect(d2.kind).toBe('retry')
    if (d2.kind === 'retry') expect(d2.delay).toBe(3000)

    const d3 = guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    expect(d3.kind).toBe('retry')
    if (d3.kind === 'retry') expect(d3.delay).toBe(9000)

    // 第 4 次失败后降级
    const d4 = guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    expect(d4.kind).toBe('readonly')
  })

  it('重试成功后重置计数', () => {
    const guard = createToolRetryGuard(DEFAULT_CONFIG)
    const ctx = { name: 'bash', arguments: '{}', callId: 'c1', attempt: 0 }

    guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    guard.handleResult(ctx, { isError: false, content: [{ type: 'text', text: 'ok' }] })

    const decision = guard.handleResult(ctx, { isError: false, content: [{ type: 'text', text: 'ok' }] })
    expect(decision.kind).toBe('accept')
  })

  it('disabled 时直接 block', () => {
    const config: WatchdogConfig = {
      ...DEFAULT_CONFIG,
      toolRetry: { ...DEFAULT_CONFIG.toolRetry, enabled: false },
    }
    const guard = createToolRetryGuard(config)
    const decision = guard.handleResult(
      { name: 'bash', arguments: '{}', callId: 'c1', attempt: 0 },
      { isError: true, error: { name: 'Error', code: 'FAIL' } },
    )
    expect(decision.kind).toBe('block')
    if (decision.kind === 'block') expect(decision.surrender).toBe(true)
  })

  it('备用工具降级', () => {
    const guard = createToolRetryGuard(DEFAULT_CONFIG)
    guard.registerFallback('fetch', ['curl', 'wget'])

    const ctx = { name: 'fetch', arguments: '{}', callId: 'c1', attempt: 0 }
    for (let i = 0; i < DEFAULT_CONFIG.toolRetry.maxRetries; i++) {
      guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    }
    const decision = guard.handleResult(ctx, { isError: true, error: { name: 'Error', code: 'FAIL' } })
    expect(decision.kind).toBe('fallback')
    if (decision.kind === 'fallback') expect(decision.fallbackTool).toBe('curl')
  })
})

// ─── 诊断报告构建器测试 ───

describe('DiagnosticReportBuilder', () => {
  it('构建完整诊断报告', () => {
    const builder = new DiagnosticReportBuilder('session-123')
      .setFinalState('CONFIRMED')
      .setTrigger('loop-detected')
      .setStalledSinceStep(5)
      .setRepeatedActions([{ signature: 'bash({"command":"npm test"})', count: 5 }])
      .addAction('L1', 'nudge', 'injected')
      .addAction('L2', 'downgrade', 'applied preset 1')
      .addAction('L3', 'hard-stop', 'executed')
      .addContextGuardTrigger('soft', 85000)
      .addToolRetry('fetch', 1, 'failed')
      .addToolRetry('fetch', 2, 'success')

    const report = builder.build()
    expect(report.sessionId).toBe('session-123')
    expect(report.finalState).toBe('CONFIRMED')
    expect(report.trigger).toBe('loop-detected')
    expect(report.repeatedActions).toHaveLength(1)
    expect(report.actionChain).toHaveLength(3)
  })

  it('生成人类可读摘要', () => {
    const builder = new DiagnosticReportBuilder()
      .setFinalState('CONFIRMED')
      .setTrigger('loop-detected')
      .setStalledSinceStep(3)

    const summary = builder.buildSummary()
    expect(summary).toContain('dsh-watchdog 诊断报告')
    expect(summary).toContain('CONFIRMED')
  })
})

// ─── 配置合并测试 ───

describe('配置合并', () => {
  it('用户配置覆盖默认值', () => {
    const merged = mergeConfig({
      loopGuard: { windowK: 10 },
      toolRetry: { maxRetries: 5 },
    })
    expect(merged.loopGuard.windowK).toBe(10)
    expect(merged.loopGuard.dedupSoft).toBe(0.6)
    expect(merged.toolRetry.maxRetries).toBe(5)
    expect(merged.contextGuard.softTokens).toBe(80000)
  })

  it('空配置使用默认值', () => {
    const merged = mergeConfig({})
    expect(merged).toEqual(DEFAULT_CONFIG)
  })

  it('非法配置抛出错误（L3 修复）', () => {
    expect(() => mergeConfig({ loopGuard: { windowK: 0 } })).toThrow()
    expect(() => mergeConfig({ loopGuard: { dedupSoft: 0.9, dedupHard: 0.8 } })).toThrow()
    expect(() => mergeConfig({ contextGuard: { softTokens: 120000, hardTokens: 100000 } })).toThrow()
  })
})
