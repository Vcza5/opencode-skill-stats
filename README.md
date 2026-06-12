# opencode-skill-stats

[![CI](https://github.com/Vcza5/opencode-skill-stats/actions/workflows/ci.yml/badge.svg)](https://github.com/Vcza5/opencode-skill-stats/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Track and visualize **skill invocation frequency** across your OpenCode sessions. Automatically discovers installed skills, logs every `skill()` call, and renders an ASCII bar chart on demand.

```
Skill 调用统计  (week)
────────────────────────────────────────────────
  bilibili    ████████████████████████████  42次 41%
  pdf         ████████████████             26次 25%
  docx        ██████                       10次 10%
  xlsx        █████                        8次  8%
  mcp-builder ████                         7次  7%
  mcp-nutstore ███                         5次  5%
  [removed] chrome-cdp █                   2次  2%
────────────────────────────────────────────────
  总计: 100 次  |  收录 skill: 12 个
```

## Features

- **Automatic tracking** — each `skill()` call is logged with timestamp and session ID
- **Flexible time windows** — `today`, `week`, `month`, `all`, or custom `last:Nd`
- **File system scan** — auto-discovers installed skills from standard directories
- **Removed detection** — marks skills that were previously installed but have been removed
- **Zero-config** — works out of the box, optional config file for customization
- **Automatic log trimming** — keeps the last 1000 records to prevent unbounded growth

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-skill-stats"]
}
```

Restart OpenCode. The plugin registers a `/skill-stats` command and the `skill_stats` tool.

## Usage

### Via slash command

```
/skill-stats           → show stats for default period (configurable, default: week)
/skill-stats month     → show stats for the last 30 days
/skill-stats last:7d   → show stats for the last 7 days
/skill-stats all       → show all-time stats
```

### Via AI prompt

Say "统计 skill 调用" or "查看 skill 使用情况" — the AI will call the `skill_stats` tool automatically.

## Configuration (optional)

Create `~/.config/opencode/skill-stats.json`:

```json
{
  "default_period": "week"
}
```

Supported periods: `today`, `week`, `month`, `all`, `last:Nd`

## How it works

1. **Logging**: The plugin hooks into `tool.execute.after`, intercepts `skill()` calls, and writes a JSONL record to `~/.config/opencode/skill-stats.jsonl`
2. **Discovery**: On query, it scans standard skill directories (`~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.claude/skills/`) and maintains a persistent registry snapshot
3. **Query**: Filters records by time window, groups by skill name, sorts by frequency, and renders an ASCII bar chart

## Data files

| File | Purpose |
|------|---------|
| `~/.config/opencode/skill-stats.jsonl` | Rolling log (max 1000 entries) |
| `~/.config/opencode/skill-stats.json` | Optional user config |
| `~/.config/opencode/skill-stats-registry.json` | Auto-maintained skill snapshot |

## License

MIT
