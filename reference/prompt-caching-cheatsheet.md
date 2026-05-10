# Prompt Caching Cheatsheet

The smallest reference that lets you make caching decisions correctly. Pair with `pricing-snapshot.md` for cost math and `usage-fields-reference.md` for telemetry.

## What can be cached

`cache_control: { type: "ephemeral" }` is allowed on:

- **System messages** — content blocks in the `system` array
- **Tool definitions** — items in the `tools` array
- **Text messages** — content blocks in `messages.content` (user and assistant turns)
- **Images and documents** — content blocks in `messages.content` on user turns
- **Tool use and tool results** — content blocks in `messages.content` on either role

Cannot be cached directly:

- **Thinking blocks** (cannot have `cache_control`, but they ride along when they appear in earlier assistant turns of a cached message history — see `extended-thinking-cost.md` for the cost shape)

For tool-specific caching patterns (where the breakpoint goes in the `tools` array, the `tools → system → messages` prefix order, and how tool result blocks compound on each turn), see `tool-use-cost.md`. For caching file references uploaded via the Files API, see `files-api-cost.md`.

## Two ways to enable caching

**Automatic caching.** Add a single `cache_control` at the top level of the request. Anthropic manages breakpoints as the conversation grows. Best default for chat-style applications. Uses one of the four breakpoint slots.

**Explicit cache breakpoints.** Place `cache_control` directly on the content blocks you want to mark as a cache boundary. Required when you want to cache tools, mix TTLs, or layer breakpoints onto stable system content. Up to **4 breakpoints** per request.

## Minimum cacheable size (model-specific)

Content shorter than the threshold is silently not cached. **No error is returned** — the request just runs without caching.

| Model                                       | Minimum tokens to cache |
| ------------------------------------------- | ----------------------- |
| Claude Opus 4.7 / 4.6 / 4.5                 | 4,096                   |
| Claude Sonnet 4.6                           | 2,048                   |
| Claude Sonnet 4.5 / 4 / Opus 4.1 / Opus 4   | 1,024                   |
| Claude Haiku 4.5                            | 4,096                   |
| Claude Haiku 3.5 (retired 2026-02-19)       | 2,048                   |

If a stable block is below the threshold, do not bother caching it. Either bulk it up with related stable content (tool docs, glossary, format examples) or accept the uncached cost.

## TTL options

| TTL    | Syntax                                                | Cache write multiplier | Break-even reads in window |
| ------ | ----------------------------------------------------- | ---------------------- | -------------------------- |
| 5 min  | `{ "cache_control": { "type": "ephemeral" } }`        | 1.25× input            | 1                          |
| 1 hour | `{ "cache_control": { "type": "ephemeral", "ttl": "1h" } }` | 2× input         | 2                          |

Default to 5-minute. Switch to 1-hour only when traffic is sparse-but-spread (eval runs across the day, asynchronous batch-style work where calls are minutes apart). For dense traffic, the 5-minute write keeps refreshing on every call anyway.

## Ordering rule

A breakpoint caches **everything before it in the request, in order**. So:

1. Most-volatile content first (per-call user input, fresh state).
2. Most-stable content last, immediately followed by the breakpoint.

This is the opposite of how most people draft a prompt. Reorder.

## Cache write happens once. Then it's the read price.

| Call # | What happens                              | What you pay                 |
| ------ | ----------------------------------------- | ---------------------------- |
| 1      | Cache miss → write the cache              | Base input + write multiplier|
| 2..N   | Cache hit → read the cache                | 0.1× input on the cached prefix |
| Exit TTL window without a hit | Cache eviction; next call writes again | Repeat call 1 |

Plan for a refresh cadence that keeps the cache warm. Within the 5-minute TTL, every cache hit refreshes the timer.

## Multiple breakpoints

You can layer breakpoints to cache nested levels of stability:

```ts
system: [
  // Volatile — variant prompt for this experiment
  {
    type: "text",
    text: variantPrompt,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
  // Stable — domain dictionary, identical across all calls
  {
    type: "text",
    text: domainDictionary,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
],
```

In this shape:
- Breakpoint #2 (after the dictionary) caches the variant + dictionary together.
- When the variant changes, breakpoint #1 changes but breakpoint #2's prefix becomes invalid for that variant.
- For variants that recur, both breakpoints hit.

The right number of breakpoints depends on how many independent levels of stability your prompt actually has. Most production systems use 1-2. Three or more is rare.

## Verifying caching is working

Check `response.usage` after the second call:

- `cache_read_input_tokens` should be > 0 (cache hit)
- `cache_creation_input_tokens` should be 0 on warm calls (no re-write)
- `input_tokens` should reflect only post-breakpoint content

If `cache_creation_input_tokens` is high on every call, the prefix is changing — usually because volatile content is sitting before the breakpoint.

> **Verify against:** [platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
