# cutaneous_wed

수요일 발송용 cutaneous allergy / dermatology 뉴스레터 프로젝트입니다.

## 주제

- Urticaria
- Angioedema
- Atopic dermatitis
- Anaphylaxis
- 피부 알레르기 / 피부면역 관련 주제

## 현재 워크플로우

1. PubMed 검색
2. 메타데이터 / 초록 수집
3. Google Spreadsheet 저장
4. relevance scoring 수행
5. `Scores`, `Final Score`, `Included`, `Exclusion Reason` 컬럼 기록
6. `Included = O`인 논문만 GPT 요약
7. 이모지 구조를 살린 HTML 이메일 발송

## 대표 실행 함수

- `fetchSummarizeAndSendByEmail()`  
  검색 → scoring → 요약 → 이메일까지 전체 실행
- `sendEmailFromActiveSpreadsheet()`  
  현재 활성 spreadsheet 기준으로 이메일만 재발송
- `fetchAndSummarizeAll()`  
  검색 후 scoring + 요약까지 수행

## 주요 파일

- `Code.js` — PubMed 검색, scoring, 요약 생성
- `email.js` — 이메일 포맷팅 / 발송
- `total.js` — 상위 orchestration 함수
- `Code.test.js` — scoring 관련 helper 회귀 테스트
- `email.test.js` — 이메일 포맷 helper 회귀 테스트
- `.clasp.json` — Apps Script 프로젝트 연결
- `.claspignore` — push 대상 파일 제한

## 필요한 Script Properties

- `OPENAI_API_KEY`
- `PUBMED_API_KEY`
- `EMAIL_TO_PRIMARY`
- `EMAIL_RECIPIENTS`

## 로컬 작업

```bash
cd cutaneous_wed
clasp push
```

## 테스트

```bash
cd /path/to/journal-newsletter
node --test cutaneous_wed/Code.test.js cutaneous_wed/email.test.js
```

## 메모

- scoring 결과는 spreadsheet에 직접 남습니다.
- 이메일에는 `Included = O`이며 요약이 정상 생성된 논문만 포함됩니다.
- 요약 포맷의 `📔 / 🗓️ / 📒 / 👤 / 🎯 / Tag` 구조를 메일 렌더링에서 유지하도록 보강되어 있습니다.
