/**
 * Eval runner for the Anthropic SDK Cost & Caching Coach.
 *
 * Builds the specialist's system prompt by concatenating identity.md, rules.md,
 * and every file in reference/. Sends each test case from cases.json through
 * the specialist (Sonnet 4.6 by default), then asks an Opus 4.7 judge to
 * verify the response against the case's judge_criteria, must_include, and
 * must_not_include rules. Reports pass/fail per case with judge reasoning.
 *
 * Run: ANTHROPIC_API_KEY=... bun run evals/run.ts
 *      ANTHROPIC_API_KEY=... npx tsx evals/run.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SPECIALIST_MODEL = process.env.SPECIALIST_MODEL ?? "claude-sonnet-4-6";
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-opus-4-7";

type Case = {
  id: string;
  title: string;
  shape: "audit" | "pipeline" | "boundary" | "clarifying";
  prompt: string;
  must_include: string[];
  must_not_include: string[];
  judge_criteria: string;
};

type CasesFile = { version: string; description: string; cases: Case[] };

type Result = {
  id: string;
  title: string;
  pass: boolean;
  reasons: string[];
  responseChars: number;
};

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { type: string; text?: string }) => b.text ?? "")
    .join("\n");
}

function buildSystemPrompt(): string {
  const identity = readFileSync(join(ROOT, "identity.md"), "utf8");
  const rules = readFileSync(join(ROOT, "rules.md"), "utf8");
  const examples = readFileSync(join(ROOT, "examples.md"), "utf8");
  const referenceDir = join(ROOT, "reference");
  const referenceFiles = readdirSync(referenceDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const references = referenceFiles
    .map(
      (f) =>
        `--- reference/${f} ---\n${readFileSync(join(referenceDir, f), "utf8")}`
    )
    .join("\n\n");
  return `${identity}\n\n${rules}\n\n${examples}\n\n# Reference files (consult these for facts; do not invent prices)\n\n${references}`;
}

function loadCases(): Case[] {
  const raw = readFileSync(join(__dirname, "cases.json"), "utf8");
  return (JSON.parse(raw) as CasesFile).cases;
}

async function runSpecialist(
  client: Anthropic,
  systemPrompt: string,
  prompt: string
): Promise<string> {
  const response = await client.messages.create({
    model: SPECIALIST_MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" }, // cache the specialist context across cases
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });
  return extractText(response);
}

const JUDGE_INSTRUCTIONS = `You are a strict reviewer evaluating whether a specialist's response meets specific criteria. Read the criteria carefully and judge ONLY against them — do not impose your own preferences.

Output exactly one JSON object with this shape and nothing else (no markdown fences, no preamble):
{
  "pass": true | false,
  "reasons": ["short reason 1", "short reason 2", ...]
}

Pass only if every stated criterion is satisfied. Reasons must reference specific criteria you checked, including any that failed.`;

async function judgeResponse(
  client: Anthropic,
  testCase: Case,
  specialistResponse: string
): Promise<{ pass: boolean; reasons: string[] }> {
  const includeChecks = testCase.must_include
    .map((token) => {
      const present = specialistResponse.includes(token);
      return `- "${token}" → ${present ? "PRESENT" : "MISSING"}`;
    })
    .join("\n");

  const excludeChecks = testCase.must_not_include
    .map((token) => {
      const present = specialistResponse.includes(token);
      return `- "${token}" → ${present ? "PRESENT (should not appear)" : "absent (good)"}`;
    })
    .join("\n");

  const userMessage = `# Case

ID: ${testCase.id}
Title: ${testCase.title}
Shape expected: ${testCase.shape}

# User prompt sent to the specialist
${testCase.prompt}

# Specialist response
${specialistResponse}

# Substring checks already computed
must_include:
${includeChecks || "(none)"}

must_not_include:
${excludeChecks || "(none)"}

# Judge criteria (your rubric)
${testCase.judge_criteria}

# Response shape rules to also enforce (from rules.md)
- Audit shape: Verdict → Edits → Cost impact → Confidence (no other top-level sections)
- Pipeline shape: per-step model picks → cache structure → observability → total cost → confidence
- Boundary shape: roughly one sentence declining + redirect, no apology
- Clarifying shape: 1-3 sentences, no full audit, no confident dollar estimate without numbers
- Confidence line uses only High / Medium / Low and names the single fact that would move it
- No "Great question", no closing summary

Now produce the JSON verdict.`;

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2048,
    system: JUDGE_INSTRUCTIONS,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = extractText(response).trim();

  try {
    const parsed = JSON.parse(text) as { pass: boolean; reasons: string[] };
    return parsed;
  } catch {
    return {
      pass: false,
      reasons: [`judge returned non-JSON: ${text.slice(0, 200)}`],
    };
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }

  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt();
  const cases = loadCases();

  console.log(
    `Running ${cases.length} cases | specialist=${SPECIALIST_MODEL} | judge=${JUDGE_MODEL}\n`
  );

  const results: Result[] = [];

  for (const c of cases) {
    process.stdout.write(`[${c.id}] ${c.title} ... `);
    try {
      const response = await runSpecialist(client, systemPrompt, c.prompt);
      const verdict = await judgeResponse(client, c, response);
      results.push({
        id: c.id,
        title: c.title,
        pass: verdict.pass,
        reasons: verdict.reasons,
        responseChars: response.length,
      });
      console.log(verdict.pass ? "PASS" : "FAIL");
      if (!verdict.pass) {
        for (const r of verdict.reasons) console.log(`    - ${r}`);
      }
    } catch (err) {
      results.push({
        id: c.id,
        title: c.title,
        pass: false,
        reasons: [`runtime error: ${(err as Error).message}`],
        responseChars: 0,
      });
      console.log(`ERROR — ${(err as Error).message}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${passed} / ${total} passed`);

  if (passed < total) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.id}: ${r.title}`);
      for (const reason of r.reasons) console.log(`      ${reason}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
