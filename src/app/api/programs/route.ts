import { loadDataManifest, loadPrograms } from "@/lib/data";
import { getKoreaToday, getProgramStatus } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [programs, manifest] = await Promise.all([loadPrograms(), loadDataManifest()]);
    const today = getKoreaToday();
    return Response.json({
      total: programs.length,
      bySource: { bizinfo: programs.filter((program) => program.source === "bizinfo").length, kstartup: programs.filter((program) => program.source === "kstartup").length },
      updatedAt: manifest.updatedAt,
      open: programs.filter((program) => getProgramStatus(program, today) === "open").length,
      unknown: programs.filter((program) => getProgramStatus(program, today) === "unknown").length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "수집 데이터를 읽지 못했습니다." }, { status: 500 }); }
}
