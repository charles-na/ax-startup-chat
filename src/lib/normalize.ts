import type { ProgramStatus, SupportProgram } from "./types";

export type SourceRecord = Record<string, unknown>;
export type SeenRecords = Record<string, { listed?: boolean }>;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};
const UNCERTAIN_PERIOD = /상시|수시|예산\s*소진|선착순|모집\s*(?:완료|마감)|충족|상이|별도|추후/;
const DATE_TOKEN = /(?<!\d)(\d{4})(?:\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})|\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?|(\d{2})(\d{2}))(?!\d)/g;

/** 원본의 제한된 HTML 엔티티만 해석하고 태그·스크립트·공개 연락처를 제거한다. */
export function cleanText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  let result = String(value);
  for (let pass = 0; pass < 2; pass += 1) {
    result = result.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key: string) => {
      if (!key.startsWith("#")) return HTML_ENTITIES[key.toLowerCase()] ?? entity;
      const codePoint = key[1]?.toLowerCase() === "x"
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : "";
    });
  }
  return result
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[연락처 생략]")
    .replace(/(?<!\d)(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|1[568]\d{2}[-.\s]\d{4})(?!\d)/g, "[연락처 생략]")
    .replace(/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\r\\n|\\n|\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function dateFromParts(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromToken(match: RegExpMatchArray): string | null {
  const month = match[2] ?? match[4] ?? match[6];
  const day = match[3] ?? match[5] ?? match[7];
  return dateFromParts(Number(match[1]), Number(month), Number(day));
}

export function parseCalendarDate(value: unknown): string | null {
  const text = asString(value);
  const matches = [...text.matchAll(new RegExp(DATE_TOKEN.source, "g"))];
  if (matches.length !== 1 || matches[0][0].trim() !== text) return null;
  return dateFromToken(matches[0]);
}

export function parseApplicationPeriod(value: unknown): { start: string | null; end: string | null } {
  const text = cleanText(value);
  const unknown = { start: null, end: null };
  if (UNCERTAIN_PERIOD.test(text)) return unknown;
  const matches = [...text.matchAll(new RegExp(DATE_TOKEN.source, "g"))];
  // 한 날짜를 시작일과 마감일로 중복 해석하지 않는다. 여러 회차도 추측하지 않는다.
  if (matches.length !== 2) return unknown;
  const separator = text.slice((matches[0].index ?? 0) + matches[0][0].length, matches[1].index);
  if (!/(?:[~～∼〜–—-]|부터|까지|\bto\b)/i.test(separator)) return unknown;
  const start = dateFromToken(matches[0]);
  const end = dateFromToken(matches[1]);
  return start && end && start <= end ? { start, end } : unknown;
}

export function getKoreaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function getProgramStatus(program: SupportProgram, today = getKoreaToday()): ProgramStatus {
  const current = parseCalendarDate(today);
  if (!current || UNCERTAIN_PERIOD.test(program.applicationPeriod)) return "unknown";
  const start = parseCalendarDate(program.applicationStart);
  const end = parseCalendarDate(program.applicationEnd);
  if (start && end && start > end) return "unknown";
  if (end && end < current) return "closed";
  if (start && start > current) return "upcoming";
  if (start && end && start <= current && current <= end) return "open";
  return "unknown";
}

/** 스냅샷에는 공식 출처만 저장한다. 유효하지 않은 URL은 식별자로 안전하게 재구성한다. */
export function officialProgramUrl(source: "bizinfo" | "kstartup", id: string, value?: unknown): string {
  if (source === "bizinfo") {
    return `https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=${encodeURIComponent(id)}`;
  }
  const fallback = `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${encodeURIComponent(id)}`;
  try {
    const url = new URL(asString(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port
      || !["k-startup.go.kr", "www.k-startup.go.kr"].includes(url.hostname.toLowerCase())) return fallback;
    url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password|authorization/i.test(key)) url.searchParams.delete(key);
    }
    if (url.searchParams.has("pbancSn")) url.searchParams.set("pbancSn", id);
    return url.toString();
  } catch {
    return fallback;
  }
}

function splitTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : asString(value).split(",");
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function collectedAt(value: unknown): string | null {
  const text = asString(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function sourceId(record: SourceRecord): string {
  return asString(record.source_id || record.pblancId);
}

function isRemoved(record: SourceRecord): boolean {
  return record.deleted === true || record.removed === true || record.listed === false
    || ["deleted", "removed"].includes(asString(record.status).toLowerCase());
}

export function latestBizinfoRecords(records: SourceRecord[], seen: SeenRecords = {}): SourceRecord[] {
  const latest = new Map<string, SourceRecord>();
  for (const record of records) {
    const id = sourceId(record);
    if (!id) continue;
    const previous = latest.get(id);
    const time = Date.parse(asString(record.fetched_at));
    const previousTime = previous ? Date.parse(asString(previous.fetched_at)) : NaN;
    if (!previous || !Number.isFinite(time) || !Number.isFinite(previousTime) || time >= previousTime) {
      latest.set(id, record);
    }
  }
  return [...latest.entries()]
    .filter(([id, record]) => seen[id]?.listed !== false && !isRemoved(record))
    .map(([, record]) => record);
}

export function normalizeBizinfo(record: SourceRecord): SupportProgram | null {
  const id = sourceId(record);
  const title = cleanText(record.title);
  if (!/^PBLN_\d+$/.test(id) || !title || isRemoved(record)) return null;
  const applicationPeriod = cleanText(record.apply_period_raw);
  const dates = parseApplicationPeriod(applicationPeriod);
  const summary = cleanText(record.overview_text);
  const regions = splitTags(record.region_tags);
  const tags = splitTags(record.hashtags);
  const target = cleanText(record.target_name) || summary.split("☞")[1]?.trim() || "공고문에서 지원 대상 확인";
  const knownCategories = ["금융", "기술", "인력", "수출", "내수", "창업", "경영", "기타"];
  return {
    id: `bizinfo:${id}`, source: "bizinfo", title, summary, target,
    category: cleanText(record.category) || tags.find((tag) => knownCategories.includes(tag)) || "기타",
    region: record.region_tag_is_nationwide_like === true ? "전국" : regions.join(", ") || "공고문 확인",
    organization: cleanText(record.exec_org || record.dept_raw),
    applicationPeriod, applicationStart: dates.start, applicationEnd: dates.end,
    url: officialProgramUrl("bizinfo", id), collectedAt: collectedAt(record.fetched_at),
    eligibilityText: summary, tags,
  };
}

export function normalizeKStartup(record: SourceRecord): SupportProgram | null {
  const id = asString(record.pbanc_sn);
  const title = cleanText(record.biz_pbanc_nm || record.intg_pbanc_biz_nm);
  if (!/^\d+$/.test(id) || !title || isRemoved(record)) return null;
  let applicationStart = parseCalendarDate(record.pbanc_rcpt_bgng_dt);
  let applicationEnd = parseCalendarDate(record.pbanc_rcpt_end_dt);
  if (applicationStart && applicationEnd && applicationStart > applicationEnd) {
    applicationStart = null;
    applicationEnd = null;
  }
  const target = cleanText(record.aply_trgt_ctnt || record.aply_trgt);
  const exclusion = cleanText(record.aply_excl_trgt_ctnt);
  // 체크박스 업력·연령·지역은 본문과 충돌할 수 있으므로 검색 단서로만 보존한다.
  return {
    id: `kstartup:${id}`, source: "kstartup", title,
    summary: cleanText(record.pbanc_ctnt), target,
    category: cleanText(record.supt_biz_clsfc) || "기타",
    region: cleanText(record.supt_regin) || "공고문 확인",
    organization: cleanText(record.pbanc_ntrp_nm || record.sprv_inst),
    applicationPeriod: `${cleanText(record.pbanc_rcpt_bgng_dt)} ~ ${cleanText(record.pbanc_rcpt_end_dt)}`,
    applicationStart, applicationEnd,
    url: officialProgramUrl("kstartup", id, record.detl_pg_url),
    collectedAt: collectedAt(record.fetched_at),
    eligibilityText: [target, exclusion ? `제외 대상: ${exclusion}` : ""].filter(Boolean).join(" "),
    tags: [...new Set([...splitTags(record.aply_trgt), ...splitTags(record.biz_enyy), ...splitTags(record.biz_trgt_age)])],
  };
}
