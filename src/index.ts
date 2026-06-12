/**
 * skill-stats — Skill 调用频率统计插件
 *
 * 每个 skill() 调用 → jsonl 流水日志
 * /skillstats 查询 → 格式化 ASCII 表格（含 [removed] 标记）
 *
 * 文件:
 *   ~/.config/opencode/skill-stats.jsonl          ← 流水日志（最长 1000 条）
 *   ~/.config/opencode/skill-stats.json            ← 配置（可选）
 *   ~/.config/opencode/skill-stats-registry.json   ← 文件系统快照（自动维护）
 */

import { type Plugin, tool } from "@opencode-ai/plugin"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const BASE = join(homedir(), ".config", "opencode")
const LOG_PATH = join(BASE, "skill-stats.jsonl")
const CONFIG_PATH = join(BASE, "skill-stats.json")
const REGISTRY_PATH = join(BASE, "skill-stats-registry.json")
const MAX_RECORDS = 1_000

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

interface Config {
  default_period: string
}

const DEFAULT_CONFIG: Config = {
  default_period: "week",
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) }
    }
  } catch {
    /* use defaults */
  }
  return DEFAULT_CONFIG
}

// ---------------------------------------------------------------------------
// 记录（jsonl 追写）
// ---------------------------------------------------------------------------

interface SkillRecord {
  ts: string
  skill: string
  sessionID: string
}

function ensureBase() {
  if (!existsSync(BASE)) mkdirSync(BASE, { recursive: true })
}

function recordCall(skill: string, sessionID: string) {
  try {
    ensureBase()
    const line = JSON.stringify({ ts: new Date().toISOString(), skill, sessionID }) + "\n"
    appendFileSync(LOG_PATH, line, "utf-8")
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// 日志裁剪（保留最近 MAX_RECORDS 条）
// ---------------------------------------------------------------------------

function trimLog() {
  try {
    if (!existsSync(LOG_PATH)) return
    const raw = readFileSync(LOG_PATH, "utf-8").trim()
    if (!raw) return
    const lines = raw.split("\n")
    if (lines.length <= MAX_RECORDS) return
    const trimmed = lines.slice(lines.length - MAX_RECORDS).join("\n") + "\n"
    writeFileSync(LOG_PATH, trimmed, "utf-8")
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// 文件系统扫描 → 当前有哪些 skill
// ---------------------------------------------------------------------------

const SKILL_DIRS = [
  join(BASE, "skills"),
  join(homedir(), ".agents", "skills"),
  join(homedir(), ".claude", "skills"),
]

function scanActiveSkills(): string[] {
  const found = new Set<string>()
  for (const dir of SKILL_DIRS) {
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md"))) {
          found.add(e.name)
        }
      }
    } catch {
      /* skip unreadable dir */
    }
  }
  return [...found]
}

// ---------------------------------------------------------------------------
// Registry（快照持久化）
// ---------------------------------------------------------------------------

interface RegSkill {
  status: "active" | "removed"
  last_seen: string
}

interface Registry {
  scanned_at: string
  known: Record<string, RegSkill>
}

function loadRegistry(): Registry {
  try {
    if (existsSync(REGISTRY_PATH)) {
      return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"))
    }
  } catch {
    /* start fresh */
  }
  return { scanned_at: "", known: {} }
}

function saveRegistry(reg: Registry) {
  try {
    ensureBase()
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), "utf-8")
  } catch {
    /* silent */
  }
}

function syncRegistry(): Registry {
  const reg = loadRegistry()
  const active = new Set(scanActiveSkills())
  const now = new Date().toISOString()

  for (const name of active) {
    const cur = reg.known[name]
    if (!cur) {
      reg.known[name] = { status: "active", last_seen: now }
    } else if (cur.status === "removed") {
      reg.known[name] = { status: "active", last_seen: now }
    }
  }

  for (const [name, info] of Object.entries(reg.known)) {
    if (info.status === "active" && !active.has(name)) {
      reg.known[name] = { status: "removed", last_seen: now }
    }
  }

  reg.scanned_at = now
  saveRegistry(reg)
  return reg
}

// ---------------------------------------------------------------------------
// 查询 + 格式化
// ---------------------------------------------------------------------------

function loadRecords(): SkillRecord[] {
  try {
    if (!existsSync(LOG_PATH)) return []
    const raw = readFileSync(LOG_PATH, "utf-8").trim()
    if (!raw) return []
    return raw
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as SkillRecord
        } catch {
          return null
        }
      })
      .filter(Boolean) as SkillRecord[]
  } catch {
    return []
  }
}

function periodStart(period: string): Date {
  const now = new Date()
  switch (period) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    case "week": {
      const d = new Date(now)
      d.setDate(d.getDate() - 7)
      return d
    }
    case "month": {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 1)
      return d
    }
    case "all":
      return new Date(0)
    default: {
      const m = period.match(/^last:(\d+)d$/)
      if (m) {
        const d = new Date(now)
        d.setDate(d.getDate() - parseInt(m[1], 10))
        return d
      }
      return periodStart("week")
    }
  }
}

function formatTable(records: SkillRecord[], period: string, reg: Registry): string {
  const start = periodStart(period)
  const filtered = records.filter((r) => new Date(r.ts) >= start)
  const total = filtered.length

  const counts = new Map<string, number>()
  for (const r of filtered) {
    counts.set(r.skill, (counts.get(r.skill) ?? 0) + 1)
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])

  const lines: string[] = []
  lines.push(`Skill 调用统计  (${period})`)
  lines.push("─".repeat(48))

  if (sorted.length === 0) {
    lines.push("  (无记录)")
  } else {
    const maxCount = sorted[0][1]
    const barWidth = 28

    for (const [name, count] of sorted) {
      const pct = ((count / total) * 100).toFixed(0)
      const barLen = Math.round((count / maxCount) * barWidth)
      const bar = "█".repeat(Math.max(1, barLen))
      const label = `${name.padEnd(10)} ${bar} ${String(count).padStart(4)}次 ${pct.padStart(2)}%`

      const info = reg.known[name]
      if (info?.status === "removed") {
        lines.push(`  [removed] ${name.padEnd(10)} ${bar} ${String(count).padStart(4)}次 ${pct.padStart(2)}%`)
      } else {
        lines.push(`  ${label}`)
      }
    }
  }

  lines.push("─".repeat(48))
  lines.push(`  总计: ${total} 次  |  收录 skill: ${Object.values(reg.known).filter((s) => s.status === "active").length} 个`)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

const SkillStatsPlugin: Plugin = async () => {
  const config = loadConfig()
  ensureBase()

  return {
    // 每次 tool 执行完毕 → 捕获 skill() 调用
    "tool.execute.after": async (input: {
      tool: string
      sessionID: string
      args?: Record<string, unknown>
    }) => {
      if (input.tool !== "skill") return
      const skillName = (input.args?.name as string) ?? "?"
      recordCall(skillName, input.sessionID)
    },

    // 注入指令说明，让 LLM 知道有统计功能
    "experimental.chat.system.transform": async (
      _input: unknown,
      output: { system?: unknown[] },
    ) => {
      const msg =
        '- 用户说"skill统计"、"调用统计"、"查看skill"或输入 /skill-stats → 调用 skill_stats tool。'
      if (
        Array.isArray(output.system) &&
        !output.system.some((s: any) => typeof s === "string" && s.includes("skill_stats"))
      ) {
        output.system.push(msg)
      }
    },

    // 自定义查询工具
    tool: {
      skill_stats: tool({
        description:
          "查询 skill 调用频率统计。支持时间窗口: today, week, month, all, last:Nd（如 last:30d）。",
        args: {
          period: tool.schema
            .string()
            .optional()
            .describe("时间窗口：today / week / month / all / last:Nd"),
        },
        async execute(args: { period?: string }) {
          const period = args.period ?? config.default_period
          trimLog()
          const records = loadRecords()
          const reg = syncRegistry()
          return formatTable(records, period, reg)
        },
      }),
    },
  }
}

export default SkillStatsPlugin
