import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupportProgram } from "./types";

export interface DataManifest {
  updatedAt: string | null;
  [key: string]: unknown;
}

let programsPromise: Promise<SupportProgram[]> | undefined;
let manifestPromise: Promise<DataManifest> | undefined;

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function loadPrograms(): Promise<SupportProgram[]> {
  programsPromise ??= readFile(path.join(process.cwd(), "data", "programs.json"), "utf8")
    .then((contents) => {
      const programs: unknown = JSON.parse(contents);
      if (!Array.isArray(programs)) throw new Error("지원사업 데이터는 JSON 배열이어야 합니다. pnpm data:sync를 실행하세요.");
      return programs as SupportProgram[];
    })
    .catch((error: unknown) => {
      if (isNotFound(error)) return [];
      programsPromise = undefined;
      throw error;
    });
  return programsPromise;
}

export function loadDataManifest(): Promise<DataManifest> {
  manifestPromise ??= readFile(path.join(process.cwd(), "data", "manifest.json"), "utf8")
    .then((contents) => {
      const manifest = JSON.parse(contents) as DataManifest;
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error("데이터 매니페스트 형식이 올바르지 않습니다. pnpm data:sync를 실행하세요.");
      }
      return { ...manifest, updatedAt: typeof manifest.updatedAt === "string" ? manifest.updatedAt : null };
    })
    .catch((error: unknown) => {
      if (isNotFound(error)) return { updatedAt: null };
      manifestPromise = undefined;
      throw error;
    });
  return manifestPromise;
}
