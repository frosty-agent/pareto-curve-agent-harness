export interface OpenRouterModel {
  id: string;
  name: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  benchmarks?: {
    artificial_analysis?: {
      coding_index?: number;
      intelligence_index?: number;
      agentic_index?: number;
    };
  };
}

export interface Capabilities {
  supportsImageInput: boolean;
  supportsVideoInput: boolean;
  supportsImageOutput: boolean;
  supportsVideoOutput: boolean;
}

export interface Candidate {
  id: string;
  name: string;
  provider: string;
  codingIndex: number;
  intelligenceIndex: number | null;
  agenticIndex: number | null;
  expectedCostUsd: number;
  pricePerMillionInputUsd: number;
  pricePerMillionOutputUsd: number;
  capabilities: Capabilities;
  isParetoOptimal: boolean;
}

export interface CatalogPolicy {
  inputTokens: number;
  outputTokens: number;
  excludePreview?: boolean;
  allowedProviders?: Set<string>;
  requireTools?: boolean;
}

function tokenPrice(value: string | undefined): number | null {
  if (value === undefined) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

const perMillion = (value: string | undefined): number => {
  const price = tokenPrice(value);
  return price === null ? Number.NaN : price * 1_000_000;
};

export function expectedCostUsd(model: OpenRouterModel, inputTokens: number, outputTokens: number): number {
  const promptPrice = tokenPrice(model.pricing?.prompt);
  const completionPrice = tokenPrice(model.pricing?.completion);
  if (promptPrice === null || completionPrice === null) return Number.NaN;
  return promptPrice * inputTokens + completionPrice * outputTokens;
}

function capabilities(model: OpenRouterModel): Capabilities {
  const input = new Set(model.architecture?.input_modalities ?? []);
  const output = new Set(model.architecture?.output_modalities ?? []);
  return {
    supportsImageInput: input.has("image"),
    supportsVideoInput: input.has("video"),
    supportsImageOutput: output.has("image"),
    supportsVideoOutput: output.has("video"),
  };
}

export function normalizeCatalog(models: OpenRouterModel[], policy: CatalogPolicy): Candidate[] {
  return models.flatMap((model) => {
    const score = model.benchmarks?.artificial_analysis?.coding_index;
    const provider = model.id.split("/", 1)[0] ?? "";
    const name = model.name ?? model.id;
    const taskCost = expectedCostUsd(model, policy.inputTokens, policy.outputTokens);
    if (score === undefined || score === null || !Number.isFinite(taskCost)) return [];
    if (policy.excludePreview && /preview/i.test(`${model.id} ${name}`)) return [];
    if (policy.allowedProviders && policy.allowedProviders.size > 0 && !policy.allowedProviders.has(provider)) return [];
    if (policy.requireTools && !model.supported_parameters?.includes("tools")) return [];

    return [{
      id: model.id,
      name,
      provider,
      codingIndex: score,
      intelligenceIndex: model.benchmarks?.artificial_analysis?.intelligence_index ?? null,
      agenticIndex: model.benchmarks?.artificial_analysis?.agentic_index ?? null,
      expectedCostUsd: taskCost,
      pricePerMillionInputUsd: perMillion(model.pricing?.prompt),
      pricePerMillionOutputUsd: perMillion(model.pricing?.completion),
      capabilities: capabilities(model),
      isParetoOptimal: false,
    }];
  });
}

function compareLowToHigh(a: Candidate, b: Candidate): number {
  return a.codingIndex - b.codingIndex || a.expectedCostUsd - b.expectedCostUsd || a.id.localeCompare(b.id);
}

function dominates(a: Candidate, b: Candidate): boolean {
  const noWorse = a.codingIndex >= b.codingIndex && a.expectedCostUsd <= b.expectedCostUsd;
  const strictlyBetter = a.codingIndex > b.codingIndex || a.expectedCostUsd < b.expectedCostUsd;
  return noWorse && strictlyBetter;
}

export function paretoFrontier(candidates: Candidate[]): Candidate[] {
  return candidates
    .filter((candidate) => !candidates.some((other) => other.id !== candidate.id && dominates(other, candidate)))
    .map((candidate) => ({ ...candidate, isParetoOptimal: true }))
    .sort(compareLowToHigh);
}

export function buildLadder(candidates: Candidate[], limit: number): Candidate[] {
  const frontier = paretoFrontier(candidates);
  const frontierIds = new Set(frontier.map((candidate) => candidate.id));
  const dominated = candidates
    .filter((candidate) => !frontierIds.has(candidate.id))
    .map((candidate) => ({ ...candidate, isParetoOptimal: false }))
    .sort(compareLowToHigh);
  return [...frontier, ...dominated].slice(0, limit);
}
