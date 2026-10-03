import { getConfig } from "./config";
import { loadDataManifest, loadPrograms } from "./data";
import { getKoreaToday, getProgramStatus } from "./normalize";
import { classifyWithJev, rerankWithJev } from "./jev";
import { generateDialogue, localDialogue } from "./dialogue";
import { localClassification, retrievePrograms } from "./retrieval";
import { ProviderError } from "./http";
import type { ChatRequest, ChatResponse, Recommendation } from "./types";

export async function answerChat(request: ChatRequest): Promise<ChatResponse> {
  const config = getConfig();
  const [programs, manifest] = await Promise.all([loadPrograms(), loadDataManifest()]);
  const today = getKoreaToday();
  const warnings: string[] = [];
  if (!programs.length) warnings.push("수집 데이터가 없습니다. 관리자에게 데이터 동기화를 요청해주세요.");
  const fromSource = programs.filter((program) => request.source === "all" || !request.source || program.source === request.source);
  const excludedClosed = fromSource.filter((program) => getProgramStatus(program, today) === "closed").length;
  const available = fromSource.filter((program) => request.includeClosed || getProgramStatus(program, today) !== "closed");
  let classification = localClassification(request.messages);
  if (config.jevKey) {
    try { classification = await classifyWithJev(request.messages); }
    catch (error) { warnings.push(`${error instanceof ProviderError ? error.message : "Jev API 오류"}: 로컬 분류를 사용합니다.`); }
  } else warnings.push("Jev API 미설정: 키워드 기반 로컬 검색을 사용합니다. 검색 점수는 확률이 아닙니다.");
  let candidates = retrievePrograms(available, request.messages, classification, config.candidates);
  let matchingEngine: "jev" | "local" = "local";
  if (config.jevKey && candidates.length) {
    try { candidates = await rerankWithJev(request.messages, candidates); matchingEngine = "jev"; }
    catch (error) { warnings.push(`${error instanceof ProviderError ? error.message : "Jev API 오류"}: 후보는 로컬 검색 점수 순서로 표시합니다.`); }
  }
  const recommendations: Recommendation[] = candidates
    .filter((candidate) => matchingEngine === "local" || candidate.relevance >= 0.3)
    .slice(0, 3).map((candidate) => ({
      program: { ...candidate.program, status: getProgramStatus(candidate.program, today) },
      score: candidate.relevance,
      scoreKind: matchingEngine === "jev" ? "jev_probability" : "local_relevance",
      reasons: candidate.reasons,
    }));
  let message = localDialogue(recommendations, classification, request.includeClosed === true);
  let dialogueEngine: ChatResponse["meta"]["dialogueEngine"] = "local";
  if (config.llmKey) {
    try { message = await generateDialogue(request.messages, recommendations, classification); dialogueEngine = config.llmProvider; }
    catch (error) { warnings.push(`${error instanceof ProviderError ? error.message : "대화 모델 오류"}: 기본 안내로 답변합니다.`); }
  } else warnings.push("대화 API 미설정: 기본 안내로 답변합니다.");
  return {
    message, recommendations, classification,
    meta: { matchingEngine, dialogueEngine, warnings, totalPrograms: programs.length, eligiblePrograms: available.length, excludedClosed: request.includeClosed ? 0 : excludedClosed, dataUpdatedAt: manifest.updatedAt },
  };
}
