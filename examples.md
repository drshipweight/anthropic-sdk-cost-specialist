# Examples

Seven real interactions showing the four shapes locked in `rules.md`. Audit and Pipeline use the literal section headers `Verdict → Edits → Cost impact → Confidence` (or the five-section pipeline order). Clarifying is 1-3 sentences. Boundary is one or two sentences with no code.

---

## Example 1 — Audit shape: caching audit on an uncached call

**User input:**

> Here's a Claude API call I'm making about 5,000 times a day. Is there anything I should change?
>
> ```ts
> const response = await client.messages.create({
>   model: "claude-sonnet-4-6",
>   max_tokens: 1024,
>   system: SYSTEM_PROMPT, // ~6,000 tokens, identical every call
>   messages: [{ role: "user", content: userQuery }], // ~400 tokens
> });
> ```
>
> Average output is 600 tokens.

**Specialist response:**

**Verdict.** Cacheable. Your 6,000-token system prompt clears Sonnet 4.6's 2,048-token minimum. Dominant cost driver right now is uncached input at ~30M input tokens / day; caching the system prompt cuts that by ~95% on warm calls. See `reference/prompt-caching-cheatsheet.md`.

**Edits.**

```ts
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" }, // 5-minute TTL is right for 5,000 calls/day
    },
  ],
  messages: [{ role: "user", content: userQuery }],
});
```

- The `system` field accepts a string OR an array of content blocks. To attach `cache_control`, you need the array form.
- 5,000 calls/day is ~3.5 calls/minute on average — well within the 5-minute TTL window. Default TTL is correct.
- Track `response.usage.cache_read_input_tokens` to confirm the cache is hitting starting on call 2.

**Cost impact.** Per 1,000 calls on Sonnet 4.6. Assumptions: 6,000-token stable system, 400-token user message, 600-token output, 999 follow-up calls hit cache within the 5-minute TTL.

| | Before | After (steady state) |
|--|--|--|
| Cache write (call 1 only) | — | 6,000 × $3.75 / 1M = $0.023 |
| Cache reads (calls 2-1000) | — | 999 × 6,000 × $0.30 / 1M = $1.798 |
| Uncached input | 1,000 × 6,400 × $3 / 1M = $19.20 | 1,000 × 400 × $3 / 1M = $1.20 |
| Output | 1,000 × 600 × $15 / 1M = $9.00 | 1,000 × 600 × $15 / 1M = $9.00 |
| **Total** | **$28.20** | **$12.02** |

Roughly 57% reduction at this volume. At 5,000 calls/day that is ~$80/day saved, ~$29K/year. If your real cache-hit ratio is 80%, the savings drop to ~46%. Prices from `reference/pricing-snapshot.md`; verify on the live pricing page before billing decisions.

**Confidence: High.** The single fact that would move this: whether traffic has gaps >5 minutes between calls. If yes, the 1-hour TTL is cheaper.

---

## Example 2 — Pipeline shape: multi-model routing

**User input:**

> I'm building a pipeline that does three things per request: (1) extract structured data from a long PDF, (2) draft a 1-page narrative summary, (3) score the summary against a rubric. I'm using Opus 4.7 for all three. Expected volume: 500 pipeline runs/day. What should I change?

**Specialist response:**

**Verdict.** Opus on all three steps overpays by ~1.55× on this workload. Re-routing the first two steps to Sonnet 4.6 and keeping Opus 4.7 only on the judge isolates the scorer from the SUT (judge ≠ SUT, to avoid self-grading bias) and cuts cost by about 35%. See `reference/model-routing-decision-table.md`.

**Per-step routing.**

| Step | Recommended | Reason |
|--|--|--|
| 1. Extract structured data | `claude-sonnet-4-6` | Structured Outputs reliability is excellent on Sonnet; long-context retrieval is strong; Opus is overkill for extraction |
| 2. Draft narrative summary | `claude-sonnet-4-6` | Cost / quality balance. Sonnet 4.6 produces 1-page narratives indistinguishable from Opus on most evals |
| 3. Score against rubric | `claude-opus-4-7` | LLM-as-judge separated from the SUT (steps 1-2). Judge must differ from SUT to avoid self-grading bias; Opus premium is fine because the judge runs once per row |

**Cache structure.**

- **Step 1 (extract):** Cache the extraction schema and instructions (stable, ~3K tokens) with one breakpoint. Per-call PDF text goes after.
- **Step 2 (draft):** Cache the narrative format spec (stable, ~2.5K tokens) with one breakpoint. The extracted JSON from step 1 goes after.
- **Step 3 (score):** Cache the rubric (stable, ~4K tokens) with one breakpoint. The draft from step 2 goes after.

All three steps use the 5-minute TTL by default. 500 runs/day = ~1 run every ~3 minutes — borderline; if you observe >5 min gaps, switch step 3 to 1-hour TTL since the rubric is unchanging. See `reference/prompt-caching-cheatsheet.md`.

**Observability.**

- Log `model`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`, `output_tokens` per step per run. Compute per-run total cost using the calculator in `reference/usage-fields-reference.md`.
- Alert if cache-hit rate on the rubric drops below 90% — usually means the rubric was edited and the cache prefix changed.

**Cost impact.** Per 1,000 pipeline runs, with caching applied. Assumptions: extract input 15K (12K PDF + 3K cached schema), extract output 2K. Draft input 4.5K (2K JSON + 2.5K cached spec), draft output 1K. Score input 5K (1K draft + 4K cached rubric), score output 500.

| | All Opus 4.7 | Mixed (Sonnet/Sonnet/Opus) |
|--|--|--|
| Extract | (15K-3K)×$5 + 3K×$0.50 + 2K×$25 = $111.50 | (15K-3K)×$3 + 3K×$0.30 + 2K×$15 = $66.90 |
| Draft | (4.5K-2.5K)×$5 + 2.5K×$0.50 + 1K×$25 = $36.25 | (4.5K-2.5K)×$3 + 2.5K×$0.30 + 1K×$15 = $21.75 |
| Score | (5K-4K)×$5 + 4K×$0.50 + 0.5K×$25 = $19.50 | (5K-4K)×$5 + 4K×$0.50 + 0.5K×$25 = $19.50 |
| **Total** | **$167.25** | **$108.15** |

About 35% lower at the same quality. Prices from `reference/pricing-snapshot.md`; verify on the live pricing page before billing decisions.

**Confidence: Medium.** The single fact that would move this: actual eval results comparing Sonnet 4.6 vs Opus 4.7 on your draft step on YOUR data. If Sonnet's quality is meaningfully worse, keep Opus on the draft and accept the higher cost.

---

## Example 3 — Audit shape: two-breakpoint caching with a regulatory dictionary

**User input:**

> I have a system prompt that's split into two parts: a per-experiment variant prompt (~1,500 tokens, changes when I run a new experiment) and a domain dictionary (~12,000 tokens of regulatory definitions, stable for months). I'm running ~200 calls per experiment, 5 experiments per week. Right now I cache the whole thing as one block. Is there a smarter shape?

**Specialist response:**

**Verdict.** Partially. Two breakpoints — one after the variant prompt, one after the dictionary — let the dictionary stay cached across experiments while the variant cycles. But the variant at 1,500 tokens is below Sonnet 4.6's 2,048-token minimum, so its breakpoint is decorative until you bulk it up. See `reference/prompt-caching-cheatsheet.md`.

**Edits.**

Bulk the variant up to ≥2,048 tokens first, then add the second breakpoint. With the variant at 1,500 tokens, only one breakpoint is honored — on the dictionary — and the variant rides as plain content above it.

```ts
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: variantPrompt, // ~1,500 tokens, changes per experiment — too small to cache on its own
    },
    {
      type: "text",
      text: domainDictionary, // ~12,000 tokens, stable for months — this breakpoint earns its keep
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
  messages: [{ role: "user", content: userQuery }],
});
```

- Order still matters once you do bulk the variant up. Most-volatile (variant) first, most-stable (dictionary) last. Each breakpoint caches everything before it.
- 1-hour TTL is right because experiments run as bursts of ~200 calls with gaps between experiments. 5-minute TTL would expire mid-experiment.
- To make a second breakpoint earn its keep, bulk the variant up to 2,048+ tokens by combining it with related per-experiment instructions (eval framing, success criteria, scoring guidance). At that point you can re-add a breakpoint on the variant.

**Cost impact.** Per experiment of 200 calls on Sonnet 4.6. Assumptions: 1,500-token variant + 12,000-token dictionary + 500-token user message + 600-token output per call.

| | Single-block cache (current) | Single breakpoint on dictionary, variant uncached |
|--|--|--|
| Cache write (call 1, 1h rate) | 13,500 × $6 / 1M = $0.081 | 12,000 × $6 / 1M = $0.072 |
| Cache reads (calls 2-200) | 199 × 13,500 × $0.30 / 1M = $0.806 | 199 × 12,000 × $0.30 / 1M = $0.716 |
| Uncached input | 200 × 500 × $3 / 1M = $0.30 | 200 × (1,500 + 500) × $3 / 1M = $1.20 |
| Output | 200 × 600 × $15 / 1M = $1.80 | 200 × 600 × $15 / 1M = $1.80 |
| **Total per experiment** | **$2.99** | **$3.79** |

Counterintuitive within one experiment — splitting the cache to dictionary-only looks more expensive because the variant pays full uncached price. The win shows up across experiments: the dictionary stays cached when only the variant changes, instead of rewriting 13.5K tokens on the first call of each new experiment. Prices from `reference/pricing-snapshot.md`; verify on the live pricing page before billing decisions.

**Confidence: Medium.** The single fact that would move this: whether the dictionary is truly character-for-character stable across experiments. Cache keys are exact prefix matches; even one whitespace change invalidates the whole prefix.

---

## Example 4 — Clarifying shape: missing the three numbers

**User input:**

> I'm using Claude Sonnet 4.6 for a chatbot. Should I turn on caching?

**Specialist response:**

> Caching probably helps any chatbot with a stable system prompt over 2,048 tokens, but the answer is volume-dependent. To give you a real recommendation I need three numbers: average input tokens per call, average output tokens per call, and call volume per day.

---

## Example 5 — Audit shape: extended thinking causing a cost jump

**User input:**

> I just turned on extended thinking for my Sonnet 4.6 agent with a 4,000-token budget. My costs jumped 4×. My input tokens didn't change.

**Specialist response:**

**Verdict.** Expected. Extended thinking tokens bill at the **output rate** and land inside `usage.output_tokens`, not `input_tokens`. A 4,000-token budget on Sonnet 4.6 ($15/M output) adds up to $0.06 per call before the visible reply, which is why your bill moved while `input_tokens` stayed flat. See `reference/extended-thinking-cost.md`.

**Edits.**

```ts
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2048,
  thinking: { type: "enabled", budget_tokens: 1024 }, // start small, raise only if evals demand it
  system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
  messages,
});
```

- Drop `budget_tokens` to the smallest value that still passes your eval set. 1,024 is a good starting probe.
- If thinking does not move your eval score, turn it off entirely (`thinking` field omitted).
- Thinking blocks ride along inside cached message history on the next turn — no extra caching work needed, but they count toward the cached prefix size.

**Cost impact.** Per 1,000 calls on Sonnet 4.6. Assumptions: 5,000 input tokens (cached steady-state), 600 visible output tokens.

| | Thinking off | Thinking 4,000 | Thinking 1,024 |
|--|--|--|--|
| Input (cache reads) | 5,000 × $0.30/M = $1.50 | $1.50 | $1.50 |
| Output (visible + thinking) | 600 × $15/M = $9.00 | (600 + 4,000) × $15/M = $69.00 | (600 + 1,024) × $15/M = $24.36 |
| **Total per 1,000** | **$10.50** | **$70.50** | **$25.86** |

Prices from `reference/pricing-snapshot.md`; verify on the live pricing page before billing decisions.

**Confidence: High.** The single fact that would move this: whether your eval delta from thinking justifies the output-rate spend at any budget.

---

## Example 6 — Audit shape: service-tier choice for an overnight eval

**User input:**

> I have an overnight eval pipeline running 50,000 calls. Should I move to the Priority Tier to make it run faster?

**Specialist response:**

**Verdict.** No — use the Batch API instead. Overnight evals are latency-tolerant, which is exactly the workload Batch was built for: 50% off list price, 24-hour SLA. Batch and Priority Tier are **mutually exclusive**, so you pick one or the other on a given request. Priority Tier buys reserved low-latency capacity, not a discount; it is the wrong tool here. See `reference/priority-tier-cost.md`.

**Edits.**

```ts
const batch = await client.messages.batches.create({
  requests: evalRows.map((row, i) => ({
    custom_id: `eval-${i}`,
    params: {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: [{ type: "text", text: EVAL_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: row.input }],
    },
  })),
});
```

- Caching still applies inside Batch, so keep your `cache_control` breakpoint on the stable system prompt.
- Poll `client.messages.batches.retrieve(batch.id)` until `processing_status === "ended"`, then stream results.

**Cost impact.** Per 50,000 calls on Sonnet 4.6, directional. Assumptions: 5,000-token cached system, 400-token user input, 800-token output, ≥99% cache hit rate after warmup.

| | Standard | Batch (50% off) |
|--|--|--|
| Cache reads | 50,000 × 5,000 × $0.30/M = $75.00 | $37.50 |
| Uncached input | 50,000 × 400 × $3/M = $60.00 | $30.00 |
| Output | 50,000 × 800 × $15/M = $600.00 | $300.00 |
| **Total** | **$735.00** | **$367.50** |

Priority Tier pricing is a multiplier on standard rates and changes — check the live pricing page for the current number if you need the exact comparison. Prices from `reference/pricing-snapshot.md`.

**Confidence: High.** The single fact that would move this: whether your eval window is actually flexible to 24 hours. If you need results in under an hour, Batch is out and the question becomes Standard vs Priority.

---

## Example 7 — Boundary shape: out-of-scope topic

**User input:**

> How do I best configure LangChain's ChatAnthropic class to use prompt caching with the new 1-hour TTL?

**Specialist response:**

> LangChain integration is out of scope here. If you want, I can audit the equivalent direct `@anthropic-ai/sdk` call instead.
