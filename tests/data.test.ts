import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanText, getKoreaToday, getProgramStatus, latestBizinfoRecords, normalizeBizinfo,
  normalizeKStartup, officialProgramUrl, parseApplicationPeriod, parseCalendarDate,
} from "../src/lib/normalize";
import type { SupportProgram } from "../src/lib/types";

const record = {
  source_id: "PBLN_000000000126975", title: "지원사업", overview_text: "중소기업 사업화 지원",
  apply_period_raw: "2026.10.01 ~ 2026.10.20", fetched_at: "2026-10-03T11:47:03+00:00",
};
const program = normalizeBizinfo(record) as SupportProgram;

test("점·공백·숫자형·한글 기간을 유효한 달력날짜로 변환한다", () => {
  for (const value of ["2026.10.01 ~ 2026.10.20", "2026 . 10 . 1 ~ 2026 . 10 . 20", "20261001~20261020", "2026년 10월 1일부터 2026년 10월 20일까지", "2026-10-01 - 2026-10-20"]) {
    assert.deepEqual(parseApplicationPeriod(value), { start: "2026-10-01", end: "2026-10-20" });
  }
  assert.equal(parseCalendarDate(20261003), "2026-10-03");
  assert.equal(parseCalendarDate("2024.02.29"), "2024-02-29");
  assert.equal(parseCalendarDate("2026.02.29"), null);
  assert.equal(parseCalendarDate("2026.13.01"), null);
});

test("단일 날짜·예산 소진·여러 회차·역순 기간은 모집 중이라고 추정하지 않는다", () => {
  for (const value of ["2026.10.01", "상시 접수", "2026.10.01 ~ 예산 소진시까지", "2026.10.01 2026.10.20", "2026.10.20 ~ 2026.10.01", "2026.02.30 ~ 2026.03.01", "2026.10.01~2026.10.10, 2026.10.20~2026.10.30"]) {
    assert.deepEqual(parseApplicationPeriod(value), { start: null, end: null });
  }
});

test("마감 당일은 모집 중이고 상태 기본 날짜는 한국 시간이다", () => {
  assert.equal(getProgramStatus(program, "2026-09-30"), "upcoming");
  assert.equal(getProgramStatus(program, "2026-10-01"), "open");
  assert.equal(getProgramStatus(program, "2026-10-20"), "open");
  assert.equal(getProgramStatus(program, "2026-10-21"), "closed");
  assert.equal(getProgramStatus({ ...program, applicationPeriod: "상시 접수" }, "2026-10-03"), "unknown");
  assert.equal(getKoreaToday(new Date("2026-10-02T15:00:00Z")), "2026-10-03");
});

test("최신 버전을 선택하고 목록에서 제거·삭제된 공고를 제외한다", () => {
  const latest = { ...record, title: "수정된 공고", fetched_at: "2026-10-04T01:00:00Z" };
  assert.deepEqual(latestBizinfoRecords([latest, record]), [latest]);
  assert.deepEqual(latestBizinfoRecords([record], { [record.source_id]: { listed: false } }), []);
  assert.deepEqual(latestBizinfoRecords([record, { ...latest, deleted: true }]), []);
  assert.deepEqual(latestBizinfoRecords([record, { ...latest, status: "removed" }]), []);
});

test("공식 URL만 사용하며 HTTP를 HTTPS로 변환하고 위험 링크·인증값을 제거한다", () => {
  assert.equal(officialProgramUrl("bizinfo", record.source_id, "javascript:alert(1)"), program.url);
  assert.equal(officialProgramUrl("kstartup", "179341", "http://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=179341"), "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=179341");
  for (const value of ["javascript:alert(1)", "https://k-startup.go.kr.evil.example/x", "https://user:password@www.k-startup.go.kr/x", "https://www.k-startup.go.kr:8080/x"]) {
    const url = new URL(officialProgramUrl("kstartup", "179341", value));
    assert.equal(url.hostname, "www.k-startup.go.kr");
    assert.equal(url.protocol, "https:");
    assert.equal(url.searchParams.get("pbancSn"), "179341");
    assert.equal(url.username, "");
  }
  assert.equal(new URL(officialProgramUrl("kstartup", "179341", "https://www.k-startup.go.kr/x?serviceKey=secret&token=secret&pbancSn=1")).searchParams.toString(), "pbancSn=179341");
});

test("HTML은 텍스트로 정리하고 연락처·첨부·키 필드를 스냅샷에서 제외한다", () => {
  assert.equal(cleanText("&lt;b&gt;기술개발(R&amp;D)&lt;/b&gt;<script>alert(1)</script>"), "기술개발(R&D)");
  assert.equal(cleanText("지원 &#40;1차&#41; &#xD55C;&#xAE00;"), "지원 (1차) 한글");
  assert.equal(cleanText("문의 staff@example.com 02-1234-5678"), "문의 [연락처 생략] [연락처 생략]");
  const normalized = normalizeBizinfo({ ...record, contact: "담당자 02-1234-5678", apiKey: "secret", attachments: [{ url: "http://example.com" }] });
  assert.ok(normalized);
  assert.equal("contact" in normalized, false);
  assert.equal("apiKey" in normalized, false);
  assert.equal("attachments" in normalized, false);
});

test("K-Startup 수집 당시 모집 플래그를 현재 상태와 혼동하지 않는다", () => {
  const startup = normalizeKStartup({
    pbanc_sn: "179341", biz_pbanc_nm: "웰컴 투 팁스 &#40;강원권&#41;", supt_regin: "전국",
    biz_enyy: "3년미만", aply_trgt_ctnt: "강원권 소재 창업 후 2년 3개월 미만 기업",
    pbanc_rcpt_bgng_dt: "20260928", pbanc_rcpt_end_dt: "20261012", rcrt_prgs_yn: "Y",
    supt_biz_clsfc: "기술개발(R&amp;D)", detl_pg_url: "http://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=179341",
  });
  assert.ok(startup);
  assert.equal(startup.title, "웰컴 투 팁스 (강원권)");
  assert.equal(startup.category, "기술개발(R&D)");
  assert.equal(startup.eligibilityText, "강원권 소재 창업 후 2년 3개월 미만 기업");
  assert.ok(startup.tags.includes("3년미만"));
  assert.equal(startup.collectedAt, null);
  assert.equal(getProgramStatus(startup, "2026-10-13"), "closed");
});

test("수집 스냅샷이 없는 clone은 빈 목록을 반환하고 잘못된 JSON은 오류를 숨기지 않는다", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ax-startup-chat-data-test-"));
  const loader = path.resolve("node_modules/tsx/dist/loader.mjs");
  const modulePath = path.resolve("src/lib/data.ts");
  const script = `const {loadPrograms,loadDataManifest}=require(${JSON.stringify(modulePath)}); Promise.all([loadPrograms(),loadDataManifest()]).then(value=>process.stdout.write(JSON.stringify(value))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});`;
  const run = () => spawnSync(process.execPath, ["--import", loader, "-e", script], {
    cwd: temporaryDirectory, encoding: "utf8", timeout: 10_000,
  });
  try {
    const missing = run();
    assert.equal(missing.status, 0, missing.stderr);
    assert.deepEqual(JSON.parse(missing.stdout), [[], { updatedAt: null }]);
    await mkdir(path.join(temporaryDirectory, "data"));
    await writeFile(path.join(temporaryDirectory, "data", "programs.json"), "{}", "utf8");
    const malformed = run();
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /JSON 배열이어야/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
