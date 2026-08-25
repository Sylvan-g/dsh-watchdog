/**
 * sentinel/fsm 单元测试
 *
 * 覆盖：三态状态机全分支转移
 */

import { describe, it, expect } from 'vitest'
import { transition, resetFsm, shouldAct, INITIAL_FSM_STATE } from '../src/sentinel/fsm.js'
import type { ProgressMetrics, LoopGuardConfig } from '../src/sentinel/types.js'

const defaultConfig: LoopGuardConfig = {
  enabled: true,
  windowK: 5,
  dedupSoft: 0.6,
  dedupHard: 0.9,
  infoGain: 0.2,
  stallSteps: 3,
}

function makeMetrics(overrides: Partial<ProgressMetrics> = {}): ProgressMetrics {
  return {
    dedupRatio: 0,
    infoGain: 1,
    tokenSlope: 100,
    windowSize: 5,
    topSignatures: [],
    ...overrides,
  }
}

describe('FSM 初始状态', () => {
  it('初始状态为 NORMAL', () => {
    expect(INITIAL_FSM_STATE.current).toBe('NORMAL')
    expect(INITIAL_FSM_STATE.stalledSteps).toBe(0)
    expect(INITIAL_FSM_STATE.suspectedSinceStep).toBe(-1)
  })

  it('resetFsm 返回初始状态', () => {
    const state = resetFsm()
    expect(state.current).toBe('NORMAL')
  })
})

describe('NORMAL 状态转移', () => {
  it('正常进展保持 NORMAL', () => {
    const metrics = makeMetrics({ dedupRatio: 0.3, infoGain: 0.5 })
    const next = transition(INITIAL_FSM_STATE, metrics, defaultConfig, 1)
    expect(next.current).toBe('NORMAL')
    expect(next.stalledSteps).toBe(0)
  })

  it('去重率超过软阈值 → SUSPECTED', () => {
    const metrics = makeMetrics({ dedupRatio: 0.7, infoGain: 0.5 })
    const next = transition(INITIAL_FSM_STATE, metrics, defaultConfig, 3)
    expect(next.current).toBe('SUSPECTED')
    expect(next.stalledSteps).toBe(1)
    expect(next.suspectedSinceStep).toBe(3)
  })

  it('信息增量低于阈值 → SUSPECTED', () => {
    const metrics = makeMetrics({ dedupRatio: 0.3, infoGain: 0.1 })
    const next = transition(INITIAL_FSM_STATE, metrics, defaultConfig, 2)
    expect(next.current).toBe('SUSPECTED')
  })

  it('边界值：去重率等于软阈值不转移', () => {
    const metrics = makeMetrics({ dedupRatio: 0.6, infoGain: 0.5 })
    const next = transition(INITIAL_FSM_STATE, metrics, defaultConfig, 1)
    expect(next.current).toBe('NORMAL')
  })
})

describe('SUSPECTED 状态转移', () => {
  const suspectedState = {
    current: 'SUSPECTED' as const,
    stalledSteps: 1,
    suspectedSinceStep: 3,
  }

  it('恢复：去重率回落到软阈值以下 → NORMAL', () => {
    // 新恢复条件：只需 dedupRatio <= dedupSoft 即可恢复
    const metrics = makeMetrics({ dedupRatio: 0.3, infoGain: 0.1 })
    const next = transition(suspectedState, metrics, defaultConfig, 4)
    expect(next.current).toBe('NORMAL')
    expect(next.stalledSteps).toBe(0)
    expect(next.suspectedSinceStep).toBe(-1)
  })

  it('去重率超过硬阈值 → 直接 CONFIRMED', () => {
    const metrics = makeMetrics({ dedupRatio: 0.95, infoGain: 0.1 })
    const next = transition(suspectedState, metrics, defaultConfig, 4)
    expect(next.current).toBe('CONFIRMED')
  })

  it('连续停滞达到容忍上限 → CONFIRMED', () => {
    // stalledSteps=1, 再累计 2 步到 stallSteps=3
    // 需要 dedupRatio > dedupSoft(0.6) 才能保持 SUSPECTED
    let state = suspectedState
    const lowMetrics = makeMetrics({ dedupRatio: 0.7, infoGain: 0.1 }) // > dedupSoft 但 < dedupHard

    state = transition(state, lowMetrics, defaultConfig, 4) // stalledSteps=2
    expect(state.current).toBe('SUSPECTED')

    state = transition(state, lowMetrics, defaultConfig, 5) // stalledSteps=3 → CONFIRMED
    expect(state.current).toBe('CONFIRMED')
    expect(state.stalledSteps).toBe(3)
  })

  it('去重率仍高于软阈值 → 保持 SUSPECTED', () => {
    // dedupRatio > dedupSoft(0.6) 时保持 SUSPECTED
    const metrics = makeMetrics({ dedupRatio: 0.7, infoGain: 0.5 })
    const next = transition(suspectedState, metrics, defaultConfig, 4)
    expect(next.current).toBe('SUSPECTED')
    expect(next.stalledSteps).toBe(2)
  })
})

describe('CONFIRMED 终态', () => {
  it('CONFIRMED 不再转移', () => {
    const confirmedState = {
      current: 'CONFIRMED' as const,
      stalledSteps: 3,
      suspectedSinceStep: 3,
    }
    // 即使度量恢复也不转移
    const metrics = makeMetrics({ dedupRatio: 0, infoGain: 1 })
    const next = transition(confirmedState, metrics, defaultConfig, 10)
    expect(next.current).toBe('CONFIRMED')
  })
})

describe('shouldAct', () => {
  it('NORMAL 不需要触发动作', () => {
    expect(shouldAct(INITIAL_FSM_STATE)).toBe(false)
  })

  it('SUSPECTED 不需要触发动作', () => {
    expect(shouldAct({ current: 'SUSPECTED', stalledSteps: 1, suspectedSinceStep: 0 })).toBe(false)
  })

  it('CONFIRMED 需要触发动作', () => {
    expect(shouldAct({ current: 'CONFIRMED', stalledSteps: 3, suspectedSinceStep: 0 })).toBe(true)
  })
})

describe('完整场景：连续 5 步重复同一失败命令', () => {
  it('应在 CONFIRMED 时被正确识别', () => {
    let state = INITIAL_FSM_STATE
    const config = defaultConfig

    // 步 1-5：重复同一失败命令
    // dedupRatio=1.0 > dedupHard=0.9，第 2 步就从 SUSPECTED 直接跳到 CONFIRMED（硬阈值路径）
    for (let step = 1; step <= 5; step++) {
      const metrics = makeMetrics({
        dedupRatio: 1.0,    // 全部重复
        infoGain: 0,        // 无新信息
        tokenSlope: 0,      // 无有效输出
      })
      state = transition(state, metrics, config, step)
    }

    expect(state.current).toBe('CONFIRMED')
    // 硬阈值路径下 stalledSteps 从 SUSPECTED 开始累加，不依赖 stallSteps
    expect(state.stalledSteps).toBeGreaterThan(0)
  })

  it('通过 stallSteps 路径也能到 CONFIRMED', () => {
    let state = INITIAL_FSM_STATE
    const config = defaultConfig

    // dedupRatio=0.7（> dedupSoft=0.6 但 < dedupHard=0.9），走 stallSteps 路径
    const metrics = makeMetrics({ dedupRatio: 0.7, infoGain: 0.1 })
    state = transition(state, metrics, config, 1)
    expect(state.current).toBe('SUSPECTED')

    for (let step = 2; step <= 4; step++) {
      state = transition(state, metrics, config, step)
    }
    // stalledSteps=3 >= stallSteps=3 → CONFIRMED
    expect(state.current).toBe('CONFIRMED')
    expect(state.stalledSteps).toBeGreaterThanOrEqual(config.stallSteps)
  })
})

describe('完整场景：慢但每步有新进展', () => {
  it('不应被误杀', () => {
    let state = INITIAL_FSM_STATE
    const config = defaultConfig

    for (let step = 1; step <= 10; step++) {
      const metrics = makeMetrics({
        dedupRatio: 0.2,    // 低去重率
        infoGain: 0.5,      // 有新信息
        tokenSlope: 50,     // 有输出
      })
      state = transition(state, metrics, config, step)
    }

    expect(state.current).toBe('NORMAL')
  })
})
