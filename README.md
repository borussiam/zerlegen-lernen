# zerlegen-lernen

독일어 단어를 형태소·어근·접사 단위로 탐색하고, 관사와 어원을 함께 학습하는 Next.js 웹 서비스입니다.

## 현재 구현된 기반 기능

- 영어 Wiktionary MediaWiki API + Cheerio 기반 독일어 뜻·어원·관사 추출
- A1–B2 필수 어휘 2,500개 사전 파싱 캐시와 서버 메모리 인덱스
- Neon Postgres 기반 신규 검색 단어 영구 저장
- Etymology의 `Equivalent to … + …` 또는 링크 기반 `… + …` 표기를 따르는 형태소 분해
- 대소문자 후보를 canonical page ID로 해석하는 명사·동사·형용사·접사 통합 조회
- URL/브라우저 히스토리와 동기화되는 단계형 재귀 탐색 흐름
- `der`(파랑), `die`(분홍), `das`(초록) 관사 표시
- 브라우저 Local Storage 기반 표 형태 단어장 탭
- 독립적인 학습 완료 상태와 1·3·7·30일 간격의 오늘의 복습 흐름
- 즐겨찾기와 CEFR 난이도(A1–B2)를 사용하는 AI 예문/빈칸 퀴즈 API

> 형태소 분해는 영어 Wiktionary가 현대 독일어 분해식을 명시한 경우에만 제공합니다. 문자열 모양만 보고 접사를 추측하지 않습니다.

## 기술 스택

- Next.js App Router, React, TypeScript, Vitest
- Tailwind CSS
- Axios, Cheerio, Neon Postgres
- OpenAI 호환 Chat Completions API (`gpt-4o-mini` 기본값)

## 설치 및 실행

Node.js 22 이상을 사용합니다.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다. 기본 단어와 Wiktionary 검색은 AI API 키 없이 사용할 수 있습니다. `DATABASE_URL`이 없으면 로컬에서는 신규 단어를 `data/runtime-vocabulary.json`에 저장합니다.

## 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 배포 시 | Neon Postgres 연결 문자열. 서버에서만 사용합니다. |
| `NEXT_PUBLIC_AI_ENABLED` | 아니요 | `true`일 때만 AI 퀴즈 UI/API를 활성화합니다. |
| `OPENAI_API_KEY` | AI 기능 사용 시 | 서버에서만 읽는 LLM API 키 |
| `LLM_API_URL` | 아니요 | OpenAI 호환 Chat Completions URL |
| `LLM_MODEL` | 아니요 | 기본값 `gpt-4o-mini` |

실제 `.env.local`은 Git에서 제외됩니다. DB 연결 문자열과 API 키를 클라이언트 코드나 `NEXT_PUBLIC_` 변수에 넣지 마세요. `NEXT_PUBLIC_AI_ENABLED`에는 비밀값이 아닌 기능 플래그만 저장합니다.

## Neon 데이터베이스

배포 환경에서는 기본 JSON 데이터에 없는 단어를 Wiktionary에서 파싱한 뒤 Neon의 `runtime_words` 테이블에 저장합니다. 다음 검색부터는 DB 결과를 사용하며 `/api/words`의 자동완성 목록에도 합쳐집니다. DB가 일시적으로 실패해도 Wiktionary 파싱 결과 자체는 반환하며, 이 경우에만 해당 결과가 영구 저장되지 않을 수 있습니다.

Neon SQL Editor에서 `db/schema.sql`을 실행하거나 로컬 `DATABASE_URL`을 설정한 뒤 다음 명령을 사용합니다.

```bash
npm run db:migrate
npm run db:seed-runtime
```

두 번째 명령은 Git에서 제외된 기존 `data/runtime-vocabulary.json`의 단어를 Neon으로 이전합니다.

## 단어장과 복습 데이터

단어장, 학습 완료 상태, 복습 일정, 관사 정답 연속 기록은 계정이나 서버 데이터베이스 없이 현재 브라우저의 Local Storage에만 저장됩니다. 브라우저 데이터 삭제, 시크릿 모드 종료, 다른 브라우저·기기로 이동할 때는 자동으로 동기화되거나 복구되지 않습니다.

저장 형식은 `zerlegen-lernen:favorites` 키의 버전 2 envelope(`{ version: 2, words: [...] }`)입니다. 이전 버전의 배열 형식은 처음 불러올 때 별표와 추가 시각을 보존한 채 자동 변환되며, 기존 단어가 자동으로 학습 완료 처리되지는 않습니다.

학습 완료 단어는 뜻/관사 모름 표시와 상호 배타적입니다. 완료 처리하면 첫 복습이 24시간 뒤에 예약되고, 성공할 때마다 3일, 7일, 30일 간격으로 진행됩니다. 30일 단계 이후에는 30일 간격을 반복하며, 복습에서 모름을 선택해도 완료 상태는 유지되고 다음 복습만 24시간 뒤로 재설정됩니다.

## 명령어

```bash
npm run dev        # 개발 서버
npm test           # Wiktionary 파서 단위 테스트
npm run typecheck  # TypeScript 검사
npm run lint       # ESLint 검사
npm run build      # 프로덕션 빌드
npm run db:migrate # Neon 테이블과 인덱스 생성
npm run db:seed-runtime # 기존 로컬 런타임 단어를 Neon으로 이전
npm run data:build # 1.5초 간격으로 2,500개 캐시 재구축/이어받기
npm start          # 빌드 결과 실행
```

## 폴더 구조

```text
app/
  api/parse/route.ts       # Wiktionary 조회·분석
  api/generate/route.ts    # AI 문장·빈칸 퀴즈 생성
  globals.css
  layout.tsx
  page.tsx
components/
  word-workbench.tsx       # 검색, 결과, 즐겨찾기, 퀴즈 UI
lib/
  german-word.ts           # 독일어 표제어 대소문자 후보
  preparsed-words.ts       # 사전 파싱 데이터 서버 인덱스
  runtime-vocabulary-store.ts # Neon 런타임 단어 저장소
  spaced-repetition.ts     # 단어장 마이그레이션·완료 전환·복습 일정
  types.ts                 # 공유 타입
  wiktionary.ts            # MediaWiki 응답 파서
scripts/
  build-preparsed-words.ts # 재시작 가능한 2,500개 데이터 빌더
  migrate-runtime-vocabulary.ts # Neon 스키마 적용
  seed-runtime-vocabulary.ts # 기존 로컬 단어 이전
public/data/
  pre-parsed-words.json    # 빌드된 A1–B2 사전 캐시
```

## API 예시

```bash
curl "http://localhost:3000/api/parse?word=Lehrer"

curl -X POST "http://localhost:3000/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"level":"A2","words":[{"word":"Lehrer","article":"der","meaning":"교사"}]}'
```

Wiktionary 콘텐츠와 링크를 서비스에 표시할 때는 해당 프로젝트의 라이선스 및 attribution 요건을 확인하세요.

## Vercel 배포

Vercel에서 이 GitHub 저장소를 Next.js 프로젝트로 가져오고 Production Branch를 `main`, Node.js를 22로 설정합니다. Neon Marketplace 연동 후 `DATABASE_URL`이 Production과 Preview 환경에 연결되었는지 확인하고 `db/schema.sql`을 한 번 적용합니다. 이후 PR에는 Preview 배포가 생성되고 `main` 병합은 프로덕션 주소에 자동 배포됩니다.

AI 기능은 기본적으로 꺼져 있습니다. 추후 `OPENAI_API_KEY`를 서버 환경 변수로 추가한 뒤 `NEXT_PUBLIC_AI_ENABLED=true`로 설정하고 재배포하면 활성화됩니다.
