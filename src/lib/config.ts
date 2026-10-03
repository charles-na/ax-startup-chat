export function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function getConfig() {
  return {
    jevKey: process.env.JEV_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim() || "",
    jevUrl: process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone",
    jevModel: process.env.JEV_MODEL || "jev-latest",
    llmKey: process.env.LLM_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "",
    llmProvider: process.env.LLM_PROVIDER === "compatible" ? "compatible" as const : "deepseek" as const,
    llmBaseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    llmModel: process.env.LLM_MODEL || "deepseek-flash",
    candidates: boundedInteger(process.env.MATCH_CANDIDATE_LIMIT, 6, 3, 20),
    timeout: boundedInteger(process.env.API_TIMEOUT_MS, 15000, 1000, 30000),
  };
}
