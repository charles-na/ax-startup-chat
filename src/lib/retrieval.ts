import type { ChatMessage, Classification, SupportProgram } from "./types";

export const CATEGORIES = {
  commercialization: { label: "사업화", words: ["사업화", "창업", "시제품", "예비창업", "초기창업", "스타트업", "팁스"] },
  technology: { label: "기술개발", words: ["기술개발", "연구개발", "r&d", "특허", "인공지능", "ai", "실증", "기술", "연구"] },
  finance: { label: "금융·자금", words: ["정책자금", "자금", "융자", "대출", "보증", "투자", "금융"] },
  export: { label: "수출·판로", words: ["수출", "해외", "판로", "마케팅", "전시회", "글로벌", "바이어"] },
  workforce: { label: "인력·고용", words: ["인력", "고용", "채용", "직원", "일자리", "인건비"] },
  space: { label: "공간·보육", words: ["입주", "사무실", "공간", "보육", "센터", "임대"] },
  education: { label: "교육·컨설팅", words: ["교육", "컨설팅", "멘토링", "상담", "강의", "네트워킹"] },
  other: { label: "기타·조건 확인", words: [] },
} as const;

const STOP_WORDS = new Set(["지원", "사업", "지원사업", "추천", "알려", "알려줘", "알려주세요", "해주세요", "가능", "합니다", "있어요", "입니다", "찾아", "찾아줘", "받고", "싶어요", "기업", "있는", "위한", "대상", "관련", "해당", "안녕", "안녕하세요"]);
const REGIONS = /서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도/g;
const SUFFIXES = /(?:에서|으로|이고|입니다|이에요|예요|하는|하고|관련|에게|까지|부터|에서|들이|이랑|랑|은|는|을|를|이|가|에|의|도)$/;

export function userContext(messages: ChatMessage[]) {
  return messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
}

export function latestRegion(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (/지역\s*(?:제한\s*)?(?:없|무관)|전국\s*(?:어디|상관|모두)/.test(message.content)) return null;
    const matches = message.content.match(REGIONS);
    if (matches) return matches[matches.length - 1];
  }
  return null;
}

export function tokenize(text: string) {
  const terms = text.toLowerCase().match(/[가-힣a-z0-9&]+/g) ?? [];
  const words = terms.map((term) => term.replace(SUFFIXES, "")).filter((term) => term.length >= 2 && !STOP_WORDS.has(term) && !/^\d+$/.test(term));
  return [...new Set(words)].slice(0, 120);
}

export function localClassification(messages: ChatMessage[]): Classification {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const text = message.content.toLowerCase().split(/말고|아니고|아니라|대신|필요\s*없고|원하지\s*않고/).at(-1) || "";
    const ranked = Object.entries(CATEGORIES).map(([key, category]) => ({ key, matches: category.words.filter((word) => text.includes(word)).length })).sort((a, b) => b.matches - a.matches);
    if (ranked[0].matches) return { category: ranked[0].key, probabilities: {}, confidence: null, engine: "local" };
  }
  return { category: "other", probabilities: {}, confidence: null, engine: "local" };
}

export function categoryLabel(category: string) { return CATEGORIES[category as keyof typeof CATEGORIES]?.label || CATEGORIES.other.label; }

export interface RetrievedProgram { program: SupportProgram; relevance: number; reasons: string[] }

export function retrievePrograms(programs: SupportProgram[], messages: ChatMessage[], classification: Classification, limit: number): RetrievedProgram[] {
  const region = latestRegion(messages);
  // 최신 지역 정정이 과거 메시지의 지역 검색어에 묻히지 않게 한다.
  const text = userContext(messages).replace(REGIONS, " ");
  const category = CATEGORIES[classification.category as keyof typeof CATEGORIES] || CATEGORIES.other;
  const categoryRequested = classification.category !== "other";
  const earlierPurposeWords = Object.entries(CATEGORIES)
    .filter(([key]) => key !== classification.category)
    .flatMap(([, value]) => [...value.words])
    .filter((word) => !(category.words as readonly string[]).includes(word));
  const terms = tokenize(text).filter((term) => !categoryRequested || !earlierPurposeWords.some((word) => term.includes(word)));
  if (!terms.length && !region && !categoryRequested) return [];
  const documents = programs.map((program) => ({
    program,
    title: program.title.toLowerCase(),
    body: [program.summary, program.target, program.eligibilityText, program.category, ...program.tags].join(" ").toLowerCase(),
  }));
  const frequencies = new Map(terms.map((term) => [term, documents.filter((doc) => doc.title.includes(term) || doc.body.includes(term)).length]));

  return documents.map(({ program, title, body }) => {
    let points = 0;
    const matches: string[] = [];
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inBody = body.includes(term);
      if (!inTitle && !inBody) continue;
      const idf = Math.log(1 + (programs.length + 1) / ((frequencies.get(term) || 0) + 1));
      points += idf * (inTitle ? 2.5 : 1);
      matches.push(term);
    }
    const categoryMatch = categoryRequested && category.words.some((word) => program.category.toLowerCase().includes(word));
    if (categoryMatch) points += 3;
    const regionMatch = region && [program.region, program.title, program.target].join(" ").includes(region);
    if (regionMatch) points += 4;
    // 지역 정보는 본문과 충돌할 수 있어 제외 조건으로 사용하지 않는다.
    const reasons = [
      ...(matches.length ? [`대화 키워드: ${matches.slice(0, 3).join(", ")}`] : []),
      ...(categoryMatch ? [`요청 분야와 공고 분류가 일치: ${category.label}`] : []),
      ...(regionMatch ? [`공고에 ${region} 지역이 명시됨`] : []),
      "세부 신청 자격은 공고 원문 확인 필요",
    ];
    return { program, relevance: points > 0 ? Math.min(0.98, points / (points + 12)) : 0, reasons };
  }).filter((candidate) => candidate.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.program.id.localeCompare(b.program.id))
    .slice(0, limit);
}
