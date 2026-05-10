# Priority Tier Cost

Priority Tier is the Claude API's premium service tier. It buys you guaranteed throughput and lower-variance latency at a higher per-token price. The Standard tier is what every account gets unless you explicitly enroll.

This file is intentionally light on dollar amounts. Priority Tier pricing changes more often than the public model pricing, and the multiplier varies by model. Always quote from the live page before recommending it for billing decisions.

## Standard vs Priority — what changes

| Dimension | Standard | Priority |
|---|---|---|
| Per-token price | Base rates (see `pricing-snapshot.md`) | Higher; multiplier varies by model — verify on the live pricing page |
| Throughput | Best-effort, subject to per-account rate limits | Guaranteed reserved capacity |
| Latency variance under load | Higher (queueing during peaks) | Lower; reserved capacity insulates from public-tier spikes |
| Enrollment | Default | Opt-in, requires Anthropic-side configuration |

The `usage` fields and the SDK call shape are identical. The price-per-token differs based on which tier the request was served on, and Priority consumption appears as a separate line on the invoice.

## When Priority is worth it

- User-facing endpoints with strict P50/P95/P99 latency SLAs
- Workloads that consistently hit Standard-tier rate limits during business hours
- Spike traffic where queue time on Standard breaks the UX (live chat, voice agents)
- Cases where the cost of a slow response (lost conversion, dropped session) exceeds the per-token premium

## When it isn't

- Internal tools, dashboards, eval pipelines
- Background jobs and async processing — use Batch API instead (50% discount)
- Workloads tolerant of seconds of variance
- Anything where you haven't measured Standard-tier latency and confirmed it's actually a problem

## Compatibility

| Feature | Compatible with Priority Tier |
|---|---|
| Prompt caching | Yes (caching works the same; reads/writes are billed at Priority rates) |
| Extended thinking | Yes |
| Tool use (client-side and server-side) | Yes |
| Files API | Yes |
| Batch API | **No** — Batch and Priority are mutually exclusive |
| Fine-tuning | N/A — Anthropic does not offer fine-tuning |

If your workload is batchable, the Batch API's 50% discount almost always wins on cost. Priority Tier is for low-latency, not low-cost.

## How to decide

| Situation | Tier |
|---|---|
| User-facing chat, latency-sensitive | Priority |
| Background analytics, eval batches, nightly runs | Standard or Batch |
| Production but tolerant of variance | Standard |
| Mixed workload (some endpoints latency-critical, others not) | Route by endpoint — Priority for the latency-critical ones, Standard or Batch for the rest |
| You aren't sure | Standard. Priority is opt-in for a reason; measure first |

## Budget impact estimate

Take your current Standard-tier monthly bill, multiply the latency-critical share by the (verified) Priority multiplier, leave the rest at Standard rates, and compare against the cost of an SLA breach. If the math doesn't justify it, you don't need Priority.

> **Verify against:** [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) — look for the Priority Tier section. Multipliers and availability change; do not quote from this file for billing decisions without re-verifying.
