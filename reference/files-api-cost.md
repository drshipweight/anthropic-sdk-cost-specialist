# Files API Cost

The Files API lets you upload PDFs, images, and documents once and reference them by ID across requests. It saves bandwidth and request body size — **not** per-token cost.

## What it does, what it doesn't

| Files API saves | Files API does not save |
|---|---|
| Re-uploading base64 payloads on every call | Per-request token cost of the file content |
| Request body bloat past API size limits | Per-image / per-page processing cost |
| Network round-trip for large attachments | Anything you wouldn't have already paid as input tokens |

A 50-page PDF still costs roughly 50K–150K input tokens every time you reference its file ID in a request. The Files API just means you uploaded those bytes once instead of once per call.

## Token cost by file type

These are rules of thumb. Always read `usage.input_tokens` (and `cache_creation_input_tokens` / `cache_read_input_tokens`) on the first call to confirm.

| File type | Approximate token cost |
|---|---|
| Image | Based on dimensions; verify on the live docs page |
| PDF | ~1,500–3,000 tokens per page (varies with text density and embedded images) |
| Plain text / markdown | Standard token count for the text |

## Cache file references

A file reference content block can sit before a cache breakpoint. If the same file is part of a stable prefix on every call, cache it and pay the read price on call 2+.

```ts
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "file", file_id: stableDocFileId },
          cache_control: { type: "ephemeral" }, // breakpoint after the document
        },
        { type: "text", text: userQuery }, // varies per call, sits after the breakpoint
      ],
    },
  ],
});
```

Same minimum-token rules apply: a 5-page PDF (~10K tokens) clears Sonnet 4.6's 2,048 minimum easily. A single image well under the threshold won't be cached unless combined with stable content above it.

## Common antipattern: Files API as a cache substitute

Teams sometimes assume the Files API *is* the cache because the file is uploaded once. It is not. Without a `cache_control` breakpoint after the file reference, you pay full input price for the file's tokens on every call. The upload-once benefit is purely about request size and network.

## Cost example: cached PDF across a chat

Workload: a user uploads a 30-page PDF (~75K tokens) and asks 20 questions about it. Sonnet 4.6.

| | No cache | With cache (1h TTL — sparse user traffic) |
|---|---|---|
| Document tokens, call 1 | 75,000 × $3 / 1M = $0.225 | 75,000 × $6 / 1M = $0.450 (write at 1h rate) |
| Document tokens, calls 2–20 | 19 × 75,000 × $3 / 1M = $4.275 | 19 × 75,000 × $0.30 / 1M = $0.428 |
| User query (~100 tokens × 20) | 20 × 100 × $3 / 1M = $0.006 | $0.006 |
| Output (~500 tokens × 20) | 20 × 500 × $15 / 1M = $0.150 | $0.150 |
| **Total per session** | **$4.656** | **$1.034** |

About 78% reduction. The 1h TTL is the right call here: a user reading and asking questions about a PDF will often have gaps longer than 5 minutes between calls.

## When Files API helps

- Documents larger than the practical inline-attachment size
- The same large attachment used across many calls (avoids re-uploading bytes)
- Multi-turn workflows where users upload a file in one step and ask questions across subsequent calls

## When it doesn't

- One-shot calls with a small attachment (the request body overhead is fine inline)
- Cases where the document changes per call (no upload reuse possible)

## Storage and lifecycle

Uploaded files persist for a documented retention period. After expiry, references fail and you must re-upload. Track file IDs and TTLs in your application; do not assume they live forever.

> **Verify against:** [platform.claude.com/docs/en/build-with-claude/files](https://platform.claude.com/docs/en/build-with-claude/files) and [platform.claude.com/docs/en/build-with-claude/pdf-support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
