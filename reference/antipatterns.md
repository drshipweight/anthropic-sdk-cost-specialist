# Antipatterns

Mistakes that show up over and over in real Claude API code. Each one names the antipattern, why it costs money or breaks correctness, and the fix.

## 1. Caching content under the model's minimum size

**What it looks like:** A `cache_control: { type: "ephemeral" }` on a 600-token system prompt for `claude-opus-4-7`.

**Why it's wrong:** Opus 4.7 requires 4,096 tokens of cacheable content. Below that, the request runs without caching and no error is returned. You think you're caching; you're not.

**Fix:** Either bulk up the cached block (combine related stable content like tools, dictionaries, format examples), drop down to a model with a lower threshold (Sonnet 4.5 caches at 1,024), or accept that this content is too small to cache.

## 2. Volatile content placed before the cache breakpoint

**What it looks like:** Per-request user input or fresh state appears in the `system` array before the `cache_control` block.

**Why it's wrong:** A breakpoint caches everything before it in order. If volatile content sits before the breakpoint, the cache key changes on every call, so you pay the write cost on every call and never hit the cache. `cache_creation_input_tokens` will be high on every response.

**Fix:** Reorder. Volatile content first (no cache), stable content immediately followed by the breakpoint last. The breakpoint goes at the end of stable content, not the start.

## 3. Treating the first call's cost as your steady-state cost

**What it looks like:** Benchmarking with one call, seeing `cache_creation_input_tokens` non-zero, multiplying by the base input price, and reporting that as "Claude API cost."

**Why it's wrong:** First call pays the write multiplier (1.25× input for 5-minute TTL or 2× for 1-hour). Calls 2..N pay the read price (0.1× input). If you only measure call 1, your estimate is between 12.5× and 20× too high for the cached portion.

**Fix:** Run at least 10 calls within the TTL window. Average the per-call cost over calls 2..N for steady-state. Report the first-call cost separately as cache warm-up cost.

## 4. Picking Opus where Sonnet would pass

**What it looks like:** "We're using Claude, so we picked Opus to be safe."

**Why it's wrong:** Opus 4.7 is 1.67× the price of Sonnet 4.6 on input and output. On a workload that runs 2M tokens in / 200K tokens out per day, that's $10/day vs $6/day on input and $5/day vs $3/day on output — $6/day, ~$2,200/year, on a single workload. Multiply by every workload that doesn't need Opus.

**Fix:** Default to Sonnet 4.6. Run your eval set against both. Move to Opus only if the gap on the eval is real and worth the price.

## 5. Same model for system-under-test and judge

**What it looks like:** Using Sonnet to draft answers and Sonnet to grade those same answers in your eval pipeline.

**Why it's wrong:** Self-grading bias. The judge will rate the SUT's mistakes higher than they deserve because the judge would have made the same mistakes. Eval scores look better than reality and you ship under-tested.

**Fix:** Use Opus 4.7 (or any clearly stronger model) as the judge while Sonnet is the SUT. The judge does not need to be cheap because it runs once per test row, not in production traffic.

## 6. Splitting one stable block into many cache breakpoints

**What it looks like:** Three `cache_control` markers on three consecutive system blocks that always change together.

**Why it's wrong:** You're using cache breakpoint slots without buying yourself any flexibility. The 4-breakpoint limit is real; squandering them on co-changing content blocks the door for legitimate layering later.

**Fix:** One breakpoint per independent level of stability. If two blocks always change together, they share one breakpoint at the end of the second block.

## 7. Wrapping the SDK in another framework

**What it looks like:** Vercel AI SDK, LangChain, LiteLLM, or a homegrown router sitting between your code and `@anthropic-ai/sdk`.

**Why it's wrong:** Caching, model-specific features, and `usage` field shape change shape under the wrapper. You lose precise control over `cache_control` placement, lose visibility into `cache_creation` breakdowns, and lose the ability to set the 1-hour TTL or pass the right model IDs cleanly. You also pay a maintenance tax tracking each wrapper's update cycle for new Anthropic features.

**Fix:** Use `@anthropic-ai/sdk` (TypeScript) or `anthropic` (Python) directly. Build the thin abstraction layer your app actually needs on top of that. Most of these wrappers earn their keep when you're calling many providers; if you're a Claude shop, drop them.

## 8. Reporting `input_tokens` as total input

**What it looks like:** Cost dashboards that read `usage.input_tokens` and call it the input bill.

**Why it's wrong:** `input_tokens` is the post-breakpoint, fresh portion only. Cached input is in `cache_read_input_tokens`. Newly-written cache is in `cache_creation_input_tokens`. If you only sum `input_tokens`, your dashboard under-reports the input side and your cache-hit-rate calculation is wrong.

**Fix:** Compute total input as `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`. Track the three separately so you can see the cache hit ratio over time.

## 9. Caching `tools` only

**What it looks like:** A `cache_control` on the last tool definition, but the long static system prompt right after has none.

**Why it's wrong:** A breakpoint at the end of `tools` does cache the tools, but the system prompt right after it is not in the cached prefix. If the system prompt is large and stable, you're leaving 80%+ of your savings on the floor.

**Fix:** Move the breakpoint to the end of the stable system content if the system prompt is the bigger and equally stable block. Or use two breakpoints: one at end-of-tools, one at end-of-system. Just make sure the stable content sits before its breakpoint.

## 10. Setting the 1-hour TTL by default

**What it looks like:** Every request uses `cache_control: { type: "ephemeral", ttl: "1h" }`.

**Why it's wrong:** 1-hour write costs 2× the base input price (vs 1.25× for 5-minute). 1-hour pays off only after 2 cache reads in the window. If your traffic is dense (>1 read every 5 minutes), the 5-minute TTL refreshes on every hit and is strictly cheaper.

**Fix:** Default to 5-minute. Switch to 1-hour only when you have evidence of sparse-but-spread traffic (eval batches, async processing across the day). Measure cache-hit rate before changing TTL strategy.

> **Verify against:** [platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
