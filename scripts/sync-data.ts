import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { latestBizinfoRecords, normalizeBizinfo, normalizeKStartup } from "../src/lib/normalize";
import type { SeenRecords, SourceRecord } from "../src/lib/normalize";
import type { SupportProgram } from "../src/lib/types";

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseRecords(contents: string, file: string): SourceRecord[] {
  const value: unknown = JSON.parse(contents);
  if (!Array.isArray(value) || value.some((record) => !record || typeof record !== "object" || Array.isArray(record))) {
    throw new Error(`${file}: 공고 JSON 배열이 필요합니다.`);
  }
  return value as SourceRecord[];
}

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const optionIndex = args.indexOf("--source");
  if (args.length !== 0 && (args.length !== 2 || optionIndex !== 0 || !args[1] || args[1].startsWith("--"))) {
    throw new Error("사용법: pnpm data:sync [--source ../ax-startup]");
  }
  const sourceDirectory = path.resolve(process.cwd(), optionIndex >= 0 ? args[optionIndex + 1] : "../ax-startup");
  const storeFile = path.join(sourceDirectory, "data/bizinfo/store/versions.jsonl");
  const sampleFile = path.join(sourceDirectory, "data/bizinfo/bizinfo_sample_60건.json");
  const startupFile = path.join(sourceDirectory, "data/kstartup/kstartup_sample_200건.json");
  const seenFile = path.join(sourceDirectory, "data/bizinfo/store/seen.json");
  const metadataFile = path.join(sourceDirectory, "data/bizinfo/store/meta.json");
  const [storeContents, startupContents, seenContents, metadataContents] = await Promise.all([
    readOptional(storeFile), readOptional(startupFile), readOptional(seenFile), readOptional(metadataFile),
  ]);
  const input = storeContents !== null ? "store" : "sample";
  const bizinfoContents = storeContents ?? await readOptional(sampleFile);
  if (bizinfoContents === null || startupContents === null) {
    throw new Error("기업마당/K-Startup 수집 JSON을 찾지 못했습니다. --source로 ax-startup 저장소 경로를 지정하세요.");
  }
  const bizinfoRecords = input === "store"
    ? bizinfoContents.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      const record: unknown = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`기업마당 JSONL ${index + 1}행이 객체가 아닙니다.`);
      return record as SourceRecord;
    })
    : parseRecords(bizinfoContents, sampleFile);
  const seen = input === "store" && seenContents ? JSON.parse(seenContents) as SeenRecords : {};
  const startupRecords = parseRecords(startupContents, startupFile);
  const bizinfo = latestBizinfoRecords(bizinfoRecords, seen).map(normalizeBizinfo).filter((program): program is SupportProgram => program !== null);
  const kstartup = startupRecords.map(normalizeKStartup).filter((program): program is SupportProgram => program !== null);
  const programs = [...new Map([...bizinfo, ...kstartup].map((program) => [program.id, program])).values()];
  const metadata = metadataContents ? JSON.parse(metadataContents) as Record<string, unknown> : {};
  const knownTimestamp = input === "store" ? metadata.last_api_sync_at ?? metadata.full_completed_at : null;
  const updatedAt = typeof knownTimestamp === "string" && Number.isFinite(Date.parse(knownTimestamp))
    ? new Date(knownTimestamp).toISOString()
    : null;
  const manifest = {
    updatedAt,
    generatedAt: new Date().toISOString(),
    totalPrograms: programs.length,
    counts: { bizinfo: bizinfo.length, kstartup: kstartup.length },
    sources: {
      bizinfo: { input, collectedAt: updatedAt },
      kstartup: { input: "sample", collectedAt: null },
    },
    warnings: [
      "K-Startup 표본의 정확한 수집시각이 없어 collectedAt을 null로 저장합니다.",
      "비정형 접수기간과 구조화 자격조건은 모집·신청 자격을 확정하지 않습니다.",
    ],
  };
  const outputDirectory = path.join(process.cwd(), "data");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "programs.json"), `${JSON.stringify(programs, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`수집 JSON 가져오기 완료: 기업마당 ${bizinfo.length}건 + K-Startup ${kstartup.length}건 = ${programs.length}건`);
  console.log("공식 출처와 추천용 필드만 로컬 스냅샷에 저장했습니다. 연락처·API 키·첨부파일은 포함하지 않습니다.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "데이터 가져오기에 실패했습니다.");
  process.exitCode = 1;
});
