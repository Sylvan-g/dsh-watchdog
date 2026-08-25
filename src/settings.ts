/**
 * dsh-watchdog 配置管理
 *
 * 通过 Cordis settings 服务注册 watchdog 命名空间，
 * 支持默认值 + 用户覆盖，运行时 live 生效。
 *
 * 注意：由于 @deepseek-ai/cordis 是 peerDependency，
 * 本模块导出 schema 定义和默认值，实际注册由 index.ts 在插件入口完成。
 */

import type { WatchdogConfig } from './sentinel/types.js'
import { DEFAULT_CONFIG } from './sentinel/types.js'

export { DEFAULT_CONFIG } from './sentinel/types.js'
export type { WatchdogConfig, LoopGuardConfig, ToolRetryConfig, ContextGuardConfig, ActionsConfig } from './sentinel/types.js'

/**
 * 配置 schema 定义（供 Cordis settings.register 使用）
 *
 * schema 采用 schemastery 风格的对象描述，
 * 实际注册时由 index.ts 中 ctx.settings.register 消费。
 */
export const configSchema = {
  enabled: { type: 'boolean', default: DEFAULT_CONFIG.enabled, desc: '是否启用 watchdog 插件' },
  loopGuard: {
    type: 'object',
    desc: '死循环 / 无进展检测',
    default: DEFAULT_CONFIG.loopGuard,
    properties: {
      enabled: { type: 'boolean', default: DEFAULT_CONFIG.loopGuard.enabled, desc: '是否启用死循环检测' },
      windowK: { type: 'number', default: DEFAULT_CONFIG.loopGuard.windowK, desc: '滑动窗口步数' },
      dedupSoft: { type: 'number', default: DEFAULT_CONFIG.loopGuard.dedupSoft, desc: '去重率软阈值（进入 SUSPECTED）' },
      dedupHard: { type: 'number', default: DEFAULT_CONFIG.loopGuard.dedupHard, desc: '去重率硬阈值（直接 CONFIRMED）' },
      infoGain: { type: 'number', default: DEFAULT_CONFIG.loopGuard.infoGain, desc: '信息增量阈值' },
      stallSteps: { type: 'number', default: DEFAULT_CONFIG.loopGuard.stallSteps, desc: 'SUSPECTED→CONFIRMED 容忍步数' },
    },
  },
  toolRetry: {
    type: 'object',
    desc: '工具失败重试与降级',
    default: DEFAULT_CONFIG.toolRetry,
    properties: {
      enabled: { type: 'boolean', default: DEFAULT_CONFIG.toolRetry.enabled, desc: '是否启用工具重试' },
      maxRetries: { type: 'number', default: DEFAULT_CONFIG.toolRetry.maxRetries, desc: '最大重试次数' },
      backoffMs: { type: 'array', default: DEFAULT_CONFIG.toolRetry.backoffMs, desc: '指数退避等待时间(ms)' },
    },
  },
  contextGuard: {
    type: 'object',
    desc: '上下文膨胀守卫',
    default: DEFAULT_CONFIG.contextGuard,
    properties: {
      enabled: { type: 'boolean', default: DEFAULT_CONFIG.contextGuard.enabled, desc: '是否启用上下文守卫' },
      softTokens: { type: 'number', default: DEFAULT_CONFIG.contextGuard.softTokens, desc: '软阈值 token 数' },
      hardTokens: { type: 'number', default: DEFAULT_CONFIG.contextGuard.hardTokens, desc: '硬阈值 token 数' },
    },
  },
  actions: {
    type: 'object',
    desc: '多级降级动作链',
    default: DEFAULT_CONFIG.actions,
    properties: {
      nudgeSteps: { type: 'number', default: DEFAULT_CONFIG.actions.nudgeSteps, desc: 'L1 纠偏观察步数' },
    },
  },
} as const

/**
 * 合并用户配置与默认配置
 * 确保所有字段都有值，深层合并
 *
 * 修复 L3：添加基本校验，非法配置抛出错误
 */
export function mergeConfig(user: Partial<WatchdogConfig>): WatchdogConfig {
  const merged: WatchdogConfig = {
    enabled: user.enabled ?? DEFAULT_CONFIG.enabled,
    loopGuard: { ...DEFAULT_CONFIG.loopGuard, ...user.loopGuard },
    toolRetry: { ...DEFAULT_CONFIG.toolRetry, ...user.toolRetry },
    contextGuard: { ...DEFAULT_CONFIG.contextGuard, ...user.contextGuard },
    actions: { ...DEFAULT_CONFIG.actions, ...user.actions },
  }

  // 校验关键约束
  if (merged.loopGuard.windowK <= 0) {
    throw new Error(`[watchdog] loopGuard.windowK must be > 0, got ${merged.loopGuard.windowK}`)
  }
  if (merged.loopGuard.dedupSoft >= merged.loopGuard.dedupHard) {
    throw new Error(`[watchdog] loopGuard.dedupSoft (${merged.loopGuard.dedupSoft}) must be < dedupHard (${merged.loopGuard.dedupHard})`)
  }
  if (merged.loopGuard.dedupHard > 1 || merged.loopGuard.dedupSoft < 0) {
    throw new Error(`[watchdog] loopGuard dedup thresholds must be in [0, 1], got soft=${merged.loopGuard.dedupSoft}, hard=${merged.loopGuard.dedupHard}`)
  }
  if (merged.toolRetry.maxRetries < 0) {
    throw new Error(`[watchdog] toolRetry.maxRetries must be >= 0, got ${merged.toolRetry.maxRetries}`)
  }
  if (merged.toolRetry.backoffMs.length === 0 && merged.toolRetry.maxRetries > 0) {
    throw new Error(`[watchdog] toolRetry.backoffMs must not be empty when maxRetries > 0`)
  }
  if (merged.contextGuard.softTokens >= merged.contextGuard.hardTokens) {
    throw new Error(`[watchdog] contextGuard.softTokens (${merged.contextGuard.softTokens}) must be < hardTokens (${merged.contextGuard.hardTokens})`)
  }

  return merged
}
