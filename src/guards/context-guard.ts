/**
 * 上下文膨胀守卫（context-guard）
 *
 * 监控当前上下文 token 用量：
 * - 超过软阈值时，注入摘要压缩指令（通过 agent.steer 或 seed patch）
 * - 超过硬阈值时，限制 maxTokens + 标记需要历史裁剪
 *
 * 修复 C3：token 用量从 assistant/message.data.usage 读取
 * 修复 M5：软阈值实际注入压缩提示，硬阈值限制 maxTokens 并标记裁剪
 *
 * 挂载点：
 * - agent/request：读取 token 计数，判断是否超阈值
 * - agent/request-error：捕获 CONTEXT_WINDOW_EXCEEDED，触发紧急裁剪
 */

import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, SessionEvent, AgentLike } from '../sentinel/types.js'
import { extractAgent, extractEvents } from '../sentinel/types.js'
import { logger } from '../report/logger.js'

/** 上下文守卫状态 */
export interface ContextGuardState {
  /** 当前估算的 token 用量 */
  estimatedTokens: number
  /** 是否已触发软阈值 */
  softTriggered: boolean
  /** 是否已触发硬阈值 */
  hardTriggered: boolean
  /** 累计压缩次数 */
  compressionCount: number
}

/** L1 压缩提示模板 */
const COMPRESSION_PROMPT = `[watchdog] 上下文接近窗口上限。请对之前的历史对话进行摘要压缩，保留关键决策和事实，删除冗余细节。优先保留最近 3 轮对话的完整内容。`

/**
 * 创建 context-guard
 */
export function createContextGuard(config: WatchdogConfig) {
  const state: ContextGuardState = {
    estimatedTokens: 0,
    softTriggered: false,
    hardTriggered: false,
    compressionCount: 0,
  }

  const softTokens = config.contextGuard.softTokens
  const hardTokens = config.contextGuard.hardTokens

  /**
   * 估算当前上下文 token 用量
   *
   * 修复 C3：从 assistant/message.data.usage 和 turn/end.data.usage 读取
   * fallback：按字符数近似估算
   */
  function estimateTokens(events: readonly SessionEvent[]): number {
    let totalInput = 0
    let totalOutput = 0

    for (const event of events) {
      // 修复 C3：token 用量在 assistant/message 事件上
      if (event.type === 'assistant/message' && event.data.usage) {
        totalInput += event.data.usage.inputTokens ?? 0
        totalOutput += event.data.usage.outputTokens ?? 0
      }
      // 兼容 turn/end 上的 usage
      if (event.type === 'turn/end' && event.data.usage) {
        totalInput += event.data.usage.inputTokens ?? 0
        totalOutput += event.data.usage.outputTokens ?? 0
      }
    }

    // 如果有 usage 数据，直接用
    if (totalInput > 0 || totalOutput > 0) {
      return totalInput + totalOutput
    }

    // fallback：从 tool/call 和 tool/result 的 ContentBlock 估算字符数
    let charCount = 0
    for (const event of events) {
      if (event.type === 'tool/call' && event.data.arguments) {
        charCount += event.data.arguments.length
      }
      if (event.type === 'tool/result' && event.data.message?.content) {
        // ContentBlock[] 字符估算
        for (const block of event.data.message.content) {
          if (block.type === 'text') charCount += block.text.length
          else if (block.type === 'tool_result' && typeof block.content === 'string') {
            charCount += block.content.length
          }
        }
      }
    }
    // 粗略估算：平均 0.4 token/字符
    return Math.ceil(charCount * 0.4)
  }

  /**
   * 处理 agent/request 事件
   *
   * 修复 M5：软阈值返回压缩提示 patch，硬阈值限制 maxTokens
   */
  async function handleRequest(
    payload: AgentRequestPayload,
    next: () => Promise<LlmCallConfig>,
  ): Promise<ContextGuardResult> {
    const seed = await next()

    if (!config.contextGuard.enabled) {
      return { seed, compressionPrompt: null, needsTrim: false }
    }

    const events = extractEvents(payload)
    state.estimatedTokens = estimateTokens(events)

    // 超过硬阈值：限制 maxTokens + 标记需要裁剪
    if (state.estimatedTokens > hardTokens && !state.hardTriggered) {
      state.hardTriggered = true
      state.compressionCount++
      logger.logContextGuard(undefined, 'hard', state.estimatedTokens)

      return {
        seed: {
          ...seed,
          maxTokens: Math.min(seed.maxTokens ?? 4096, 1024),
        },
        compressionPrompt: COMPRESSION_PROMPT,
        needsTrim: true,
      }
    }

    // 超过软阈值：注入压缩提示
    if (state.estimatedTokens > softTokens && !state.softTriggered) {
      state.softTriggered = true
      state.compressionCount++
      logger.logContextGuard(undefined, 'soft', state.estimatedTokens)

      // 修复 M5：返回压缩提示，由 index.ts 注入到 agent.steer
      return {
        seed,
        compressionPrompt: COMPRESSION_PROMPT,
        needsTrim: false,
      }
    }

    // 低于软阈值 80%：重置触发状态
    if (state.estimatedTokens <= softTokens * 0.8) {
      state.softTriggered = false
      state.hardTriggered = false
    }

    return { seed, compressionPrompt: null, needsTrim: false }
  }

  /**
   * 处理 agent/request-error 事件
   * 捕获 CONTEXT_WINDOW_EXCEEDED，触发紧急裁剪
   */
  function handleRequestError(failure: { message: string; code?: string }): 'retry' | undefined {
    if (failure.code === 'CONTEXT_WINDOW_EXCEEDED' || failure.message?.includes('context_length_exceeded')) {
      logger.logContextGuard(undefined, 'hard', state.estimatedTokens)
      state.hardTriggered = true
      state.compressionCount++
      return 'retry'
    }
    return undefined
  }

  /**
   * 获取压缩提示（供外部使用）
   */
  function getCompressionPrompt(): string | null {
    if (state.softTriggered) {
      return COMPRESSION_PROMPT
    }
    return null
  }

  /**
   * 重置状态
   */
  function reset(): void {
    state.estimatedTokens = 0
    state.softTriggered = false
    state.hardTriggered = false
    state.compressionCount = 0
  }

  return {
    handleRequest,
    handleRequestError,
    getCompressionPrompt,
    estimateTokens,
    reset,
    get state() { return { ...state } },
  }
}

/** 上下文守卫返回结果 */
export interface ContextGuardResult {
  seed: LlmCallConfig
  /** 软/硬阈值触发的压缩提示（需注入到 agent.steer） */
  compressionPrompt: string | null
  /** 是否需要历史裁剪（硬阈值） */
  needsTrim: boolean
}
