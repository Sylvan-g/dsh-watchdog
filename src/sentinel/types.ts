/**
 * dsh-watchdog 核心类型定义
 *
 * 修复 C3：事件类型对齐真实 dsh SessionEventMap
 * - tool/call: { turn, step, callId, name, arguments }
 * - tool/result: { turn, step, message: ToolResultMessage, error?: { name, code }, meta? }
 * - assistant/message: { turn, step, message: AssistantMessage, usage?: TokenUsage }
 *
 * ToolResultMessage.content 是 ContentBlock[] 数组，不是 string
 * TokenUsage 在 assistant/message 事件上，不在 tool/result 上
 */

// ─── dsh 内容块类型（简化版，与 @deepseek-ai/dsh-llm 对齐） ───

/** 内容块 — 支持文本、工具调用、工具结果等 */
export interface TextContentBlock {
  type: 'text'
  text: string
}

export interface ToolUseContentBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface ToolResultContentBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock

/** 从 ContentBlock[] 中提取纯文本 */
export function extractTextFromBlocks(blocks: ContentBlock[] | string | undefined): string {
  if (!blocks) return ''
  if (typeof blocks === 'string') return blocks
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') {
        parts.push(block.content)
      } else if (Array.isArray(block.content)) {
        parts.push(extractTextFromBlocks(block.content))
      }
    }
  }
  return parts.join('\n')
}

/** 判断 ContentBlock[] 是否表示错误 */
export function isErrorContent(blocks: ContentBlock[] | undefined): boolean {
  if (!blocks) return false
  return blocks.some(b => b.type === 'tool_result' && b.is_error === true)
}

// ─── dsh 事件类型（与 SessionEventMap 对齐） ───

/** 工具调用事件 — 与 dsh SessionEventMap['tool/call'] 对齐 */
export interface ToolCallEvent {
  type: 'tool/call'
  seq: number
  time: number
  data: {
    turn: number
    step: number
    callId: string
    name: string
    /** 模型产出的原始 JSON 参数字符串 */
    arguments: string
  }
}

/** 工具返回事件 — 与 dsh SessionEventMap['tool/result'] 对齐 */
export interface ToolResultEvent {
  type: 'tool/result'
  seq: number
  time: number
  data: {
    turn: number
    step: number
    /** ToolResultMessage — 包含 content (ContentBlock[]) */
    message: {
      role: 'tool'
      content: ContentBlock[]
      tool_use_id?: string
    }
    /** 工具内部错误标识（非模型可见） */
    error?: { name: string; code: string }
    /** 工具私有元数据 */
    meta?: unknown
  }
}

/** 助手消息事件 — token 用量在此事件上 */
export interface AssistantMessageEvent {
  type: 'assistant/message'
  seq: number
  time: number
  data: {
    turn: number
    step: number
    message: unknown
    /** token 用量 — 这是唯一可靠的 token 来源 */
    usage?: TokenUsage
    interrupted?: true
  }
}

/** token 用量 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

/** turn 开始事件 */
export interface TurnStartEvent {
  type: 'turn/start'
  seq: number
  time: number
  data: Record<string, unknown>
}

/** turn 结束事件 */
export interface TurnEndEvent {
  type: 'turn/end'
  seq: number
  time: number
  data: {
    turn: number
    reason: { kind: 'completed' | 'aborted' | 'error'; message?: string }
    usage?: TokenUsage
  }
}

/** 所有会话事件联合类型 */
export type SessionEvent = ToolCallEvent | ToolResultEvent | AssistantMessageEvent | TurnStartEvent | TurnEndEvent

// ─── 三态状态机类型 ───

/** 守卫状态：NORMAL → SUSPECTED → CONFIRMED */
export type LoopState = 'NORMAL' | 'SUSPECTED' | 'CONFIRMED'

// ─── 进展度量类型 ───

/** 进展度量结果 */
export interface ProgressMetrics {
  /** 动作去重率：窗口内最高频签名占比 [0, 1] */
  dedupRatio: number
  /** 信息增量：窗口内新信息占比 [0, 1]，1 = 全新，0 = 全部重复 */
  infoGain: number
  /** token 消耗斜率：有效输出 token / 步数，趋近 0 说明"只调工具不出活" */
  tokenSlope: number
  /** 当前滑动窗口大小 */
  windowSize: number
  /** 窗口内动作签名列表（用于诊断报告） */
  topSignatures: Array<{ signature: string; count: number }>
}

// ─── 配置类型 ───

/** 死循环守卫配置 */
export interface LoopGuardConfig {
  enabled: boolean
  /** 滑动窗口步数 K */
  windowK: number
  /** 去重率软阈值 T1（进入 SUSPECTED） */
  dedupSoft: number
  /** 去重率硬阈值 T2（直接 CONFIRMED） */
  dedupHard: number
  /** 信息增量阈值 G1 */
  infoGain: number
  /** SUSPECTED→CONFIRMED 容忍步数 M */
  stallSteps: number
}

/** 工具重试配置 */
export interface ToolRetryConfig {
  enabled: boolean
  /** 最大重试次数 */
  maxRetries: number
  /** 指数退避等待时间（ms），数组长度即最大重试层级 */
  backoffMs: number[]
}

/** 上下文守卫配置 */
export interface ContextGuardConfig {
  enabled: boolean
  /** 软阈值 token 数（触发压缩提示注入） */
  softTokens: number
  /** 硬阈值 token 数（触发历史裁剪） */
  hardTokens: number
}

/** 降级动作配置 */
export interface ActionsConfig {
  /** L1 纠偏观察步数 */
  nudgeSteps: number
}

/** 插件总配置 */
export interface WatchdogConfig {
  enabled: boolean
  loopGuard: LoopGuardConfig
  toolRetry: ToolRetryConfig
  contextGuard: ContextGuardConfig
  actions: ActionsConfig
}

/** 默认配置 */
export const DEFAULT_CONFIG: WatchdogConfig = {
  enabled: true,
  loopGuard: {
    enabled: true,
    windowK: 5,
    dedupSoft: 0.6,
    dedupHard: 0.9,
    infoGain: 0.2,
    stallSteps: 3,
  },
  toolRetry: {
    enabled: true,
    maxRetries: 3,
    backoffMs: [1000, 3000, 9000],
  },
  contextGuard: {
    enabled: true,
    softTokens: 80000,
    hardTokens: 110000,
  },
  actions: {
    nudgeSteps: 3,
  },
}

// ─── watch() 输出类型 ───

/** watch() 的判定结果 */
export interface WatchResult {
  /** 当前状态 */
  state: LoopState
  /** 进展度量快照 */
  metrics: ProgressMetrics
  /** 需要注入到 agent/request seed 的补丁字段 */
  patch: Record<string, unknown>
  /** 是否需要触发动作链 */
  shouldAct: boolean
  /** 动作级别（仅 shouldAct=true 时有意义） */
  actionLevel?: 'nudge' | 'downgrade' | 'stop'
  /** 诊断信息 */
  diagnostic?: DiagnosticSnapshot
}

// ─── 诊断报告类型 ───

/** 诊断快照（单次检测） */
export interface DiagnosticSnapshot {
  timestamp: number
  state: LoopState
  metrics: ProgressMetrics
  trigger: string
  stalledSteps: number
}

/** 诊断报告（完整，输出给用户） */
export interface DiagnosticReport {
  /** 报告 ID */
  id: string
  /** 会话 ID */
  sessionId?: string
  /** 生成时间 */
  timestamp: number
  /** 最终状态 */
  finalState: LoopState
  /** 触发原因 */
  trigger: string
  /** 重复动作列表 */
  repeatedActions: Array<{ signature: string; count: number }>
  /** 每步 token 消耗 */
  stepTokenUsage: Array<{ step: number; inputTokens: number; outputTokens: number }>
  /** 卡死起始步 */
  stalledSinceStep: number
  /** 执行的降级动作链 */
  actionChain: Array<{ level: 'L1' | 'L2' | 'L3'; action: string; result: string; timestamp: number }>
  /** 上下文守卫触发记录 */
  contextGuardTriggers: Array<{ type: 'soft' | 'hard'; tokenCount: number; timestamp: number }>
  /** 工具重试记录 */
  toolRetryLog: Array<{ tool: string; attempt: number; result: string; timestamp: number }>
}

// ─── 工具执行相关类型（与 dsh tools/execute 对齐） ───

/** 工具执行输入 — 对齐 ToolExecution */
export interface ToolExecutionContext {
  name: string
  /** 已解析的参数（dsh 中 arguments 是 unknown，非 string） */
  arguments: unknown
  callId: string
  agent?: unknown
  signal?: AbortSignal
}

/** 工具执行结果 — 对齐 ToolExecutionResult */
export interface ToolExecutionResult {
  isError: boolean
  /** 成功时的 ContentBlock[] */
  content?: ContentBlock[]
  /** 失败时的错误信息 */
  error?: { name: string; code: string; message?: string }
  /** 成功时的 JSON 值 */
  value?: unknown
  /** 附加上下文（用于传递给下一轮） */
  additionalContexts?: unknown[]
  meta?: unknown
}

// ─── agent/request payload 类型（与 dsh 对齐） ───

/** agent/request waterfall payload — 对齐 dsh 真实签名 */
export interface AgentRequestPayload {
  agent: unknown
  turn: number
  step: number
  signal: AbortSignal
}

/** agent/request seed（LlmCallConfig） */
export interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: 'off' | 'high' | 'max'
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

// ─── dsh Agent 类型（简化版） ───

/** dsh Agent 对象的最小子集 */
export interface AgentLike {
  session?: {
    events: SessionEvent[]
  }
  cancel?: (opts: { kind: string; reason: string }) => void
  steer?: (msg: string) => void
}

/** 从 payload 中安全提取 agent */
export function extractAgent(payload: AgentRequestPayload): AgentLike | undefined {
  return payload.agent as AgentLike | undefined
}

/** 从 payload 中安全提取 session events */
export function extractEvents(payload: AgentRequestPayload): SessionEvent[] {
  const agent = extractAgent(payload)
  return agent?.session?.events ?? []
}
