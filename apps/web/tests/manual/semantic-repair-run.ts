import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import {
  createSemanticRepairRequestBody,
  prepareSemanticRepair,
  runSemanticRepair,
} from "./semantic-repair.js";

// Запуск из корня репозитория. Только фиксированный синтетический диагностический набор.
const root = "docs/experiments/328";
const ledger = ".tmp/semantic-repair-328";
const casesText = await readFile(`${root}/primary-cases.json`, "utf8");
const cases = z
  .array(z.object({ id: z.string(), input: z.unknown(), draft: z.unknown() }))
  .parse(JSON.parse(casesText));
const env = z
  .object({
    LLM_API_KEY: z.string().min(1),
    LLM_API_PROTOCOL: z.literal("responses"),
    LLM_API_URL: z.url(),
    LLM_AUTH_SCHEME: z.string().min(1),
    LLM_PROVIDER: z.literal("yandex"),
    LLM_FOLDER_ID: z.string().optional(),
  })
  .safeParse(process.env);
if (!env.success) throw new Error("Expected approved YandexGPT 5.1 Responses configuration");
const benchmark = z
  .object({
    apiProtocol: z.literal("responses"),
    maxOutputTokens: z.literal(4000),
    models: z.tuple([
      z.object({
        label: z.literal("YandexGPT 5.1 Pro"),
        model: z.string().regex(/\/yandexgpt-5\.1$/u),
        inputPricePerMillion: z.literal(800),
        outputPricePerMillion: z.literal(800),
      }),
    ]),
  })
  .safeParse(JSON.parse(await readFile(".llm-benchmark.local.json", "utf8")));
if (!benchmark.success) throw new Error("Expected frozen benchmark model and pricing");
const config = {
  apiKey: env.data.LLM_API_KEY,
  model: benchmark.data.models[0].model,
  apiProtocol: env.data.LLM_API_PROTOCOL,
  apiUrl: env.data.LLM_API_URL,
  authScheme: env.data.LLM_AUTH_SCHEME,
  provider: env.data.LLM_PROVIDER,
  maxOutputTokens: 4000,
  extraHeaders: env.data.LLM_FOLDER_ID ? { "x-folder-id": env.data.LLM_FOLDER_ID } : {},
};
const plans = cases.map((scenario) => {
  const prepared = prepareSemanticRepair(scenario.input, scenario.draft);
  const bytes = Buffer.byteLength(
    JSON.stringify(createSemanticRepairRequestBody(prepared, config)),
  );
  return {
    id: scenario.id,
    promptHash: prepared.promptHash,
    schemaHash: prepared.schemaHash,
    maximumRub: (bytes + 4000) * 0.0008,
  };
});
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const snapshot = {
  commit: git("rev-parse", "HEAD"),
  fixtureHash: createHash("sha256").update(casesText).digest("hex"),
  model: "YandexGPT 5.1 Pro",
  protocol: "responses",
  outputCap: 4000,
  temperature: 0.3,
  priorAttempts: 8,
  priorRub: 7.7728,
  plans,
  maximumRub: plans.reduce((sum, plan) => sum + plan.maximumRub, 0),
};
console.log(JSON.stringify(snapshot, null, 2));
const selected = process.argv[2];
if (process.argv[3] === "--run") {
  if (git("status", "--porcelain") !== "" || !process.stdin.isTTY)
    throw new Error("Clean SHA and TTY required");
  const index = cases.findIndex((scenario) => scenario.id === selected);
  const scenario = cases[index];
  const plan = plans[index];
  if (!scenario || !plan) throw new Error("Unknown diagnostic slot");
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question("One paid attempt, no retries. Type RUN 1: ");
  readline.close();
  if (answer !== "RUN 1") throw new Error("Cancelled");
  await mkdir(ledger, { recursive: true });
  await mkdir(`${ledger}/lock`);
  try {
    const files = (await readdir(ledger)).filter((name) => name.endsWith(".json"));
    const costs = await Promise.all(
      files.map(
        async (name) =>
          z
            .object({ chargedRub: z.number().nonnegative() })
            .parse(JSON.parse(await readFile(`${ledger}/${name}`, "utf8"))).chargedRub,
      ),
    );
    const spent = 7.7728 + costs.reduce((sum, cost) => sum + cost, 0);
    if (spent + plan.maximumRub > 500) throw new Error("Budget exhausted");
    const record = {
      snapshot,
      scenario: selected,
      status: "reserved",
      chargedRub: plan.maximumRub,
    };
    const destination = `${ledger}/${selected}.json`;
    // Эксклюзивная запись до dispatch: повторный процесс не повторяет оплаченный слот.
    await writeFile(destination, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    const attempt = await runSemanticRepair(
      prepareSemanticRepair(scenario.input, scenario.draft),
      config,
    );
    const chargedRub = attempt.usage
      ? (attempt.usage.input_tokens + attempt.usage.output_tokens) * 0.0008
      : plan.maximumRub;
    await writeFile(
      destination,
      `${JSON.stringify({ ...record, status: "attempted", chargedRub, attempt }, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        scenario: selected,
        chargedRub,
        remainingRub: 500 - spent - chargedRub,
        error: attempt.error,
        status: attempt.result?.status,
      }),
    );
  } finally {
    await rmdir(`${ledger}/lock`);
  }
}
