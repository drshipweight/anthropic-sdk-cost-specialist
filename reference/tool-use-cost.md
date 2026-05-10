# Tool Use Cost

Tool definitions cost real input tokens on every call. Tool results travel as input on the next call. Long tool chains compound the bill quickly.

## What costs what

| Component | Where it lives | How it bills |
|---|---|---|
| Tool definitions (`tools` array) | Sent on every request | Counts as input tokens |
| Tool calls in assistant response | `usage.output_tokens` | Output rate |
| Tool result content (next turn) | `messages.content` of role `user`, blocks of type `tool_result` | Input rate |
| Server-side tool runs | `usage.server_tool_use.*` | Per-use rate, on top of token cost |

Concrete: a `tools` array that serializes to 2,000 input tokens, sent on 10,000 calls/day, costs $60/day on Sonnet 4.6 (2,000 × 10,000 = 20M tokens × $3 / 1M) — for content that never changes between calls. Cache it.

## Cache tool definitions

`cache_control` on the **last** item in the `tools` array caches the entire `tools` block as part of the request prefix.

```ts
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: [
    { name: "search_db",    description: "...", input_schema: { /* ... */ } },
    { name: "run_query",    description: "...", input_schema: { /* ... */ } },
    {
      name: "write_report",
      description: "...",
      input_schema: { /* ... */ },
      cache_control: { type: "ephemeral" }, // breakpoint at end of tools
    },
  ],
  messages: [{ role: "user", content: userQuery }],
});
```

Two things to know:
- The breakpoint goes on the **last** tool you want inside the cached prefix. Order matters: most-stable last, least-stable earlier.
- Tool definitions count toward the model's minimum cacheable size. A 1K-token tools array on Opus 4.7 (4,096-token minimum) is silently uncached unless combined with stable system content above it. See `prompt-caching-cheatsheet.md`.

## The full request prefix order

```
tools  →  system  →  messages
```

A breakpoint earlier in this order caches less; a breakpoint later caches more.

| Breakpoint location | What gets cached |
|---|---|
| End of `tools` | Tools only |
| End of `system` | Tools + system |
| Inside a `messages` content block | Everything before that block, in order |

If your `tools` and `system` are both stable, put the breakpoint at end-of-system to cache both with one slot. If `tools` is stable but `system` changes, put the breakpoint at end-of-tools.

## Tool results compound on the next turn

Each round of tool use means the next request includes the prior tool calls and tool results in `messages`. A 5-tool-call chain with 2K-token results each is 10K extra input tokens on turn 2, 20K+ on turn 3, and so on.

Mitigations:
- Cap chain length at 3-5 turns where the workload allows.
- Use Haiku 4.5 for tool-routing turns when reasoning is light; reserve Sonnet/Opus for the steps that need it.
- For long-running agents, summarize prior tool history and reset rather than letting `messages` grow unbounded.
- Cache the conversation prefix at a stable point (e.g., the system prompt + initial user message) so the unchanging head of the chain reads from cache on every turn.

## `tool_choice` and cost predictability

| `tool_choice` | What happens | Cost shape |
|---|---|---|
| `auto` (default) | Model picks whether to use a tool | Variable; sometimes one call, sometimes a chain |
| `any` | Model must use one of the provided tools | At least one tool round |
| `{ type: "tool", name: "X" }` | Model must use tool X | One forced call |
| `none` | Model produces text only | No tool round |

If you need predictable per-call cost, force the choice or set `none` and post-process. `auto` is the most flexible but the least predictable.

## Server-side tools bill separately

| Tool | Per-use cost | `usage` field |
|---|---|---|
| Web search | $10 / 1,000 searches + tokens | `usage.server_tool_use.web_search_requests` |
| Code execution | Per-run rate; verify on docs | `usage.server_tool_use.code_execution_requests` |
| Web fetch | Tokens only, no per-fetch fee | `usage.server_tool_use.web_fetch_requests` |

Server-side tool *invocations* are not cached. The text the model produces around them flows through normal caching, but the per-search / per-execution charge fires every time.

## Quick antipattern check

| Smell | Fix |
|---|---|
| `tools` array sent on every call, no `cache_control` | Add a breakpoint on the last tool definition |
| Tool definitions live in the `system` string instead of `tools` | Move them to `tools` so the SDK can structure and cache them properly |
| Agent loop with no message-history truncation | Cap chain length, summarize, or both |
| Web search wrapped around a question caching could answer | Decide which problem you're solving — caching a stable knowledge base beats searching the web every call |

> **Verify against:** [platform.claude.com/docs/en/agents-and-tools/tool-use/overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) and [platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
