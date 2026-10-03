import type { ChatRequest } from "./types";
import { object } from "./http";

export function validateChatRequest(value: unknown): ChatRequest {
  const body = object(value);
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 20) throw new Error("대화는 1~20개 메시지로 보내주세요.");
  let length = 0;
  const messages = body.messages.map((raw) => {
    const message = object(raw);
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || !message.content.trim() || message.content.length > 2000) throw new Error("각 메시지는 user/assistant 역할과 1~2,000자의 내용이 필요합니다.");
    length += message.content.length;
    return { role: message.role, content: message.content.trim() } as ChatRequest["messages"][number];
  });
  if (length > 20000) throw new Error("대화 전체 길이는 20,000자까지 지원합니다.");
  if (messages[messages.length - 1].role !== "user") throw new Error("마지막 메시지는 사용자 입력이어야 합니다.");
  if (body.includeClosed !== undefined && typeof body.includeClosed !== "boolean") throw new Error("마감 포함 설정을 확인해주세요.");
  if (body.source !== undefined && (typeof body.source !== "string" || !["all", "bizinfo", "kstartup"].includes(body.source))) throw new Error("지원사업 출처를 확인해주세요.");
  return { messages, includeClosed: body.includeClosed === true, source: (body.source || "all") as ChatRequest["source"] };
}
