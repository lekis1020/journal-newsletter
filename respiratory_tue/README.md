# respiratory_tue

화요일 발송용 respiratory disease 뉴스레터 프로젝트입니다.

## 주제

- Asthma
- Rhinitis
- Sinusitis
- 기타 호흡기 알레르기 / 면역 관련 질환

## 워크플로우

1. PubMed 검색
2. Spreadsheet 저장
3. Gemini 요약 생성
4. 이메일 발송

## 대표 실행 함수

- `fetchSummarizeAndSendByEmail()`
- `sendEmailFromActiveSpreadsheet()`

## 주요 파일

- `Code.js`
- `email.js`
- `total.js`
- `appsscript.json`
- `.clasp.json`

## 필요한 Script Properties

- `OPENAI_API_KEY`
- `PUBMED_API_KEY`
- `EMAIL_TO_PRIMARY`
- `EMAIL_RECIPIENTS`

## 특징

- 호흡기 중심 저널과 allergy 저널을 함께 사용합니다.
- 현재는 scoring 없이 검색 결과를 바로 요약하는 구조입니다.

## 로컬 반영

```bash
cd respiratory_tue
clasp push
```
