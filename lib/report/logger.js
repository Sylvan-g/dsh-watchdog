/**
 * JSONL 结构化日志
 *
 * 将守卫事件追加写入 JSONL 文件（~/.dsh/watchdog/events.jsonl），
 * 作为 web 面板的数据源。
 *
 * 修复：
 * - C2: 使用 createRequire 替代 ESM 中的 require，兼容 Node ESM 运行时
 * - M4: 使用 USERPROFILE（Windows）或 HOME（Unix）获取主目录
 * - M2: logToolRetry result 参数扩展为支持重试/降级状态
 */
import { createRequire } from 'node:module';
/**
 * 获取用户主目录（兼容 Windows 和 Unix）
 */
function getHomeDir() {
    if (typeof process !== 'undefined') {
        return process.env.USERPROFILE || process.env.HOME || '~';
    }
    return '~';
}
/**
 * 惰性加载 Node.js fs/path 模块（ESM 兼容）
 *
 * 使用 createRequire 替代 ESM 中不可用的全局 require。
 * 在浏览器环境或加载失败时回退到 console 输出。
 */
let _nodeModules = null;
let _nodeModulesLoaded = false;
function getNodeModules() {
    if (_nodeModulesLoaded)
        return _nodeModules;
    _nodeModulesLoaded = true;
    try {
        if (typeof process !== 'undefined' && process.versions?.node) {
            // ESM 兼容：createRequire 是 ESM 中获取 require 的标准方式
            const req = createRequire(import.meta.url);
            const fs = req('node:fs');
            const path = req('node:path');
            _nodeModules = { fs, path };
        }
    }
    catch {
        // ESM 环境下 require 不可用时，标记为不可用
        _nodeModules = null;
    }
    return _nodeModules;
}
/**
 * 创建 JSONL 日志写入器
 *
 * @param filePath 日志文件路径，默认 ~/.dsh/watchdog/events.jsonl
 * @returns 写入函数
 */
export function createLogger(filePath) {
    // 惰性计算路径（首次写入时确定，避免模块加载时的副作用）
    let resolvedPath = null;
    function getResolvedPath() {
        if (resolvedPath)
            return resolvedPath;
        if (filePath) {
            resolvedPath = filePath;
            return resolvedPath;
        }
        const mods = getNodeModules();
        if (mods) {
            resolvedPath = mods.path.join(getHomeDir(), '.dsh', 'watchdog', 'events.jsonl');
        }
        else {
            resolvedPath = '/tmp/dsh-watchdog/events.jsonl';
        }
        return resolvedPath;
    }
    let dirEnsured = false;
    function ensureDir() {
        if (dirEnsured)
            return;
        const mods = getNodeModules();
        if (mods) {
            try {
                mods.fs.mkdirSync(mods.path.dirname(getResolvedPath()), { recursive: true });
                dirEnsured = true;
            }
            catch {
                // 目录创建失败不阻塞
            }
        }
    }
    /**
     * 追加写入一条日志
     */
    function append(entry) {
        const line = JSON.stringify(entry) + '\n';
        const mods = getNodeModules();
        if (mods) {
            try {
                ensureDir();
                mods.fs.appendFileSync(getResolvedPath(), line, 'utf-8');
            }
            catch {
                // 写入失败不阻塞主流程
                if (typeof console !== 'undefined') {
                    console.error('[watchdog] Failed to write log entry:', entry.type);
                }
            }
        }
        else {
            // 浏览器环境 fallback：写入 console
            if (typeof console !== 'undefined') {
                console.log('[watchdog]', line.trim());
            }
        }
    }
    /**
     * 记录状态变化事件
     */
    function logStateChange(sessionId, fromState, toState, snapshot) {
        append({
            timestamp: Date.now(),
            sessionId,
            type: 'loop-guard:state-change',
            data: {
                from: fromState,
                to: toState,
                metrics: snapshot.metrics,
                stalledSteps: snapshot.stalledSteps,
            },
        });
    }
    /**
     * 记录确认事件（CONFIRMED）
     */
    function logConfirmed(sessionId, snapshot) {
        append({
            timestamp: Date.now(),
            sessionId,
            type: 'loop-guard:confirmed',
            data: {
                state: snapshot.state,
                metrics: snapshot.metrics,
                trigger: snapshot.trigger,
                stalledSteps: snapshot.stalledSteps,
            },
        });
    }
    /**
     * 记录工具重试
     *
     * @param result 'success' | 'failed' | 'retrying' | 'fallback' | 'readonly'
     */
    function logToolRetry(sessionId, tool, attempt, result, backoffMs) {
        let type;
        if (result === 'success' || result === 'failed') {
            type = attempt >= 3 ? 'tool-retry:exhausted' : 'tool-retry:attempt';
        }
        else if (result === 'fallback') {
            type = 'tool-retry:fallback';
        }
        else if (result === 'readonly') {
            type = 'tool-retry:readonly';
        }
        else {
            type = 'tool-retry:attempt';
        }
        append({
            timestamp: Date.now(),
            sessionId,
            type,
            data: { tool, attempt, result, backoffMs },
        });
    }
    /**
     * 记录上下文守卫触发
     */
    function logContextGuard(sessionId, threshold, tokenCount) {
        append({
            timestamp: Date.now(),
            sessionId,
            type: threshold === 'soft' ? 'context-guard:soft-threshold' : 'context-guard:hard-threshold',
            data: { threshold, tokenCount },
        });
    }
    /**
     * 记录动作链执行
     */
    function logAction(sessionId, level, result) {
        const typeMap = {
            nudge: 'action:nudge',
            downgrade: 'action:downgrade',
            stop: 'action:stop',
        };
        append({
            timestamp: Date.now(),
            sessionId,
            type: typeMap[level],
            data: { level, result },
        });
    }
    return { append, logStateChange, logConfirmed, logToolRetry, logContextGuard, logAction };
}
/** 默认日志写入器 */
export const logger = createLogger();
//# sourceMappingURL=logger.js.map