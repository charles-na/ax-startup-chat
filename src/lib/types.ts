export type ProgramSource = "bizinfo" | "kstartup";
export type ProgramStatus = "open" | "upcoming" | "closed" | "unknown";

export interface SupportProgram {
  id: string;
  source: ProgramSource;
  title: string;
  summary: string;
  target: string;
  category: string;
  region: string;
  organization: string;
  applicationPeriod: string;
  applicationStart: string | null;
  applicationEnd: string | null;
  url: string;
  collectedAt: string | null;
  eligibilityText: string;
  tags: string[];
}

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ChatRequest {
  messages: ChatMessage[];
  includeClosed?: boolean;
  source?: "all" | ProgramSource;
}

export interface Classification {
  category: string;
  probabilities: Record<string, number>;
  confidence: number | null;
  engine: "jev" | "local";
}

export interface Recommendation {
  program: SupportProgram & { status: ProgramStatus };
  score: number;
  scoreKind: "jev_probability" | "local_relevance";
  reasons: string[];
}

export interface ChatResponse {
  message: string;
  recommendations: Recommendation[];
  classification: Classification;
  meta: {
    matchingEngine: "jev" | "local";
    dialogueEngine: "deepseek" | "compatible" | "local";
    warnings: string[];
    totalPrograms: number;
    eligiblePrograms: number;
    excludedClosed: number;
    dataUpdatedAt: string | null;
  };
}
