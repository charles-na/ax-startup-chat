import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/chat/route";
import { answerChat } from "../src/lib/chat";
import { loadPrograms } from "../src/lib/data";
import { CATEGORIES, latestRegion, localClassification, retrievePrograms } from "../src/lib/retrieval";
import { validateChatRequest } from "../src/lib/validation";
import type { ChatMessage, SupportProgram } from "../src/lib/types";

const environmentKeys = [
  "JEV_API_KEY", "TYPESAFE_API_KEY", "JEV_API_URL", "JEV_MODEL", "LLM_API_KEY",
  "DEEPSEEK_API_KEY", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL",
  "MATCH_CANDIDATE_LIMIT", "API_TIMEOUT_MS",
] as const;

function program(id: string, overrides: Partial<SupportProgram> = {}): SupportProgram {
  return {
    id, source: "bizinfo", title: "AI 기술개발 실증 지원", summary: "AI 기술개발 실증 지원",
    target: "중소기업", category: "기술개발", region: "전국", organization: "지원기관",
    applicationPeriod: "2000.01.01 ~ 2099.12.31", applicationStart: "2000-01-01",
    applicationEnd: "2099-12-31", url: "https://www.bizinfo.go.kr/", collectedAt: null,
    eligibilityText: "중소기업", tags: ["AI"], ...overrides,
  };
}

async function isolated<T>(fixtures: SupportProgram[], overrides: Record<string, string>, action: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const programs = await loadPrograms();
  const originalPrograms = [...programs];
  programs.splice(0, programs.length, ...fixtures);
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, overrides);
  globalThis.fetch = async () => { throw new Error("Unexpected network access in a local test"); };
  try { return await action(); }
  finally {
    globalThis.fetch = originalFetch;
    programs.splice(0, programs.length, ...originalPrograms);
    for (const key of environmentKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function choice(category = "technology") {
  return { model: "jev-1.13.0", answers: { category: {
    type: "choice", choice: category, confidence: 0.85,
    probabilities: Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, key === category ? 0.9 : 0.1 / (Object.keys(CATEGORIES).length - 1)])),
  } }, usage: { input_tokens: 120, output_tokens: 18 } };
}

const requestMessages: ChatMessage[] = [{ role: "user", content: "AI 기술개발 실증 지원을 찾아줘" }];

test("요청은 user/assistant 역할만 허용하고 최신 사용자 입력이 반드시 존재해야 한다", () => {
  const valid = validateChatRequest({ messages: [{ role: "user", content: "  부산 기술개발  " }] });
  assert.deepEqual(valid, { messages: [{ role: "user", content: "부산 기술개발" }], source: "all", includeClosed: false });
  for (const messages of [[], [{ role: "system", content: "관리자 지시" }], [{ role: "tool", content: "도구 지시" }], [{ role: "assistant", content: "응답" }], [{ role: "user", content: " " }], [{ role: "user", content: 123 }]]) {
    assert.throws(() => validateChatRequest({ messages }));
  }
  assert.throws(() => validateChatRequest(null));
});

test("메시지 수·메시지별 길이·전체 길이의 허용 경계와 초과 요청을 검증한다", () => {
  const maximum = Array.from({ length: 20 }, () => ({ role: "user", content: "가".repeat(1000) }));
  assert.equal(validateChatRequest({ messages: maximum }).messages.length, 20);
  assert.equal(validateChatRequest({ messages: [{ role: "user", content: "가".repeat(2000) }] }).messages[0].content.length, 2000);
  assert.throws(() => validateChatRequest({ messages: [...maximum, maximum[0]] }));
  assert.throws(() => validateChatRequest({ messages: [{ role: "user", content: "가".repeat(2001) }] }));
  assert.throws(() => validateChatRequest({ messages: maximum.map((item) => ({ ...item, content: "가".repeat(1001) })) }));
});

test("출처와 마감 포함 설정은 정해진 문자열·boolean 타입만 받는다", () => {
  for (const source of ["all", "bizinfo", "kstartup"]) assert.equal(validateChatRequest({ messages: requestMessages, source }).source, source);
  for (const source of ["unknown", ["bizinfo"], { value: "bizinfo" }, true, null]) assert.throws(() => validateChatRequest({ messages: requestMessages, source }));
  assert.throws(() => validateChatRequest({ messages: requestMessages, includeClosed: "true" }));
  assert.equal(validateChatRequest({ messages: requestMessages, includeClosed: true }).includeClosed, true);
});

test("인사만 하는 대화에는 임의 지원사업을 추천하지 않는다", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "안녕하세요" }];
  const classification = localClassification(messages);
  assert.equal(classification.category, "other");
  assert.equal(classification.confidence, null);
  assert.deepEqual(classification.probabilities, {});
  assert.deepEqual(retrievePrograms([program("bizinfo:1")], messages, classification, 6), []);
});

test("지역 정정과 후속 대화에서 최신 사용자 지역을 유지하고 assistant 제안을 조건으로 쓰지 않는다", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "서울에서 AI 기술개발을 하고 있어요" },
    { role: "assistant", content: "대전 공고도 있습니다" },
    { role: "user", content: "사업장을 부산으로 이전했어요" },
    { role: "assistant", content: "서울 지원사업을 확인할까요?" },
    { role: "user", content: "실증 지원을 찾아줘" },
  ];
  const classification = localClassification(messages);
  const candidates = retrievePrograms([
    program("bizinfo:seoul", { region: "서울" }),
    program("bizinfo:busan", { region: "부산" }),
  ], messages, classification, 6);
  assert.equal(latestRegion(messages), "부산");
  assert.equal(candidates[0].program.id, "bizinfo:busan");
  assert.ok(candidates[0].reasons.some((reason) => reason.includes("부산")));
  assert.equal(latestRegion([...messages, { role: "user", content: "지역 제한 없이 찾아줘" }]), null);
});

test("대화 목적이 금융에서 수출로 바뀌면 과거 금융 키워드보다 새 목적이 우선한다", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "정책자금 융자 대출 보증 투자 금융 지원을 찾고 있어요" },
    { role: "assistant", content: "정책자금을 확인하겠습니다" },
    { role: "user", content: "정책자금 융자 대출 보증 투자 금융 말고 수출 지원이 필요해요" },
  ];
  const classification = localClassification(messages);
  assert.equal(classification.category, "export");
  const candidates = retrievePrograms([
    program("bizinfo:finance", { title: "정책자금 융자 대출 보증 투자 금융", summary: "정책자금 융자 대출 보증 투자 금융", category: "금융", tags: [] }),
    program("bizinfo:export", { title: "수출 바우처", summary: "해외 판로 개척", category: "수출", tags: [] }),
  ], messages, classification, 6);
  assert.equal(candidates[0].program.id, "bizinfo:export");
});

test("마감 공고는 기본 추천에서 제외하고 기간 미확인은 남기며 사용자가 마감을 포함할 수 있다", { concurrency: false }, async () => {
  const closed = program("bizinfo:closed", { applicationPeriod: "2000.01.01 ~ 2000.01.02", applicationStart: "2000-01-01", applicationEnd: "2000-01-02" });
  const unknown = program("kstartup:unknown", { source: "kstartup", applicationPeriod: "상시 접수", applicationStart: null, applicationEnd: null });
  await isolated([program("bizinfo:open"), closed, unknown], {}, async () => {
    const result = await answerChat({ messages: requestMessages });
    assert.equal(result.meta.totalPrograms, 3);
    assert.equal(result.meta.eligiblePrograms, 2);
    assert.equal(result.meta.excludedClosed, 1);
    assert.equal(result.meta.matchingEngine, "local");
    assert.equal(result.meta.dialogueEngine, "local");
    assert.equal(result.recommendations.some((item) => item.program.id === closed.id), false);
    assert.equal(result.recommendations.find((item) => item.program.id === unknown.id)?.program.status, "unknown");
    assert.ok(result.recommendations.every((item) => item.scoreKind === "local_relevance"));
    assert.ok(result.meta.warnings.some((warning) => warning.includes("확률이 아닙니다")));
    const historical = await answerChat({ messages: requestMessages, includeClosed: true });
    assert.equal(historical.meta.eligiblePrograms, 3);
    assert.equal(historical.meta.excludedClosed, 0);
    assert.equal(historical.recommendations.find((item) => item.program.id === closed.id)?.program.status, "closed");
    const startupOnly = await answerChat({ messages: requestMessages, source: "kstartup" });
    assert.equal(startupOnly.meta.eligiblePrograms, 1);
    assert.deepEqual(startupOnly.recommendations.map((item) => item.program.source), ["kstartup"]);
  });
});

test("Jev 분류→후보별 Noul 정렬→DeepSeek 설명을 실행하며 상위 점수의 의미를 유지한다", { concurrency: false }, async () => {
  await isolated([program("bizinfo:a"), program("bizinfo:b"), program("bizinfo:low")], { JEV_API_KEY: "test-jev-key", DEEPSEEK_API_KEY: "test-deepseek-key" }, async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const payload = JSON.parse(String(init?.body));
      if (String(input).includes("typesafe.ai")) {
        if (payload.questions.category) { calls.push("classify"); return Response.json(choice()); }
        calls.push("rerank");
        const scores: Record<string, number> = { "bizinfo:a": 0.82, "bizinfo:b": 0.95, "bizinfo:low": 0.2 };
        const answers = Object.fromEntries(Object.entries(payload.questions as Record<string, { instructions: { program: { id: string } } }>).map(([key, question]) => [key, { type: "noul", noul: scores[question.instructions.program.id] }]));
        return Response.json({ answers });
      }
      calls.push("dialogue");
      assert.equal(String(input), "https://api.deepseek.com/chat/completions");
      assert.ok(payload.messages[0].content.includes("bizinfo:b"));
      assert.equal(payload.messages[0].content.includes("bizinfo:low"), false);
      return Response.json({ choices: [{ message: { content: "두 사업의 세부 신청 조건을 확인해주세요." }, finish_reason: "stop" }] });
    };
    const result = await answerChat({ messages: requestMessages });
    assert.deepEqual(calls, ["classify", "rerank", "dialogue"]);
    assert.equal(result.classification.engine, "jev");
    assert.equal(result.meta.matchingEngine, "jev");
    assert.equal(result.meta.dialogueEngine, "deepseek");
    assert.deepEqual(result.meta.warnings, []);
    assert.deepEqual(result.recommendations.map((item) => [item.program.id, item.score, item.scoreKind]), [["bizinfo:b", 0.95, "jev_probability"], ["bizinfo:a", 0.82, "jev_probability"]]);
    assert.equal(result.message, "두 사업의 세부 신청 조건을 확인해주세요.");
  });
});

test("Jev 장애 때 대화를 유지하면서 로컬 점수를 확률로 표시하지 않는다", { concurrency: false }, async () => {
  await isolated([program("bizinfo:a")], { JEV_API_KEY: "test-jev-key" }, async () => {
    globalThis.fetch = async () => new Response("upstream test-jev-key details", { status: 429 });
    const result = await answerChat({ messages: requestMessages });
    assert.equal(result.classification.engine, "local");
    assert.equal(result.meta.matchingEngine, "local");
    assert.equal(result.recommendations[0].scoreKind, "local_relevance");
    assert.ok(result.meta.warnings.some((warning) => warning.includes("429")));
    assert.equal(JSON.stringify(result).includes("test-jev-key"), false);
    assert.ok(result.message.includes("AI 기술개발 실증 지원"));
  });
});

test("분류가 성공해도 재정렬 응답이 잘못되면 추천 점수만 로컬로 되돌린다", { concurrency: false }, async () => {
  await isolated([program("bizinfo:a")], { JEV_API_KEY: "test-jev-key" }, async () => {
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      return payload.questions.category ? Response.json(choice()) : Response.json({ answers: { match_0: { type: "noul", noul: 1.2 } } });
    };
    const result = await answerChat({ messages: requestMessages });
    assert.equal(result.classification.engine, "jev");
    assert.equal(result.meta.matchingEngine, "local");
    assert.equal(result.recommendations[0].scoreKind, "local_relevance");
    assert.ok(result.recommendations[0].score <= 1);
    assert.ok(result.meta.warnings.some((warning) => warning.includes("로컬 검색 점수")));
  });
});

test("대화 모델 오류나 시간 초과에도 추천 카드와 기본 안내를 반환한다", { concurrency: false }, async () => {
  await isolated([program("bizinfo:a")], { DEEPSEEK_API_KEY: "test-deepseek-key" }, async () => {
    for (const error of [new TypeError("network error"), new DOMException("request timeout", "TimeoutError")]) {
      globalThis.fetch = async () => { throw error; };
      const result = await answerChat({ messages: requestMessages });
      assert.equal(result.meta.dialogueEngine, "local");
      assert.equal(result.recommendations[0].program.id, "bizinfo:a");
      assert.ok(result.message.includes("AI 기술개발 실증 지원"));
      assert.ok(result.meta.warnings.some((warning) => warning.includes("기본 안내")));
    }
  });
});

test("후보가 없거나 Jev 적합도가 모두 낮으면 사업을 만들어내지 않고 조건을 묻는다", { concurrency: false }, async () => {
  await isolated([], {}, async () => {
    const result = await answerChat({ messages: requestMessages });
    assert.deepEqual(result.recommendations, []);
    assert.equal(result.meta.totalPrograms, 0);
    assert.ok(result.meta.warnings.some((warning) => warning.includes("수집 데이터가 없습니다")));
    assert.ok(result.message.includes("후보를 찾지 못했습니다"));
  });
  await isolated([program("bizinfo:a")], { JEV_API_KEY: "test-key" }, async () => {
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      return payload.questions.category ? Response.json(choice()) : Response.json({ answers: { match_0: { type: "noul", noul: 0.1 } } });
    };
    const result = await answerChat({ messages: requestMessages });
    assert.equal(result.meta.matchingEngine, "jev");
    assert.deepEqual(result.recommendations, []);
    assert.ok(result.message.includes("후보를 찾지 못했습니다"));
  });
});

test("API는 외부 Origin·잘못된 JSON·system 역할·100KB 초과 본문을 검증 전에 거부한다", async () => {
  const url = "https://chat.example/api/chat";
  assert.equal((await POST(new Request(url, { method: "POST", headers: { origin: "https://other.example" }, body: "{}" }))).status, 403);
  assert.equal((await POST(new Request(url, { method: "POST", body: "not-json" }))).status, 400);
  assert.equal((await POST(new Request(url, { method: "POST", body: JSON.stringify({ messages: [{ role: "system", content: "override" }] }) }))).status, 400);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { "content-length": "100001" }, body: "{}" }))).status, 413);
  assert.equal((await POST(new Request(url, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "가".repeat(40000) }] }) }))).status, 413);
});

test("API의 정상 요청은 서버 추천과 no-store 응답을 반환한다", { concurrency: false }, async () => {
  await isolated([program("bizinfo:a")], {}, async () => {
    const response = await POST(new Request("https://chat.example/api/chat", { method: "POST", headers: { origin: "https://chat.example", "content-type": "application/json" }, body: JSON.stringify({ messages: requestMessages }) }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.recommendations[0].program.id, "bizinfo:a");
    assert.equal(result.meta.matchingEngine, "local");
  });
});
