# zerlegen-lernen

독일어 단어를 형태소·어근·접사 단위로 탐색하고, 관사와 어원을 함께 학습하는 Next.js 웹 서비스입니다.

## 현재 구현된 기반 기능

- 영어 Wiktionary MediaWiki API + Cheerio 기반 독일어 뜻·어원·관사 추출
- Etymology의 `Equivalent to … + …` 또는 링크 기반 `… + …` 표기를 따르는 형태소 분해
- 대소문자 후보를 canonical page ID로 해석하는 명사·동사·형용사·접사 통합 조회
- URL/브라우저 히스토리와 동기화되는 단계형 재귀 탐색 흐름
- `der`(파랑), `die`(분홍), `das`(초록) 관사 표시
- 브라우저 Local Storage 기반 표 형태 단어장 탭
- 즐겨찾기와 CEFR 난이도(A1–B2)를 사용하는 AI 예문/빈칸 퀴즈 API

> 형태소 분해는 영어 Wiktionary가 현대 독일어 분해식을 명시한 경우에만 제공합니다. 문자열 모양만 보고 접사를 추측하지 않습니다.

## 기술 스택

- Next.js App Router, React, TypeScript
- Tailwind CSS
- Axios, Cheerio
- OpenAI 호환 Chat Completions API (`gpt-4o-mini` 기본값)

## 설치 및 실행

Node.js 20.9 이상을 권장합니다.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다. 단어 검색은 API 키 없이 사용할 수 있습니다. AI 퀴즈 생성에는 `.env.local`의 `OPENAI_API_KEY`가 필요합니다.

## 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` | AI 기능 사용 시 | 서버에서만 읽는 LLM API 키 |
| `LLM_API_URL` | 아니요 | OpenAI 호환 Chat Completions URL |
| `LLM_MODEL` | 아니요 | 기본값 `gpt-4o-mini` |

실제 `.env.local`은 Git에서 제외됩니다. 키를 클라이언트 코드나 `NEXT_PUBLIC_` 변수에 넣지 마세요.

## 명령어

```bash
npm run dev        # 개발 서버
npm run typecheck  # TypeScript 검사
npm run lint       # ESLint 검사
npm run build      # 프로덕션 빌드
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
  types.ts                 # 공유 타입
  wiktionary.ts            # MediaWiki 응답 파서
```

## API 예시

```bash
curl "http://localhost:3000/api/parse?word=Lehrer"

curl -X POST "http://localhost:3000/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"level":"A2","words":[{"word":"Lehrer","article":"der","meaning":"교사"}]}'
```

Wiktionary 콘텐츠와 링크를 서비스에 표시할 때는 해당 프로젝트의 라이선스 및 attribution 요건을 확인하세요.
