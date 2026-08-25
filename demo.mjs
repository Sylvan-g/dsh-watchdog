/**
 * dsh-watchdog 功能演示脚本
 *
 * 运行方式（无需 dsh 环境）：
 *   node demo.mjs
 *
 * 演示内容：
 *   场景 1: 正常流程 —— 多样化的工具调用，保持 NORMAL
 *   场景 2: 死循环检测 —— 重复相同工具调用，触发 SUSPECTED → CONFIRMED
 *   场景 3: 工具失败重试 —— 指数退避重试 → 备用工具 → 只读兜底 → 交还用户
 *   场景 4: 上下文膨胀守卫 —— 软阈值注入压缩提示、硬阈值限制输出
 *
 * 使用编译产物（lib/），与插件入口共用同一套核心逻辑。
 */
import { SentinelWatch, DEFAULT_CONFIG } from './lib/index.js'
import { mergeConfig } from './lib/settings.js'
import { createToolRetryGuard } from './lib/guards/tool-retry.js'
import { createContextGuard } from './lib/guards/context-guard.js'

// ─────────────────────────────────────────────
// 工具函数：构造 dsh 会话事件（对齐真实 SessionEventMap）
// ─────────────────────────────────────────────
let __seq = 0
const now = () => Date.now()

/** 工具调用事件 */
function toolCall(turn, step, name, args) {
  return {
    type: 'tool/call',
    seq: ++__seq,
    time: now(),
    data: { turn, step, callId: `call_${__seq}`, name, arguments: JSON.stringify(args) },
  }
}

/** 工具返回事件（ContentBlock[] 结构） */
function toolResult(turn, step, text, isError = false) {
  return {
    type: 'tool/result',
    seq: ++__seq,
    time: now(),
    data: {
      turn,
      step,
      message: {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `call_${__seq - 1}`,
            content: text,
            is_error: isError,
          },
        ],
      },
    },
  }
}

/** 助手消息事件（token 用量在此） */
function assistantMessage(turn, step, inputTokens, outputTokens) {
  return {
    type: 'assistant/message',
    seq: ++__seq,
    time: now(),
    data: {
      turn,
      step,
      message: { role: 'assistant', content: [] },
      usage: { inputTokens, outputTokens },
    },
  }
}

// ─────────────────────────────────────────────
// 输出辅助
// ─────────────────────────────────────────────
const line = (title) => console.log('\n' + '═'.repeat(70) + '\n ' + title + '\n' + '═'.repeat(70))
const field = (k, v) => console.log(`  ${String(k).padEnd(22)}: ${v}`)
const sig = (s) => `  ✓ ${s}`

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────
const config = mergeConfig({})
console.log('dsh-watchdog 功能演示')
console.log(`版本: ${DEFAULT_CONFIG.version ?? '0.2.0'}  模式: 纯函数核心 + Guard`)
field('windowK', config.loopGuard.windowK)
field('dedupSoft/dedupHard', `${config.loopGuard.dedupSoft} / ${config.loopGuard.dedupHard}`)
field('infoGain 阈值', config.loopGuard.infoGain)
field('stallSteps', config.loopGuard.stallSteps)
field('toolRetry.maxRetries', config.toolRetry.maxRetries)
field('backoffMs', JSON.stringify(config.toolRetry.backoffMs))

// ═════════════════════════════════════════════
// 场景 1: 正常流程 —— 保持 NORMAL
// ═════════════════════════════════════════════
line('场景 1: 正常流程（Agent 在高效工作，应保持 NORMAL）')

const normalEvents = [
  toolCall(1, 1, 'bash', { command: 'ls -la' }),
  toolResult(1, 1, 'drwxr-xr-x  5 user  staff  160 Jan  1 12:00 .'),
  assistantMessage(1, 1, 1200, 240),

  toolCall(1, 2, 'read_file', { path: '/tmp/a.py' }),
  toolResult(1, 2, 'def main():\n    print("hello")\n    return 42'),
  assistantMessage(1, 2, 1400, 320),

  toolCall(1, 3, 'grep', { pattern: 'TODO', path: '/src' }),
  toolResult(1, 3, 'src/main.py:12: # TODO: refactor'),
  assistantMessage(1, 3, 1600, 180),

  toolCall(1, 4, 'bash', { command: 'python a.py' }),
  toolResult(1, 4, 'hello\n42'),
  assistantMessage(1, 4, 1800, 90),
]

const watch1 = new SentinelWatch(config)
const r1 = watch1.watch(normalEvents)
field('状态', r1.state)
field('dedupRatio', r1.metrics.dedupRatio.toFixed(3))
field('infoGain', r1.metrics.infoGain.toFixed(3))
field('shouldAct', r1.shouldAct)
console.log(sig('动作签名各不相同（ls / read_file / grep / bash），去重率低 → 无干预'))

// ═════════════════════════════════════════════
// 场景 2: 死循环检测 —— SUSPECTED → CONFIRMED
// ═════════════════════════════════════════════
line('场景 2: 死循环检测（Agent 反复执行相同工具，应触发降级）')

// 第 2a 步：混入一个不同动作后，开始重复
const loopEvents = [
  toolCall(2, 1, 'bash', { command: 'ls' }),
  toolResult(2, 1, 'file1.txt  file2.txt'),
  // 连续 5 次完全相同的 bash ls —— 典型死循环
  ...[1, 2, 3, 4, 5].flatMap((i) => [
    toolCall(2, i + 1, 'bash', { command: 'ls' }),
    toolResult(2, i + 1, 'file1.txt  file2.txt'),
  ]),
]

const watch2 = new SentinelWatch(config)
const r2a = watch2.watch(loopEvents)
const r2b = watch2.watch(loopEvents) // FSM 逐调用推进，第二次才到 CONFIRMED
field('第 1 次 watch 状态', r2a.state)
field('第 2 次 watch 状态', r2b.state)
field('dedupRatio', r2b.metrics.dedupRatio.toFixed(3))
field('infoGain', r2b.metrics.infoGain.toFixed(3))
field('topSignatures', r2b.metrics.topSignatures.map((t) => t.signature).join(', '))
field('shouldAct', r2b.shouldAct)
field('actionLevel', r2b.actionLevel ?? '(无)')
field('diagnostic.trigger', r2b.diagnostic?.trigger ?? '(无)')
console.log(sig('去重率 1.0 > dedupHard 0.9，FSM 逐步推进 → CONFIRMED → 触发 L1 nudge 纠偏提示'))

// 展示 FSM 的渐进过程：SUSPECTED → CONFIRMED
console.log('\n  —— FSM 渐进过程（逐批喂事件）——')
const watch2b = new SentinelWatch(config)
let batch = [toolCall(2, 1, 'bash', { command: 'ls' }), toolResult(2, 1, 'f1')]
for (let i = 2; i <= 6; i++) {
  batch.push(toolCall(2, i, 'bash', { command: 'ls' }))
  batch.push(toolResult(2, i, 'f1'))
  const st = watch2b.watch([...batch])
  console.log(`   step ${i}: ${String(st.state).padEnd(10)} dedup=${st.metrics.dedupRatio.toFixed(2)} infoGain=${st.metrics.infoGain.toFixed(2)}`)
}

// ═════════════════════════════════════════════
// 场景 3: 工具失败重试 —— 四级降级
// ═════════════════════════════════════════════
line('场景 3: 工具失败重试（fetch 反复失败，逐级降级）')

const retryGuard = createToolRetryGuard(config)
retryGuard.registerFallback('fetch', ['curl'])
const toolCtx = { name: 'fetch', arguments: { url: 'https://api.example.com' }, callId: 'c1' }

const failResult = (name, code) => ({ isError: true, error: { name: code, code } })

// 连续失败 4 次（maxRetries=3）
for (let attempt = 1; attempt <= 4; attempt++) {
  const d = retryGuard.handleResult(toolCtx, failResult('fetch', 'ECONNREFUSED'))
  const desc = {
    retry: `重试（第 ${d.attempt}/${config.toolRetry.maxRetries} 次，退避 ${d.delay}ms）`,
    fallback: `切换备用工具 → ${d.fallbackTool}`,
    readonly: '降级为只读模式',
    block: '交还用户（放弃）',
    accept: '接受结果',
  }[d.kind]
  console.log(`   失败 #${attempt}: → ${d.kind.padEnd(8)} | ${desc}`)
}

// 换成备用工具 curl 后成功
const dOk = retryGuard.handleResult(
  { name: 'curl', arguments: { url: 'https://api.example.com' }, callId: 'c2' },
  { isError: false, content: [{ type: 'text', text: '{"status":"ok"}' }] },
)
console.log(`   curl 成功: → ${dOk.kind}（重试计数已重置）`)

// 再次失败，验证重试计数从 0 重新开始
const d2 = retryGuard.handleResult(toolCtx, failResult('fetch', 'ETIMEDOUT'))
console.log(`   再次失败: → ${d2.kind}（attempt ${d2.attempt}，从 0 重新计数）`)

// ═════════════════════════════════════════════
// 场景 4: 上下文膨胀守卫 —— 软/硬阈值
// ═════════════════════════════════════════════
line('场景 4: 上下文膨胀守卫（token 用量逼近上限）')

// 使用较小的阈值便于演示。注意：guard 是有状态的（触发一次后不再重复触发），
// 因此软/硬阈值各用独立实例演示。
const softCtxConfig = mergeConfig({
  contextGuard: { enabled: true, softTokens: 3000, hardTokens: 5000 },
})

// 软阈值场景：累计 token 在 3000~5000 之间（10 步 × 350 tokens = 3500）
const softGuard = createContextGuard(softCtxConfig)
const softEvents = Array.from({ length: 10 }, (_, i) =>
  assistantMessage(4, i + 1, 150, 200),
)
const softPayload = {
  agent: { session: { events: softEvents } },
  turn: 4,
  step: 10,
  signal: new AbortController().signal,
}
const softResult = await softGuard.handleRequest(softPayload, async () => ({
  provider: 'deepseek',
  model: 'deepseek-reasoner',
  maxTokens: 4096,
}))
field('estimatedTokens', softGuard.estimateTokens(softEvents))
field('soft 阈值返回 seed.maxTokens', softResult.seed.maxTokens)
field('soft 阈值 needsTrim', softResult.needsTrim)
console.log(sig('软阈值触发 → 生成压缩提示，将通过 agent.steer() 注入'))
console.log(`   压缩提示: "${softResult.compressionPrompt.slice(0, 60)}…"`)

// 硬阈值场景：新实例 + 更大 token 量（30 步 × 400 tokens = 12000 > 5000）
const hardGuard = createContextGuard(softCtxConfig)
const hardEvents = Array.from({ length: 30 }, (_, i) =>
  assistantMessage(4, i + 1, 200, 200),
)
const hardResult = await hardGuard.handleRequest(
  { ...softPayload, agent: { session: { events: hardEvents } }, step: 30 },
  async () => ({ provider: 'deepseek', model: 'deepseek-reasoner', maxTokens: 4096 }),
)
field('estimatedTokens', hardGuard.estimateTokens(hardEvents))
field('hard 阈值返回 seed.maxTokens', hardResult.seed.maxTokens)
field('hard 阈值 needsTrim', hardResult.needsTrim)
console.log(sig('硬阈值触发 → 限制输出 maxTokens=1024 + 标记 needsTrim（需历史裁剪）'))

// ═════════════════════════════════════════════
// 总结
// ═════════════════════════════════════════════
line('演示完成')
console.log(`
  体验到的核心能力：
    1. 三态状态机  NORMAL → SUSPECTED → CONFIRMED（死循环检测）
    2. 多级降级    去重率 → infoGain → token 斜率 三信号融合
    3. 工具重试    指数退避 → 备用工具 → 只读 → 交还用户
    4. 上下文守卫  软阈值压缩提示 + 硬阈值裁剪限制

  下一步：
    - 运行单元测试:  npm test  （58 个用例覆盖全部核心逻辑）
    - 查看代码:      src/sentinel/  src/guards/  src/actions/
    - 集成到 dsh:    配置 ~/.dsh/profiles/<profile>/cordis.patch.yml
`)
