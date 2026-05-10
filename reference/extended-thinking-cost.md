# Extended Thinking Cost

Extended thinking lets the model reason step-by-step before responding. The reasoning is real tokens, billed at the **output rate**. Most teams discover this on their first invoice.

## How it bills

| Stream | Where it counts | Rate |
|---|---|---|
| Thinking tokens | Included in `usage.output_tokens` | Output price |
| Visible response | Included in `usage.output_tokens` | Output price |

There is no separate `thinking_tokens` field on `usage`. The model sums thinking and visible content into `output_tokens`. To attribute, parse `response.content` for blocks of `type: "thinking"` and count tokens client-side, or compare `output_tokens` against the visible text's token count.

## Enabling thinking

```ts
const response = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 16000,
  thinking: { type: "enabled", budget_tokens: 10000 },
  messages: [{ role: "user", content: userQuery }],
});
```

Rules:
- `budget_tokens` must be **less than** `max_tokens`. The model can use up to `budget_tokens` for thinking; the remainder is available for the visible response.
- Setting `budget_tokens` near the model-specific minimum effectively disables deep reasoning.
- Streaming thinking is supported.
- Thinking blocks **cannot have `cache_control`** directly (see "Caching interaction" below).

## Caching interaction

Thinking blocks ride along when they appear in earlier assistant turns of a cached message history. They cannot be the cache breakpoint, but they sit inside the cached prefix.

For multi-turn agents:
- Turn 1's thinking block becomes part of the assistant content sent on turn 2.
- If turn 2's request has a cache breakpoint at or after that assistant turn, the thinking is cached and replayed at cache-read price on turn 3+.
- If your prefix changes (new tool result, new user message before the breakpoint), the cache invalidates and the prior thinking is rewritten.

Practical impact: a tool-using agent that thinks → calls tool → thinks again re-reads the prior thinking on every turn. Cache the conversation prefix deliberately or watch the output bill compound across the chain.

## Cost example: thinking is the dominant driver

Workload: 500 calls/day on `claude-sonnet-4-6`, 5K input tokens, 2K thinking budget actually used, 500 visible output tokens.

| | No thinking | With thinking |
|---|---|---|
| Input | 5,000 × $3 / 1M = $0.015 | 5,000 × $3 / 1M = $0.015 |
| Output | 500 × $15 / 1M = $0.0075 | 2,500 × $15 / 1M = $0.0375 |
| Per call | $0.023 | $0.053 |
| Per 1,000 calls | $22.50 | $52.50 |

Thinking quintupled the output portion. At 500 calls/day that's $11.25/day vs $26.25/day. Multiply by 100K calls/day and the daily delta is ~$3,000.

## When thinking earns its cost

- Multi-step planning where the visible answer is wrong without scratchwork
- Math, code, and structured reasoning where Sonnet without thinking fails your eval
- Cases where Opus-without-thinking would also be required — Sonnet 4.6 + thinking can substitute for Opus 4.7 on some tasks at lower per-call cost

## When it does not

- Classification, extraction, simple drafting
- Anything Haiku 4.5 already passes
- Latency-sensitive UX (thinking adds wall-clock time roughly proportional to budget)

## Quick decision

| Signal | Move |
|---|---|
| Eval pass rate jumps when thinking is on | Keep it on; tune `budget_tokens` to the smallest value that holds the win |
| Eval pass rate is unchanged | Turn it off; you are paying output-rate for noise |
| Latency budget is tight | Off, or budget_tokens at the floor |

> **Verify against:** [platform.claude.com/docs/en/build-with-claude/extended-thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
