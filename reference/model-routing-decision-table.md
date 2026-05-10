# Model Routing Decision Table

Pick the cheapest model that passes your evals. Then verify with traffic. This file gives you a starting point for that decision.

## The active frontier (2026-05-09)

| Model               | Strengths                                                              | Cost (input / output, $/MTok) | Notable          |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------- | ---------------- |
| Claude Opus 4.7     | Hardest reasoning, longest planning, deepest tool-use chains          | $5 / $25                      | New tokenizer (up to 35% more tokens for same text — see "Tokenizer note" below); 1M context |
| Claude Sonnet 4.6   | Default workhorse: structured output, agentic tasks, long context     | $3 / $15                      | 1M context       |
| Claude Haiku 4.5    | Fast, cheap classification, extraction, lightweight tool calls         | $1 / $5                       | High throughput  |

**Pricing ratios.** Opus 4.7 is ~1.67× the price of Sonnet 4.6 on both input and output. Sonnet 4.6 is 3× the price of Haiku 4.5. Caching multipliers apply identically across all three.

## Decision dimensions

| Dimension                        | Haiku 4.5 | Sonnet 4.6 | Opus 4.7  |
| -------------------------------- | --------- | ---------- | --------- |
| Reasoning depth                  | Light     | Deep       | Deepest   |
| Structured output reliability    | Good      | Excellent  | Excellent |
| Latency                          | Fastest   | Fast       | Slower    |
| Cost (relative to Sonnet)        | 0.33×     | 1×         | 1.67×     |
| Long-context retrieval           | Good      | Excellent  | Excellent |
| Eval / judge work                | Risky     | Acceptable | Preferred |
| Throughput / parallelism         | Best      | Good       | OK        |

## Default decision tree

Walk this top to bottom. Stop at the first match.

1. **Is the task single-label classification, routing, or short summarization of short content?** → **Haiku 4.5**.
2. **Is the task structured extraction (multiple fields, JSON schema, or anything where a wrong field silently breaks downstream code)?** → **Sonnet 4.6** by default. Drop to Haiku 4.5 only if the schema is ≤2 fields, regex-recoverable, and you have eval evidence Haiku's structured-output reliability holds.
3. **Is the task LLM-as-judge or eval scoring against a system-under-test?** → **Opus 4.7** (separate from the SUT, for methodology integrity).
4. **Does the task require multi-step reasoning, tool chaining, or long-context retrieval?** → **Sonnet 4.6** by default. Escalate to Opus 4.7 only if Sonnet fails an eval.
5. **Is the task simple drafting, format conversion, or templated output?** → **Haiku 4.5**.
6. **Is this a fresh project where you do not yet know the difficulty?** → **Sonnet 4.6**, then revisit after 200+ real calls of telemetry.

## Common pipeline shapes

### Extract → Draft → Score

| Step    | Recommended model | Reason                                                              |
| ------- | ----------------- | ------------------------------------------------------------------- |
| Extract | Sonnet 4.6        | Structured Outputs reliability; long-context input                  |
| Draft   | Sonnet 4.6        | Cost / quality balance; Haiku risks under-quality on long drafts    |
| Score   | Opus 4.7          | LLM-as-judge separated from the SUT to avoid self-grading bias      |

### Classify → Route → Respond

| Step     | Recommended model | Reason                                              |
| -------- | ----------------- | --------------------------------------------------- |
| Classify | Haiku 4.5         | Cheap, fast, single-label outputs                   |
| Route    | (no LLM)          | Pure code based on the Haiku label                  |
| Respond  | Sonnet 4.6        | Final user-facing text needs the quality bar        |

### Embed → Summarize → Cluster

| Step      | Recommended model | Reason                                                  |
| --------- | ----------------- | ------------------------------------------------------- |
| Summarize | Haiku 4.5         | Per-item summaries; Haiku is plenty                     |
| Cluster   | Haiku 4.5         | Cluster labels and tags from summary text               |
| (Embed)   | Use a dedicated embedding model, not Claude             | (Claude does not return raw embedding vectors)          |

## When to escalate from Sonnet to Opus

Real signal, not vibes:

- Sonnet's pass rate on your eval set is < your acceptance threshold.
- Specific failure modes: multi-step planning errors, missed nuance in long documents, hallucinated tool arguments.
- The cost ratio (Opus is 1.67× Sonnet) is justified by either downstream cost-of-failure or user-visible quality.

If the difference on your evals is small, stay on Sonnet. The bill matters.

## When to escalate from Haiku to Sonnet

- Haiku's structured output validity rate is below ~98%.
- The task includes more than 2 reasoning steps in a single call.
- Output exceeds ~500 tokens of generative writing per call (Haiku is best at terse outputs).

## Tokenizer note (Opus 4.7)

Opus 4.7 ships with a new tokenizer that produces up to **~35% more tokens** for the same input text vs Opus 4.6 and the Sonnet/Haiku line. Per-token prices are unchanged ($5 input / $25 output), but the token *count* on identical prompts can rise by 0–35%, with the upper end appearing most on code, structured data, and non-English text.

Practical impact for cost decisions:
- A like-for-like Opus 4.6 → 4.7 swap on the same prompt may bill 0–35% higher than the price-table ratio suggests. Measure on YOUR prompts before rolling over.
- The Opus 4.7 vs Sonnet 4.6 ratio (1.67× on the price column) understates the real-world delta on Opus 4.7 for code-heavy or non-English workloads. Re-run your eval-cost numbers after the tokenizer effect.
- Cached Opus 4.6 content does not transfer to Opus 4.7 — different tokenizer means different cache key.

> Sources: [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7) and Anthropic's launch post for Opus 4.7.

## 1M context

Opus 4.7, Opus 4.6, and Sonnet 4.6 support a 1M-token context window at standard pricing. (Sonnet 4.5 caps at 200K.) If your prompt is reliably above 200K tokens, the 1M models become the only option. Below that, prefer the smallest model that handles the task and cache the stable parts.

> **Verify against:** [platform.claude.com/docs/en/about-claude/models-overview](https://platform.claude.com/docs/en/about-claude/models-overview) and [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
