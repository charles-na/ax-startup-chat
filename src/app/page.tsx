"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ChatMessage, ChatResponse, ProgramSource, Recommendation } from "@/lib/types";
import { categoryLabel } from "@/lib/retrieval";

type IconName = "spark" | "chat" | "plus" | "arrow" | "search" | "database" | "external" | "check" | "pin" | "building" | "calendar" | "refresh" | "warning" | "chevron";
type DataInfo = {
  total: number;
  bySource: { bizinfo: number; kstartup: number };
  updatedAt: string | null;
  open: number;
  unknown: number;
};

const SOURCE_NAMES: Record<ProgramSource, string> = { bizinfo: "기업마당", kstartup: "K-Startup" };
const STARTERS = [
  { icon: "building" as const, label: "초기 창업 지원", text: "서울에서 창업한 지 1년 된 초기 스타트업입니다. 사업화 자금 지원사업을 찾고 있어요." },
  { icon: "spark" as const, label: "기술 개발 · R&D", text: "경기도에 있는 AI 소프트웨어 중소기업입니다. 기술 개발과 R&D 지원사업을 추천해 주세요." },
  { icon: "external" as const, label: "해외 진출 지원", text: "부산의 제조 중소기업입니다. 해외 시장 진출과 수출 마케팅을 지원하는 사업이 궁금해요." },
];

function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z" /></>,
    chat: <><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2V12a9 9 0 0 1 9-9h1a8 8 0 0 1 8 8Z" /><path d="M7 10h8M7 14h5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    external: <><path d="M14 4h6v6M20 4 10 14" /><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    building: <><path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 7h4M8 11h4M8 15h4M9 21v-3h3v3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h2" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.5 6a7 7 0 0 1 12 1L20 12M4 12l1.5 5a7 7 0 0 0 12 1" /></>,
    warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17v.1" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "업데이트 확인 중";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "수집 일시 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(date);
}

async function fetchDataInfo(signal: AbortSignal): Promise<DataInfo> {
  const result = await fetch("/api/programs", { signal });
  if (!result.ok) throw new Error("데이터 정보를 불러오지 못했습니다.");
  return await result.json() as DataInfo;
}

function requestMessages(messages: ChatMessage[]): ChatMessage[] {
  const history = messages.slice(-20).map((message) => ({ ...message, content: message.content.slice(0, 2000) }));
  let length = history.reduce((total, message) => total + message.content.length, 0);
  while (length > 20000 && history.length > 1) {
    length -= history.shift()!.content.length;
  }
  return history;
}

function RecommendationCard({ recommendation, index }: { recommendation: Recommendation; index: number }) {
  const { program, reasons, scoreKind, score } = recommendation;
  const statusText = { open: "모집 중", upcoming: "접수 예정", closed: "마감", unknown: "기간 확인 필요" }[program.status];
  const safeUrl = /^https?:\/\//i.test(program.url) ? program.url : null;
  const normalizedScore = Number.isFinite(score) ? Math.round(Math.max(0, Math.min(1, score)) * 100) : 0;
  return (
    <article className="program-card">
      <div className="program-card-top">
        <span className="program-source"><span className={`source-dot ${program.source}`} />{SOURCE_NAMES[program.source]}</span>
        <span className={`status-tag ${program.status}`}>{statusText}</span>
      </div>
      <div className="program-title-row"><span className="rank-number">{String(index + 1).padStart(2, "0")}</span><h3>{program.title}</h3></div>
      <p className="program-summary">{program.summary || program.target || "세부 지원 내용은 공고 원문에서 확인해 주세요."}</p>
      <dl className="program-details">
        <div><dt><Icon name="building" size={15} /><span className="sr-only">수행기관</span></dt><dd>{program.organization || "수행기관 확인 필요"}</dd></div>
        <div><dt><Icon name="calendar" size={15} /><span className="sr-only">접수기간</span></dt><dd className="program-period" title={program.applicationPeriod || undefined}>{program.status === "unknown" ? <><span>기간 확인 필요</span>{program.applicationPeriod && program.applicationPeriod !== "기간 확인 필요" && <span className="period-original">{program.applicationPeriod}</span>}</> : <span className="period-original">{program.applicationPeriod || "기간 확인 필요"}</span>}</dd></div>
        {program.region && <div><dt><Icon name="pin" size={15} /><span className="sr-only">지역</span></dt><dd>{program.region}</dd></div>}
      </dl>
      {reasons.length > 0 && <div className="match-reasons">{reasons.slice(0, 2).map((reason, i) => <span key={`${i}-${reason}`}><Icon name="check" size={13} />{reason}</span>)}</div>}
      <div className="program-card-bottom"><span className="match-score">{scoreKind === "jev_probability" ? "조건 적합도" : "검색 점수"}<strong>{normalizedScore}{scoreKind === "jev_probability" ? "%" : "점"}</strong></span>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">공고 보기<Icon name="external" size={14} /></a> : <span className="missing-link">원문 링크 확인 필요</span>}</div>
    </article>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<"all" | ProgramSource>("all");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null);
  const [dataError, setDataError] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const dataRequestRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const count = dataInfo?.total ?? response?.meta.totalPrograms;

  async function loadData() {
    dataRequestRef.current?.abort();
    const controller = new AbortController();
    dataRequestRef.current = controller;
    try {
      const body = await fetchDataInfo(controller.signal);
      if (!controller.signal.aborted) {
        setDataError(false);
        setDataInfo(body);
      }
    } catch {
      if (!controller.signal.aborted) setDataError(true);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    dataRequestRef.current = controller;
    void fetchDataInfo(controller.signal).then((body) => {
      if (!controller.signal.aborted) setDataInfo(body);
    }).catch(() => {
      if (!controller.signal.aborted) setDataError(true);
    });
    return () => { dataRequestRef.current?.abort(); requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, error]);

  async function sendMessage(text: string = draft) {
    const content = text.trim().slice(0, 2000);
    if (!content || sendingRef.current) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    const controller = new AbortController();
    requestRef.current = controller;
    sendingRef.current = true;
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setLoading(true);
    try {
      const result = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages(nextMessages), source, includeClosed }),
        signal: controller.signal,
      });
      const body = await result.json();
      if (!result.ok) throw new Error(typeof body.error === "string" ? body.error : "답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (controller.signal.aborted) return;
      const chatResponse = body as ChatResponse;
      setResponse(chatResponse);
      setMessages([...nextMessages, { role: "assistant", content: chatResponse.message }]);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "연결에 문제가 발생했습니다. 다시 시도해 주세요.");
        setMessages(messages);
        setDraft(content);
      }
    } finally {
      if (requestRef.current === controller) {
        sendingRef.current = false;
        setLoading(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }

  function resetConversation() {
    requestRef.current?.abort();
    requestRef.current = null;
    sendingRef.current = false;
    setMessages([]);
    setResponse(null);
    setDraft("");
    setError(null);
    setLoading(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="검색 설정">
        <Link className="brand" href="/" aria-label="AX Startup 홈"><span className="brand-mark"><Icon name="spark" size={23} /></span><span><strong>AX Startup<span className="brand-period">.</span></strong><small>지원사업 어시스턴트</small></span></Link>
        <button className="new-chat" onClick={resetConversation}><Icon name="plus" size={18} />새 대화 시작<span className="new-chat-shortcut">↗</span></button>
        <div className="workspace-navigation"><p className="sidebar-label">워크스페이스</p><div className="nav-active"><Icon name="chat" size={18} /><span>지원사업 찾기</span><span className="nav-indicator" /></div></div>
        <fieldset className="source-filter"><legend className="sidebar-label">검색 데이터</legend>{(["all", "bizinfo", "kstartup"] as const).map((item) => <label className={`source-option ${source === item ? "selected" : ""}`} key={item}><input type="radio" name="source" value={item} checked={source === item} onChange={() => setSource(item)} /><span className="radio-mark" /><span>{item === "all" ? "전체 지원사업" : SOURCE_NAMES[item]}</span><span className="source-count">{item === "all" ? count?.toLocaleString("ko-KR") ?? "—" : dataInfo?.bySource[item]?.toLocaleString("ko-KR") ?? "—"}</span></label>)}</fieldset>
        <div className="closed-setting"><label className="toggle-label"><span>마감 사업 포함</span><input type="checkbox" checked={includeClosed} onChange={(event) => setIncludeClosed(event.target.checked)} /><span className="toggle-track" /></label><p>검색 조건은 다음 메시지부터 적용됩니다.</p></div>
        <div className="sidebar-bottom"><div className="data-status"><div className="data-status-heading"><Icon name="database" size={17} /><span>수집 데이터</span><span className="live-dot" /></div><strong>{count?.toLocaleString("ko-KR") ?? "—"}<small>개의 지원사업</small></strong><p>{dataError ? "데이터 정보를 불러오지 못했어요." : dateLabel(dataInfo?.updatedAt ?? response?.meta.dataUpdatedAt)}</p>{dataError && <button className="data-retry" onClick={() => void loadData()}><Icon name="refresh" size={13} />다시 불러오기</button>}<span className="data-sources">기업마당 + K-Startup</span></div><div className="sidebar-footnote"><span className="footnote-logo">ax</span><span>기업의 다음 가능성을 함께.</span></div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">워크스페이스<Icon name="chevron" size={12} /><span>지원사업 찾기</span></div><span className="data-badge"><span />수집 데이터 기반 추천</span></header>
        <div className="workspace-content">
          <section className="page-intro"><div><div className="eyebrow"><span />기업에 맞는 다음 기회</div><h1>우리 기업의 다음 기회,<br className="mobile-break" /> 함께 찾아볼까요?</h1><p>기업의 상황을 알려주시면, 조건에 맞는 지원사업을 찾아드려요.</p></div><div className="intro-decoration" aria-hidden="true"><Icon name="spark" size={42} /></div></section>

          <div className="workspace-grid">
            <section className="chat-panel" aria-label="지원사업 추천 대화">
              <div className="panel-heading"><span className="heading-icon"><Icon name="chat" size={18} /></span><h2>어시스턴트와 대화</h2><span className="conversation-badge">{messages.length ? "조건을 알아가는 중" : "대화를 시작해 보세요"}</span></div>
              <div className="conversation" ref={conversationRef} role="log" aria-label="대화 내용" aria-live="polite" aria-relevant="additions text">
                <div className="assistant-message welcome-message"><span className="assistant-avatar"><Icon name="spark" size={17} /></span><div className="message-content"><div className="message-author">AX 어시스턴트<span>지원사업 길잡이</span></div><div className="assistant-bubble"><p>안녕하세요! 우리 기업에 맞는<br /><strong>지원사업을 함께 찾아드릴게요.</strong></p><p className="welcome-detail">사업 분야, 소재지, 창업 단계와 필요한 지원을 편하게 알려주세요. 대화를 나누며 더 적합한 공고를 찾아볼 수 있어요.</p><div className="welcome-example"><span>이렇게 이야기해 주세요</span><p>“서울에서 AI 서비스를 만드는 예비 창업자예요.<br />사업화 자금 지원을 받고 싶어요.”</p></div></div></div></div>
                {messages.length === 0 && <div className="quick-starts"><p>어디서 시작할지 고민된다면</p><div>{STARTERS.map((starter) => <button key={starter.label} onClick={() => void sendMessage(starter.text)} disabled={loading}><Icon name={starter.icon} size={15} />{starter.label}<Icon name="chevron" size={12} /></button>)}</div></div>}
                {messages.map((message, index) => message.role === "user" ? <div className="user-message" key={`${index}-user`}><div className="user-bubble">{message.content}</div><span className="user-label">나</span></div> : <div className="assistant-message" key={`${index}-assistant`}><span className="assistant-avatar"><Icon name="spark" size={17} /></span><div className="message-content"><div className="message-author">AX 어시스턴트</div><div className="assistant-bubble reply-bubble">{message.content}</div></div></div>)}
                {loading && <div className="assistant-message"><span className="assistant-avatar"><Icon name="spark" size={17} /></span><div className="message-content"><div className="message-author">AX 어시스턴트</div><div className="assistant-bubble loading-bubble"><span className="typing-dots"><i /><i /><i /></span><span>기업 조건에 맞는 공고를 찾고 있어요</span></div></div></div>}
                {error && <div className="error-message" role="alert"><Icon name="warning" size={17} /><span>{error}</span></div>}
              </div>
              <form className="composer-area" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}><div className="composer"><label className="sr-only" htmlFor="chat-input">기업 조건이나 원하는 지원사업을 입력하세요. 최대 2,000자까지 입력할 수 있습니다.</label><textarea ref={inputRef} id="chat-input" placeholder="우리 기업의 상황이나 필요한 지원을 알려주세요…" value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} rows={2} disabled={loading} /><button type="submit" className="send-button" disabled={!draft.trim() || loading} aria-label="메시지 보내기"><Icon name="arrow" size={19} /></button></div><div className="composer-caption"><span>Enter 전송<span className="caption-divider">·</span>Shift + Enter 줄바꿈</span><span>공고의 자격 요건은 원문에서 확인해 주세요.</span></div></form>
            </section>

            <section className="recommendations-panel" aria-label="추천 지원사업" aria-busy={loading}>
              <div className="recommendations-heading"><div><span className="section-kicker">대화 조건 기반 추천</span><h2>추천 지원사업{response && <span>{response.recommendations.length}</span>}</h2></div><span className={`recommendation-status ${loading ? "searching" : ""}`}><span />{loading ? "분석 중" : response ? "추천 완료" : "대화 대기"}</span></div>
              {response ? <><div className="results-meta"><span>{categoryLabel(response.classification.category)}</span><span>{response.meta.eligiblePrograms.toLocaleString("ko-KR")}개 공고에서 탐색</span></div>{response.meta.warnings.length > 0 && <div className="matching-notice" role="status"><Icon name="warning" size={15} /><div>{response.meta.warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div></div>}{response.meta.matchingEngine === "local" && <div className="engine-note"><Icon name="search" size={14} />현재 수집 데이터의 검색 점수로 추천하고 있어요.</div>}<div className={`program-list ${loading ? "updating" : ""}`}>{response.recommendations.length > 0 ? response.recommendations.map((recommendation, index) => <RecommendationCard key={`${recommendation.program.source}-${recommendation.program.id}`} recommendation={recommendation} index={index} />) : <div className="no-results"><Icon name="search" size={27} /><h3>조건에 맞는 공고를 찾지 못했어요.</h3><p>사업 분야나 지역을 더 알려주거나, 검색 조건을 넓혀 보세요.</p>{response.meta.excludedClosed > 0 && !includeClosed && <p className="closed-hint">마감된 공고 {response.meta.excludedClosed.toLocaleString("ko-KR")}개가 제외되었어요. ‘마감 사업 포함’을 켜고 다시 메시지를 보내면 과거 공고도 찾아볼 수 있어요.</p>}</div>}</div><p className="score-disclaimer">{response.meta.matchingEngine === "jev" ? "조건 적합도는 기업 조건과 공고의 매칭 점수이며, 선정 확률을 의미하지 않습니다." : "검색 점수는 대화 내용과 공고의 관련도를 나타냅니다. 지원 자격 충족이나 선정을 보장하지 않습니다."}</p></> : <div className="recommendation-empty"><div className="empty-art" aria-hidden="true"><div className="art-card art-card-back" /><div className="art-card art-card-front"><div className="art-card-icon"><Icon name="building" size={21} /></div><span /><span /><div className="art-card-lines"><i /><i /></div></div><span className="art-spark"><Icon name="spark" size={25} /></span><span className="art-check"><Icon name="check" size={16} /></span></div><h3>대화가 기회로 이어지는 곳</h3><p>기업의 이야기를 들려주시면<br />맞춤 지원사업이 이곳에 나타나요.</p><div className="criteria-list"><span><span className="criteria-number">01</span>업종 및 사업 분야</span><span><span className="criteria-number">02</span>기업 소재지와 창업 단계</span><span><span className="criteria-number">03</span>필요한 지원과 사업 목표</span></div><div className="empty-footer"><Icon name="database" size={14} />기업마당 · K-Startup 수집 공고를 탐색해요</div></div>}
            </section>
          </div>
          <footer className="workspace-footer"><span>발견은 대화에서, 확인은 공고에서.</span><span>AX STARTUP CHAT</span></footer>
        </div>
      </main>
    </div>
  );
}
