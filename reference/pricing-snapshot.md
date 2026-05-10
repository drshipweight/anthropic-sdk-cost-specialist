# Pricing Snapshot

> **Snapshot date: 2026-05-09.** Verify against [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) before any billing decision. Anthropic updates this page; the specialist must re-quote from the live source for high-stakes estimates.

All prices are USD per million tokens (`MTok`).

## Active models

| Model               | Model ID (current)        | Input | 5m Cache Write | 1h Cache Write | Cache Read | Output |
| ------------------- | ------------------------- | ----- | -------------- | -------------- | ---------- | ------ |
| Claude Opus 4.7     | `claude-opus-4-7`         | $5    | $6.25          | $10            | $0.50      | $25    |
| Claude Opus 4.6     | `claude-opus-4-6`         | $5    | $6.25          | $10            | $0.50      | $25    |
| Claude Opus 4.5     | `claude-opus-4-5`         | $5    | $6.25          | $10            | $0.50      | $25    |
| Claude Sonnet 4.6   | `claude-sonnet-4-6`       | $3    | $3.75          | $6             | $0.30      | $15    |
| Claude Sonnet 4.5   | `claude-sonnet-4-5`       | $3    | $3.75          | $6             | $0.30      | $15    |
| Claude Haiku 4.5    | `claude-haiku-4-5`        | $1    | $1.25          | $2             | $0.10      | $5     |

## Legacy models

Status as of the snapshot date. **Active** = supported and callable. **Deprecated** = still callable but past end-of-life. **Retired** = no longer callable; pricing kept for historical reference only. Verify current status against the [deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations) before relying on a legacy model.

| Model           | Model ID                  | Status (2026-05-09)               | Input | 5m Cache Write | 1h Cache Write | Cache Read | Output |
| --------------- | ------------------------- | --------------------------------- | ----- | -------------- | -------------- | ---------- | ------ |
| Claude Opus 4.1 | `claude-opus-4-1-20250805`| Active                            | $15   | $18.75         | $30            | $1.50      | $75    |
| Claude Opus 4   | `claude-opus-4-20250514`  | Deprecated; retires 2026-06-15    | $15   | $18.75         | $30            | $1.50      | $75    |
| Claude Sonnet 4 | `claude-sonnet-4-20250514`| Deprecated; retires 2026-06-15    | $3    | $3.75          | $6             | $0.30      | $15    |
| Claude Haiku 3.5| `claude-haiku-3-5`        | Retired 2026-02-19 (not callable) | $0.80 | $1             | $1.60          | $0.08      | $4     |

> **Pricing ratio at the current frontier (2026-05-09):** Opus 4.7 input is ~1.67× Sonnet 4.6 ($5 vs $3); Opus 4.7 output is ~1.67× Sonnet 4.6 ($25 vs $15). Sonnet 4.6 input is 3× Haiku 4.5 ($3 vs $1); Sonnet 4.6 output is 3× Haiku 4.5 ($15 vs $5). The Opus 4.6→4.7 transition kept pricing flat. The Opus 4.1→4.5 transition cut prices ~3×.

## Cache pricing math

Multipliers from base input price:

| Operation             | Multiplier | Why it matters                                      |
| --------------------- | ---------- | --------------------------------------------------- |
| 5-minute cache write  | 1.25×      | Pays off after **1** cache read in the TTL window  |
| 1-hour cache write    | 2×         | Pays off after **2** cache reads in the TTL window |
| Cache read            | 0.1×       | 90% input savings on every hit                      |

**Break-even rule of thumb.** If you expect ≥1 cache hit within 5 minutes of the write, use the 5-minute TTL (default). If expected hits are sparse but spread across an hour, the 1-hour TTL pays off after 2 hits and is cheaper than re-writing the 5-minute cache repeatedly.

## Batch API discount

50% off both input and output (cache pricing also applies on top). Use for non-time-sensitive workloads. Output of `claude-sonnet-4-6` via Batch is $7.50/MTok instead of $15.

## Worked example: 1,000-call workload

Workload: 1,000 calls. Each call has 8,000 input tokens (6,000 stable system + 2,000 variable user content) and 800 output tokens. Model: `claude-sonnet-4-6`.

**No caching:**
- Input: 1,000 × 8,000 × $3 / 1,000,000 = $24.00
- Output: 1,000 × 800 × $15 / 1,000,000 = $12.00
- **Total: $36.00**

**With caching on the 6,000-token stable system block (5-minute TTL, full hit on calls 2-1,000):**
- Cache write (call 1): 6,000 × $3.75 / 1,000,000 = $0.0225
- Cache reads (calls 2-1,000): 999 × 6,000 × $0.30 / 1,000,000 = $1.798
- Uncached input: 1,000 × 2,000 × $3 / 1,000,000 = $6.00
- Output: 1,000 × 800 × $15 / 1,000,000 = $12.00
- **Total: $19.82** — 45% reduction

This assumes calls 2-1,000 land within the TTL window. Cache misses cost the full input price plus a fresh write.

> **Verify against:** [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
