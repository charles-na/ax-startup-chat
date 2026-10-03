# ax-startup-chat

기업마당(Bizinfo)·K-Startup 수집 JSON을 근거로, 대화의 현재 조건에 맞는 지원사업을 추천하는 한국어 챗봇입니다. Next.js App Router, TypeScript, pnpm을 사용합니다.

각 대화 턴은 다음 흐름으로 처리합니다.

1. 이전 대화와 새 입력을 받아 지원 목적을 Jev `Choice`로 분류합니다.
2. 날짜와 출처를 확인하고, 수집 데이터에서 키워드·분류에 맞는 후보를 검색합니다.
3. Jev `Noul`로 후보별 독립 적합도를 판정하고 상위 3건을 표시합니다.
4. DeepSeek가 추천 후보의 원문 정보와 대화 기록으로 설명·후속 질문을 생성합니다.

추천 카드의 제목·기간·출처 링크는 JSON에서 직접 제공합니다. 모델이 만든 사업이나 점수를 카드에 추가하지 않습니다. 적합도는 질문에 대한 모델의 추정값이며 **선정 확률이나 최종 지원자격 판정이 아닙니다**. API 키가 없거나 요청이 실패하면 로컬 검색과 기본 안내를 사용하고 화면에 그 상태를 표시합니다.

## 실행

Node.js 22 이상과 pnpm 10.24.0을 사용합니다. 기존 `ax-startup`과 같은 상위 폴더에 clone하면 기본 데이터 경로가 맞습니다.

```text
git-projects/
  ax-startup/
  ax-startup-chat/
```

```bash
pnpm install --frozen-lockfile
pnpm data:sync
cp .env.example .env.local
pnpm dev
```

브라우저에서 http://localhost:3000 을 엽니다. 키를 입력하지 않아도 로컬 검색으로 실행할 수 있습니다. 실제 AI 상담은 `.env.local`에 `JEV_API_KEY`와 `LLM_API_KEY`를 입력한 뒤 서버를 다시 시작하세요.

```dotenv
JEV_API_KEY=콘솔에서_발급한_키
JEV_API_URL=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
LLM_PROVIDER=deepseek
LLM_API_KEY=DeepSeek_키
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
```

공식 키 발급: [TypeSafe AI](https://console.typesafe.ai/), [DeepSeek](https://platform.deepseek.com/). `TYPESAFE_API_KEY`와 `DEEPSEEK_API_KEY`도 별칭으로 지원합니다. 키는 서버에서만 사용하며 `NEXT_PUBLIC_` 변수에 넣지 않습니다.

## 데이터 동기화

```bash
pnpm data:sync --source ../ax-startup
```

기업마당은 `data/bizinfo/store/versions.jsonl`의 최신 버전과 `seen.json`의 삭제 상태를 우선 사용합니다. 스토어가 없으면 `bizinfo_sample_60건.json`을 사용합니다. K-Startup은 `data/kstartup/kstartup_sample_200건.json`을 가져옵니다. 원본 수집기를 실행하거나 기존 저장소를 수정하지 않습니다.

생성 파일은 `data/programs.json`과 `data/manifest.json`입니다. 수집 원본과 환경 키를 새 원격 저장소에 복제하지 않도록 생성 데이터는 git에서 제외합니다. 새 clone이나 배포 환경에서도 먼저 동기화한 다음 빌드하세요. 다른 머신에서는 원본 JSON이 있는 경로를 `--source`로 지정하면 됩니다. 데이터가 없으면 앱은 0건으로 실행되고 동기화를 안내합니다.

최초 가져온 데이터는 기업마당 1,427건과 K-Startup 200건, 총 1,627건입니다. 최신 기업마당 수집 시각은 2026-10-03T11:47:24Z이며 K-Startup 표본에는 수집 시각이 없어 별도로 추정하지 않습니다. 동기화 시 생성한 시각과 실제 수집 시각은 manifest에서 구분합니다. 서버는 데이터를 메모리에 캐시하므로 실행 중 다시 동기화했다면 서버를 재시작하세요.

사업명·설명 HTML을 정리하고 출처별 공고 ID로 중복을 제거합니다. 현재 날짜는 한국 시간으로 계산합니다. 마감일은 당일 자정까지 포함하며, 예산 소진·상시 모집·불명확한 기간은 ‘기간 확인 필요’로 표시합니다. 수집 당시 모집 플래그나 넓은 지역·업력 체크박스만으로 자격을 확정하지 않습니다. 기본 검색은 마감 사업을 제외하며 화면에서 포함하도록 바꿀 수 있습니다.

## API와 비용

2026-10-03 공식 문서 확인 기준이며, 가격은 USD/100만 토큰입니다.

| 모델 | 입력 | 출력 | 용도 |
|---|---:|---:|---|
| Jev | $0.042 | 무료 | 분류·후보 적합도 |
| DeepSeek Flash 비혼잡 | $0.15 | $0.60 | 기본 대화 모델 |
| DeepSeek Flash 혼잡 | $0.30 | $1.20 | 같은 모델, 시간별 요금 |
| Groq GPT-OSS 20B | $0.075 | $0.30 | 더 저렴한 대화 대안 |

출처: [Jev 모델·가격](https://docs.typesafe.ai/models), [DeepSeek 모델·가격](https://api-docs.deepseek.com/quick_start/pricing/), [Groq GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b). DeepSeek 혼잡 시간은 중국 공휴일을 제외한 평일 UTC 01~04시·06~10시입니다. 캐시 요금과 Jev 사용량은 별도이므로 표의 대화 요금만으로 전체 요청 비용을 산정하지 마세요.

Groq GPT-OSS 20B는 DeepSeek 비혼잡 요금의 절반입니다. 한국어 지원사업 상담 품질은 실제 질문으로 비교한 후 선택하세요. 교체하려면 다음 설정을 사용합니다.

```dotenv
LLM_PROVIDER=compatible
LLM_API_KEY=Groq_키
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-20b
```

Jev 공식 endpoint는 `POST https://api.typesafe.ai/v1/systemone`입니다. 후보마다 `Noul` 질문을 보내 독립적인 0~1 값을 받습니다. `Choice`의 상대 분류 확률을 사업별 적합도로 재사용하지 않습니다. [Jev API](https://docs.typesafe.ai/api), [공식 추천 순위 재평가 예제](https://docs.typesafe.ai/cookbooks/rerank_typesafe)

기본적으로 한 턴에 Jev 분류 1회, 후보 적합도 1회, 대화 1회를 호출합니다. 후보는 6개까지 전송하며 `MATCH_CANDIDATE_LIMIT`으로 3~20개를 설정합니다. 전체 1,627건을 매번 대화 모델에 보내지 않습니다. 후보 검색에서 빠진 사업은 Jev도 평가하지 못하므로, 실제 추천 품질을 평가할 때 후보 검색과 최종 순위를 함께 확인하세요. [Jev의 알려진 한계](https://docs.typesafe.ai/model-jaggedness/jev-1.13)에 따라 날짜 계산은 코드로 처리하며, 한국어 적합도는 도메인별 검증이 필요합니다.

## 검증과 운영

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
# 전체 검증
pnpm check
```

`POST /api/chat`은 `{ messages, includeClosed, source }`를 받습니다. `messages`는 user/assistant 역할 1~20개, 각 2,000자 이하, 전체 20,000자 이하이며 마지막 메시지는 user여야 합니다. 응답은 설명·추천·분류·모델 사용 상태를 포함합니다. `GET /api/programs`는 출처별 건수·기간 상태·수집 시각을 반환합니다.

대화는 브라우저 메모리에만 유지하고 서버에서 저장하지 않습니다. 새 대화를 누르거나 새로고침하면 초기화됩니다. API에는 최근 20개 메시지를 각 2,000자·전체 20,000자 이내로 전달합니다. 긴 대화의 오래된 조건은 다시 알려주세요. 실제 API 모드에서는 대화 조건과 후보 원문이 지정한 외부 제공자에 전송됩니다. 인증, 사용자별 영속 기록, 분산 요청 제한은 아직 구현하지 않았습니다. 공개 운영 시 호스팅의 접근·요청 제한을 설정하세요. 서버의 동시 8건 제한은 단일 프로세스 범위입니다.

초기 개발 환경은 터미널 외부 네트워크가 차단되어 기존 캐시의 Next.js 16.3.0으로 독립 설치·검증했습니다. 타입·린트·테스트 34개·프로덕션 빌드와 실제 JSON의 API 직접 호출을 확인했습니다. 로컬 포트 bind도 환경에서 제한되어 브라우저 동작 검증은 수행하지 못했습니다. 연결 가능한 환경에서는 공식 최신 패치 버전을 확인하고 Next.js와 eslint-config-next를 함께 업데이트하세요. 외부 API 계약은 모의 응답으로 검증했으며 실제 인증·한국어 응답 품질 검증에는 발급된 키가 필요합니다.

저장소 원격 주소: https://github.com/charles-na/ax-startup-chat.git
