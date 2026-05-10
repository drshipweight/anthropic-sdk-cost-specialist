# Evals

A small eval suite that asserts the specialist follows its own rules. Run it whenever you change the docs in this folder, especially after editing `identity.md`, `rules.md`, or any `reference/` file.

## What it checks

Each case in [`cases.json`](./cases.json) sends a real prompt to the specialist (with `identity.md`, `rules.md`, `examples.md`, and every `reference/*.md` concatenated into the system prompt — the same files the README tells users to upload to a Claude.ai project) and asks an Opus 4.7 judge whether the response satisfies the case's rubric. Coverage:

| Area | Cases |
|---|---|
| Audit shape (verdict → edits → cost → confidence) | `audit-001-happy-path`, `audit-002-below-threshold` |
| Pipeline shape (per-step picks → cache → observability → cost) | `pipeline-001-multi-model-routing` |
| Dashboard sanity check | `dashboard-001-input-tokens-confusion` |
| Boundary handling (one-sentence redirect) | `boundary-001-langchain`, `boundary-002-fine-tuning`, `boundary-003-hipaa` |
| Asks for the three numbers when missing | `clarify-001-missing-volume` |
| Extended thinking — output rate billing | `thinking-001-output-billing` |
| Tool definitions count as input | `tools-001-defs-as-input` |
| Files API isn't a cache substitute | `files-001-not-a-cache` |
| Priority Tier vs Batch decision | `priority-001-batch-vs-priority` |

## How to run

```bash
cd evals
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run eval
```

Bun works too:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval:bun
```

Output looks like:

```
Running 12 cases | specialist=claude-sonnet-4-6 | judge=claude-opus-4-7

[audit-001-happy-path] Caching audit on uncached Sonnet system prompt ... PASS
[audit-002-below-threshold] Refuse to cache content below the model minimum ... PASS
[pipeline-001-multi-model-routing] Multi-step pipeline routing recommendation ... PASS
...
12 / 12 passed
```

Exit code is `0` on full pass, `1` on any failure.

## Override the models

```bash
SPECIALIST_MODEL=claude-opus-4-7 JUDGE_MODEL=claude-opus-4-7 npm run eval
```

Two reasons to override:
- Validate the docs hold up under a stronger specialist model (Opus). If Sonnet passes everything but Opus fails an edge case, the docs may be relying on Sonnet's particular phrasing.
- Cost. Running with Sonnet specialist + Opus judge is the default because the judge is the more expensive call and runs once per case.

## Cost per run

Approximate, with default models on the current pricing snapshot:
- Specialist call: ~3K input (cached after case 1) + ~1K output × 12 cases ≈ $0.20
- Judge call: ~2K input + ~200 output × 12 cases ≈ $0.50
- **Total: ~$0.70 per full run.**

Cheap enough to run on every doc edit.

## Adding a case

Add an object to the `cases` array in `cases.json` with this shape:

```json
{
  "id": "kebab-id-001",
  "title": "What this asserts",
  "shape": "audit | pipeline | boundary | clarifying",
  "prompt": "The user prompt to send.",
  "must_include": ["substring 1", "substring 2"],
  "must_not_include": ["forbidden substring"],
  "judge_criteria": "Free-form rubric the LLM judge enforces. Be specific about what facts must appear and what shape the response must take."
}
```

The judge sees the substring check results as input and treats the `judge_criteria` as the authoritative rubric. Substring checks are a fast first pass; the judge catches the things substring matching can't (shape, numbers, reasoning quality).

## Interpreting failures

| Failure pattern | Likely cause |
|---|---|
| Judge says a doc reference is missing (e.g., "should reference tool-use-cost.md") | Either the doc isn't being loaded into the system prompt, or `rules.md` doesn't tell the specialist to cite reference files |
| Judge says a price is wrong | `pricing-snapshot.md` has stale or contradictory numbers; check against the live page |
| Boundary case fails because the specialist actually answered | `identity.md`'s "areas explicitly do not cover" list is missing the topic, or `rules.md`'s boundary handling rule was edited |
| Clarifying case fails because the specialist gave a confident estimate | `rules.md`'s "Always ask for model, tokens, volume" rule isn't firing — check phrasing |

## Caveats

- The judge is an LLM and can be wrong. If a case fails repeatedly with judge reasoning that disagrees with your read of the response, tighten the `judge_criteria` to be less ambiguous, or split the criterion into multiple checks.
- The runner caches the specialist system prompt across cases, so the first case pays the write cost and the rest read from cache. If you change the docs between cases (don't), the cache invalidates.
- The substring checks are case-sensitive and exact. Use them for stable terminology (`cache_control`, `claude-sonnet-4-6`, `Confidence`) — not for things the model might phrase three different ways.
