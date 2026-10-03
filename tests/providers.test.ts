import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "../src/lib/config";
import { generateDialogue } from "../src/lib/dialogue";
import { postJson, ProviderError } from "../src/lib/http";
import { classifyWithJev, rerankWithJev } from "../src/lib/jev";
import { CATEGORIES, type RetrievedProgram } from "../src/lib/retrieval";
import type { ChatMessage, Classification, Recommendation, SupportProgram } from "../src/lib/types";

const environmentKeys = [
  "JEV_API_KEY", "TYPESAFE_API_KEY", "JEV_API_URL", "JEV_MODEL", "LLM_API_KEY",
  "DEEPSEEK_API_KEY", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL",
  "MATCH_CANDIDATE_LIMIT", "API_TIMEOUT_MS",
] as const;

async function isolated<T>(overrides: Record<string, string>, action: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, overrides);
  try { return await action(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const key of environmentKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function choice(category = "technology", confidence = 0.85) {
  const otherProbability = 0.1 / (Object.keys(CATEGORIES).length - 1);
  return {
    model: "jev-1.13.0",
    answers: { category: {
      type: "choice", choice: category, confidence,
      probabilities: Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, key === category ? 0.9 : otherProbability])),
    } },
    usage: { input_tokens: 120, output_tokens: 18 },
  };
}

function program(id: string, overrides: Partial<SupportProgram> = {}): SupportProgram {
  return {
    id, source: "bizinfo", title: "AI 기술개발 지원", summary: "AI 시제품 실증 지원",
    target: "중소기업", category: "기술개발", region: "부산", organization: "지원기관",
    applicationPeriod: "2000.01.01 ~ 2099.12.31", applicationStart: "2000-01-01",
    applicationEnd: "2099-12-31", url: "https://www.bizinfo.go.kr/", collectedAt: null,
    eligibilityText: "부산 소재 중소기업", tags: ["AI"], ...overrides,
  };
}

const messages: ChatMessage[] = [
  { role: "user", content: "서울에서 창업했어요" },
  { role: "assistant", content: "부산 사업은 어떤가요?" },
  { role: "user", content: "부산으로 이전했고 AI 기술개발 지원이 필요해요" },
];
const classification: Classification = { category: "technology", confidence: 0.85, probabilities: {}, engine: "jev" };
const recommendation: Recommendation = { program: { ...program("bizinfo:1"), status: "open" }, score: 0.9, scoreKind: "jev_probability", reasons: ["AI 실증 목적 일치"] };

test("Jev 분류는 공식 endpoint·Bearer 인증·Choice 계약과 사용자 대화만 사용한다", { concurrency: false }, async () => {
  await isolated({ TYPESAFE_API_KEY: "test-typesafe-key" }, async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.typesafe.ai/v1/systemone");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-typesafe-key");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal instanceof AbortSignal);
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, "jev-latest");
      assert.deepEqual(payload.state.user_turns, [messages[0].content, messages[2].content]);
      assert.equal(payload.questions.category.type, "choice");
      assert.deepEqual(Object.keys(payload.questions.category.criteria).sort(), Object.keys(CATEGORIES).sort());
      return json(choice());
    };
    const result = await classifyWithJev(messages);
    assert.equal(result.engine, "jev");
    assert.equal(result.category, "technology");
    assert.equal(result.probabilities.technology, 0.9);
    assert.equal(result.confidence, 0.85);
  });
});

test("Jev Choice의 누락·잘못된 분류·범위 밖 수치·불완전한 분포를 거부한다", { concurrency: false }, async () => {
  await isolated({ JEV_API_KEY: "test-key" }, async () => {
    const valid = choice().answers.category;
    const invalidAnswers = [
      {}, { ...valid, type: "score" }, { ...valid, choice: "invented" },
      { ...valid, confidence: 1.1 }, { ...valid, confidence: "0.9" },
      { ...valid, probabilities: { technology: 1 } },
      { ...valid, probabilities: { ...valid.probabilities, technology: -0.1 } },
      { ...valid, probabilities: { ...valid.probabilities, technology: "0.9" } },
      { ...valid, probabilities: Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, 1])) },
      { ...valid, probabilities: { ...valid.probabilities, unknown: 0 } },
    ];
    for (const answer of invalidAnswers) {
      globalThis.fetch = async () => json({ answers: { category: answer } });
      await assert.rejects(classifyWithJev(messages), ProviderError);
    }
  });
});

test("Jev Noul은 후보별 독립 확률을 유지하고 서로 합이 1이 되도록 정규화하지 않는다", { concurrency: false }, async () => {
  await isolated({ JEV_API_KEY: "test-key" }, async () => {
    const candidates: RetrievedProgram[] = [
      { program: program("bizinfo:1"), relevance: 0.7, reasons: ["검색 근거 1"] },
      { program: program("bizinfo:2"), relevance: 0.6, reasons: ["검색 근거 2"] },
    ];
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(payload.questions), ["match_0", "match_1"]);
      assert.equal(payload.questions.match_0.type, "noul");
      assert.equal(payload.questions.match_0.instructions.program.id, "bizinfo:1");
      assert.equal(payload.questions.match_1.instructions.program.id, "bizinfo:2");
      assert.equal(typeof payload.questions.match_0.criteria.true, "string");
      assert.equal(typeof payload.questions.match_0.criteria.false, "string");
      return json({ answers: { match_0: { type: "noul", noul: 0.8 }, match_1: { type: "noul", noul: 0.95 } } });
    };
    const result = await rerankWithJev(messages, candidates);
    assert.deepEqual(result.map((item) => [item.program.id, item.relevance]), [["bizinfo:2", 0.95], ["bizinfo:1", 0.8]]);
    assert.ok(result.reduce((sum, item) => sum + item.relevance, 0) > 1);
    assert.deepEqual(result[0].reasons, ["검색 근거 2"]);
    assert.deepEqual(candidates.map((item) => item.relevance), [0.7, 0.6]);
  });
});

test("Jev 후보 응답이 누락되거나 Noul이 유효한 0~1 수치가 아니면 전체 재정렬을 거부한다", { concurrency: false }, async () => {
  await isolated({ JEV_API_KEY: "test-key" }, async () => {
    const candidates: RetrievedProgram[] = [{ program: program("bizinfo:1"), relevance: 0.7, reasons: [] }];
    for (const answer of [undefined, { type: "choice", noul: 0.8 }, { type: "noul", noul: -0.1 }, { type: "noul", noul: 1.1 }, { type: "noul", noul: "0.8" }, { type: "noul", noul: null }]) {
      globalThis.fetch = async () => json({ answers: { match_0: answer } });
      await assert.rejects(rerankWithJev(messages, candidates), ProviderError);
    }
  });
});

test("Jev 후보 문맥은 긴 본문과 연락처를 줄이고 첨부·URL 필드를 보내지 않는다", { concurrency: false }, async () => {
  await isolated({ JEV_API_KEY: "test-key" }, async () => {
    const candidate: RetrievedProgram = {
      program: program("bizinfo:1", { summary: "staff@example.com 02-1234-5678 " + "가".repeat(5000), eligibilityText: "staff@example.com 연락", target: "02-1234-5678 문의" }),
      relevance: 0.7, reasons: [],
    };
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      const sent = payload.questions.match_0.instructions.program;
      assert.ok(sent.summary.length <= 4500);
      assert.equal(JSON.stringify(sent).includes("staff@example.com"), false);
      assert.equal(JSON.stringify(sent).includes("02-1234-5678"), false);
      assert.equal("url" in sent, false);
      assert.equal("collectedAt" in sent, false);
      return json({ answers: { match_0: { type: "noul", noul: 0.8 } } });
    };
    await rerankWithJev(messages, [candidate]);
  });
});

test("HTTP 오류와 잘못된 JSON은 민감한 upstream 본문을 노출하지 않고 ProviderError로 변환한다", { concurrency: false }, async () => {
  await isolated({}, async () => {
    globalThis.fetch = async () => new Response("upstream test-secret-key details", { status: 429 });
    await assert.rejects(postJson("https://api.example.com", "test-secret-key", {}, 1000, "Jev"), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 429);
      assert.equal(error.message.includes("test-secret-key"), false);
      return true;
    });
    globalThis.fetch = async () => new Response("not-json", { status: 200 });
    await assert.rejects(postJson("https://api.example.com", "", {}, 1000, "Jev"), ProviderError);
    globalThis.fetch = async () => { throw new TypeError("network test-secret-key"); };
    await assert.rejects(postJson("https://api.example.com", "", {}, 1000, "Jev"), (error: unknown) => error instanceof ProviderError && !error.message.includes("test-secret-key"));
  });
});

test("HTTPS가 아닌 provider endpoint로 키를 전송하지 않는다", { concurrency: false }, async () => {
  await isolated({}, async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return json({}); };
    await assert.rejects(postJson("http://api.example.com", "test-key", {}, 1000, "Jev"), ProviderError);
    assert.equal(called, false);
  });
});

test("외부 요청의 AbortSignal 만료를 provider 실패로 처리한다", { concurrency: false }, async () => {
  await isolated({}, async () => {
    let requestSignal: AbortSignal | null | undefined;
    globalThis.fetch = async (_input, init) => {
      requestSignal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        // AbortSignal.timeout 자체는 이벤트 루프를 유지하지 않으므로 짧은 안전 타이머를 둔다.
        const timer = setTimeout(() => reject(new Error("test timeout was not observed")), 100);
        requestSignal?.addEventListener("abort", () => { clearTimeout(timer); reject(requestSignal?.reason); }, { once: true });
      });
    };
    await assert.rejects(postJson("https://api.example.com", "test-key", {}, 10, "Jev"), ProviderError);
    assert.equal(requestSignal?.aborted, true);
  });
});

test("DeepSeek는 비추론 대화 계약과 서버가 선택한 사업 근거만 전송한다", { concurrency: false }, async () => {
  await isolated({ DEEPSEEK_API_KEY: "test-deepseek-key" }, async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.deepseek.com/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-deepseek-key");
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, "deepseek-flash");
      assert.deepEqual(payload.thinking, { type: "disabled" });
      assert.equal(payload.max_tokens, 1000);
      assert.equal(payload.stream, false);
      assert.equal(payload.messages[0].role, "system");
      assert.ok(payload.messages[0].content.includes(recommendation.program.id));
      assert.ok(payload.messages[0].content.includes('"scoreKind":"jev_probability"'));
      assert.deepEqual(payload.messages.slice(1), messages);
      return json({ choices: [{ message: { content: "  AI 실증 후보를 확인해주세요.  " }, finish_reason: "stop" }] });
    };
    assert.equal(await generateDialogue(messages, [recommendation], classification), "AI 실증 후보를 확인해주세요.");
  });
});

test("호환 provider는 지정 base URL과 모델을 사용하며 DeepSeek 전용 thinking 필드를 보내지 않는다", { concurrency: false }, async () => {
  await isolated({ LLM_PROVIDER: "compatible", LLM_API_KEY: "test-groq-key", LLM_BASE_URL: "https://api.groq.com/openai/v1/", LLM_MODEL: "openai/gpt-oss-20b" }, async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.groq.com/openai/v1/chat/completions");
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, "openai/gpt-oss-20b");
      assert.equal(payload.max_completion_tokens, 2000);
      assert.equal(payload.reasoning_effort, "low");
      assert.equal("thinking" in payload, false);
      assert.equal("max_tokens" in payload, false);
      return json({ choices: [{ message: { content: "지원 목적을 알려주세요." }, finish_reason: "stop" }] });
    };
    assert.equal(await generateDialogue(messages, [], classification), "지원 목적을 알려주세요.");
  });
});

test("대화 모델의 빈 응답·잘못된 구조·비정상 종료로 잘린 답변을 거부한다", { concurrency: false }, async () => {
  await isolated({ DEEPSEEK_API_KEY: "test-key" }, async () => {
    const interrupted = ["length", "aborted", "insufficient_system_resource", "content_filter", "tool_calls"].map((finish_reason) => ({ choices: [{ message: { content: "잘린 답변" }, finish_reason }] }));
    for (const value of [{}, { choices: {} }, { choices: [] }, { choices: [{ message: { content: " " }, finish_reason: "stop" }] }, ...interrupted]) {
      globalThis.fetch = async () => json(value);
      await assert.rejects(generateDialogue(messages, [], classification), ProviderError);
    }
  });
});

test("환경 설정으로 후보 수와 외부 요청 시간을 과도하게 늘릴 수 없다", { concurrency: false }, async () => {
  await isolated({ MATCH_CANDIDATE_LIMIT: "999", API_TIMEOUT_MS: "999999" }, async () => {
    assert.equal(getConfig().candidates, 20);
    assert.equal(getConfig().timeout, 30000);
    process.env.MATCH_CANDIDATE_LIMIT = "-10";
    process.env.API_TIMEOUT_MS = "0";
    assert.equal(getConfig().candidates, 3);
    assert.equal(getConfig().timeout, 1000);
    process.env.MATCH_CANDIDATE_LIMIT = "not-a-number";
    assert.equal(getConfig().candidates, 6);
  });
});
