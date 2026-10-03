export class ProviderError extends Error {
  constructor(public provider: string, public status?: number) {
    super(`${provider} API ${status ? `오류 (${status})` : "연결 또는 응답 오류"}`);
  }
}

export async function postJson(url: string, key: string, body: unknown, timeout: number, provider: string): Promise<unknown> {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:") throw new ProviderError(provider);
    const response = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new ProviderError(provider, response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(provider);
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
