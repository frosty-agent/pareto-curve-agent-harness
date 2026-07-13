import { buildLadder, normalizeCatalog, type OpenRouterModel } from "./frontier.js";
import { writeReports } from "./report.js";

export interface CliOptions {
  inputTokens: number;
  outputTokens: number;
  limit: number;
  excludePreview: boolean;
  allowedProviders: Set<string>;
  requireTools: boolean;
  outputDirectory?: string;
}

const usage = `Usage: npm run start -- [options]

Build a cost-vs-coding-capability ladder from OpenRouter's model catalog.

Options:
  --input-tokens <n>       Expected input tokens per task (default: 10000)
  --output-tokens <n>      Expected output tokens per task (default: 2000)
  --limit <n>              Maximum models in the JSON ladder (default: 10)
  --exclude-preview        Exclude preview models
  --allow-provider <list>  Comma-separated provider IDs, e.g. openai,anthropic
  --require-tools          Require OpenRouter tools support
  --output-dir <path>      Write report.json and report.html alongside stdout JSON
  --help                   Print this message
`;

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputTokens: 10_000,
    outputTokens: 2_000,
    limit: 10,
    excludePreview: false,
    allowedProviders: new Set(),
    requireTools: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    switch (arg) {
      case "--input-tokens": options.inputTokens = positiveInteger(value ?? "", arg); index += 1; break;
      case "--output-tokens": options.outputTokens = positiveInteger(value ?? "", arg); index += 1; break;
      case "--limit":
        options.limit = positiveInteger(value ?? "", arg);
        if (options.limit > 10) throw new Error("--limit must be between 1 and 10");
        index += 1;
        break;
      case "--exclude-preview": options.excludePreview = true; break;
      case "--allow-provider":
        if (!value) throw new Error(`${arg} requires a comma-separated provider list`);
        options.allowedProviders = new Set(value.split(",").map((provider) => provider.trim()).filter(Boolean));
        index += 1;
        break;
      case "--require-tools": options.requireTools = true; break;
      case "--output-dir":
        if (!value) throw new Error(`${arg} requires a path`);
        options.outputDirectory = value;
        index += 1;
        break;
      case "--help": console.log(usage); process.exit(0); break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export async function fetchCatalog(): Promise<OpenRouterModel[]> {
  const headers: HeadersInit = { Accept: "application/json" };
  // Authentication is optional for the public catalog, but permits private-account routing context.
  if (process.env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouter catalog request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json() as { data?: OpenRouterModel[] };
  if (!Array.isArray(payload.data)) throw new Error("OpenRouter catalog response did not include a data array");
  return payload.data;
}

export async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const catalog = await fetchCatalog();
  const candidates = normalizeCatalog(catalog, options);
  const models = buildLadder(candidates, options.limit);
  const report = {
    generatedAt: new Date().toISOString(),
    source: "https://openrouter.ai/api/v1/models",
    authConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    costModel: { inputTokens: options.inputTokens, outputTokens: options.outputTokens },
    policy: {
      excludePreview: options.excludePreview,
      allowedProviders: [...options.allowedProviders],
      requireTools: options.requireTools,
    },
    eligibleModelCount: candidates.length,
    paretoOptimalModelCount: paretoCount(candidates),
    models,
  };
  if (options.outputDirectory) await writeReports(report, options.outputDirectory);
  console.log(JSON.stringify(report, null, 2));
}

function paretoCount(candidates: ReturnType<typeof normalizeCatalog>): number {
  return buildLadder(candidates, candidates.length).filter((model) => model.isParetoOptimal).length;
}

const isDirectExecution = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isDirectExecution) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
