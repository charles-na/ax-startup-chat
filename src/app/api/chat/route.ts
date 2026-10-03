import { answerChat } from "@/lib/chat";
import { validateChatRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 단일 프로세스의 동시 외부 요청 수만 제한한다. 배포 전체의 rate limit은 gateway에서 설정한다.
let activeRequests = 0;

export async function POST(request: Request) {
  if (activeRequests >= 8) return Response.json({ error: "현재 상담 요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429, headers: { "Retry-After": "5" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "요청 출처를 확인해주세요." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > 100000) return Response.json({ error: "대화 요청이 너무 큽니다." }, { status: 413 });
  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 100000) return Response.json({ error: "대화 요청이 너무 큽니다." }, { status: 413 });
    body = validateChatRequest(JSON.parse(raw));
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "올바른 JSON 요청을 보내주세요." : error instanceof Error ? error.message : "입력을 확인해주세요." }, { status: 400 });
  }
  activeRequests++;
  try {
    return Response.json(await answerChat(body), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "수집 데이터를 읽지 못했습니다. 관리자에게 데이터 파일 확인을 요청해주세요." }, { status: 500 });
  } finally { activeRequests--; }
}
