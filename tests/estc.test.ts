import assert from "node:assert/strict";
import test from "node:test";
import { createConsultation, selectRecommendations, transition } from "../src/lib/estc";
import { localClassification } from "../src/lib/retrieval";
import type { ChatRequest, SupportProgram } from "../src/lib/types";

const request: ChatRequest = { messages: [{ role: "user", content: "서울 AI 지원" }, { role: "user", content: "부산으로 이전했어요" }], source: "bizinfo" };
const program: SupportProgram = { id: "bizinfo:1", source: "bizinfo", title: "실제 사업", summary: "", target: "", category: "", region: "", organization: "", applicationPeriod: "", applicationStart: null, applicationEnd: null, url: "", collectedAt: null, eligibilityText: "", tags: [] };

function evaluated() {
  const state = createConsultation(request, "2026-10-09", localClassification(request.messages));
  for (const stage of ["filtered", "classified", "retrieved", "evaluated"] as const) transition(state, stage);
  return state;
}

test("최신 검색 지역을 기록하고 단계 건너뛰기와 완료 후 재전이를 거부한다", () => {
  const state = createConsultation(request, "2026-10-09", localClassification(request.messages));
  assert.equal(state.conditions.searchRegion, "부산");
  assert.equal(state.conditions.businessAge, null);
  assert.throws(() => transition(state, "selected"));
  assert.throws(() => selectRecommendations(state, "local"));
  for (const stage of ["filtered", "classified", "retrieved", "evaluated", "selected", "completed"] as const) transition(state, stage);
  assert.throws(() => transition(state, "completed"));
});

test("선정은 실제 데이터로 카드를 복원하고 미등록·중복·마감·다른 출처·잘못된 점수를 제외한다", () => {
  const state = evaluated();
  const closed = { ...program, id: "closed", applicationEnd: "2020-01-01" };
  const other = { ...program, id: "other", source: "kstartup" as const };
  state.available = [program, closed, other];
  state.candidates = [
    { program: { ...program, id: "missing" }, relevance: .9, reasons: [] },
    { program: closed, relevance: .9, reasons: [] },
    { program: other, relevance: .9, reasons: [] },
    { program, relevance: NaN, reasons: [] },
    { program, relevance: 1.1, reasons: [] },
    { program: { ...program, title: "잘못된 이름" }, relevance: .8, reasons: [] },
    { program, relevance: .7, reasons: [] },
  ];
  const result = selectRecommendations(state, "jev");
  assert.equal(result.length, 1);
  assert.equal(result[0].program.title, "실제 사업");
  assert.equal(result[0].scoreKind, "jev_probability");
});

test("낮은 Jev 적합도와 로컬 점수를 구분하고 최대 세 건과 마감 포함을 지킨다", () => {
  const state = evaluated();
  state.available = Array.from({ length: 5 }, (_, i) => ({ ...program, id: String(i), applicationEnd: "2020-01-01" }));
  state.candidates = state.available.map(program => ({ program, relevance: .2, reasons: [] }));
  assert.equal(selectRecommendations(state, "local").length, 0);
  state.conditions.includeClosed = true;
  assert.equal(selectRecommendations(state, "jev").length, 0);
  const result = selectRecommendations(state, "local");
  assert.equal(result.length, 3);
  assert.equal(result[0].scoreKind, "local_relevance");
  assert.equal(result[0].program.status, "closed");
  assert.deepEqual(state.trace.map(item => item.stage), ["received", "filtered", "classified", "retrieved", "evaluated"]);
});
