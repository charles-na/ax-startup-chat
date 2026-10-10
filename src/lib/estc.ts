import { getProgramStatus } from "./normalize";
import { latestRegion } from "./retrieval";
import type { RetrievedProgram } from "./retrieval";
import type { ChatRequest, Classification, Recommendation, SupportProgram } from "./types";

export type ConsultationStage = "received" | "filtered" | "classified" | "retrieved" | "evaluated" | "selected" | "completed";
export type StepOutcome = "success" | "local" | "skipped";

// 요청 단위 상태다. 사용자 발언에서 확인하지 않은 업력·업종은 추정하지 않는다.
export interface ConsultationState {
  stage: ConsultationStage;
  conditions: {
    searchRegion: string | null;
    businessAge: null;
    industry: null;
    source: NonNullable<ChatRequest["source"]>;
    includeClosed: boolean;
  };
  today: string;
  classification: Classification;
  available: SupportProgram[];
  candidates: RetrievedProgram[];
  recommendations: Recommendation[];
  warnings: string[];
  trace: { stage: ConsultationStage; outcome: StepOutcome }[];
}

const nextStage: Partial<Record<ConsultationStage, ConsultationStage>> = {
  received: "filtered", filtered: "classified", classified: "retrieved",
  retrieved: "evaluated", evaluated: "selected", selected: "completed",
};

export function createConsultation(request: ChatRequest, today: string, classification: Classification): ConsultationState {
  return {
    stage: "received", today, classification,
    conditions: { searchRegion: latestRegion(request.messages), businessAge: null, industry: null,
      source: request.source ?? "all", includeClosed: request.includeClosed === true },
    available: [], candidates: [], recommendations: [], warnings: [],
    trace: [{ stage: "received", outcome: "success" }],
  };
}

export function transition(state: ConsultationState, stage: ConsultationStage, outcome: StepOutcome = "success") {
  if (nextStage[state.stage] !== stage) throw new Error("상담 처리 단계의 전이가 올바르지 않습니다.");
  state.stage = stage;
  state.trace.push({ stage, outcome });
}

// 수집 데이터와 서버 평가값으로 추천 카드를 구성한다.
export function selectRecommendations(state: ConsultationState, engine: "jev" | "local"): Recommendation[] {
  if (state.stage !== "evaluated") throw new Error("후보 평가 후에 추천을 선정해야 합니다.");
  const available = new Map(state.available.map((program) => [program.id, program]));
  const seen = new Set<string>();
  const result: Recommendation[] = [];
  for (const candidate of state.candidates) {
    const program = available.get(candidate.program.id);
    if (!program || seen.has(program.id)) continue;
    const status = getProgramStatus(program, state.today);
    if ((!state.conditions.includeClosed && status === "closed") ||
        (state.conditions.source !== "all" && program.source !== state.conditions.source)) continue;
    if (!Number.isFinite(candidate.relevance) || candidate.relevance < 0 || candidate.relevance > 1) continue;
    if (engine === "jev" && candidate.relevance < 0.3) continue;
    seen.add(program.id);
    result.push({ program: { ...program, status }, score: candidate.relevance,
      scoreKind: engine === "jev" ? "jev_probability" : "local_relevance", reasons: candidate.reasons });
    if (result.length === 3) break;
  }
  return result;
}
