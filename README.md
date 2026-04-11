# Journal Newsletter

PubMed 논문 자동 검색, AI 요약, 이메일 발송 시스템.

Google Apps Script 기반으로, 주제별 최신 논문을 자동 수집하여 GPT 요약과 함께 뉴스레터로 발송합니다.

## 프로젝트 구조

| 디렉토리 | 주제 | 주기 |
|----------|------|------|
| `cu_ana_wg_newsletter` | 두드러기/혈관부종/아나필락시스/비만세포증/식품알레르기 | 주간 |
| `cutaneous_wed` | 피부과 | 수요일 |
| `eos_immune_wg_newsletter` | 호산구/면역 워킹그룹 | 주간 |
| `immune_THU` | 면역 | 목요일 |
| `meta_rct_rev_mon` | Meta-Analysis / RCT / Review | 월요일 |
| `respiratory_tue` | 호흡기 | 화요일 |
| `environment-newsletter` | 환경 | - |

## 기술 스택

- **런타임**: Google Apps Script
- **논문 검색**: PubMed E-utilities API (ESearch + EFetch)
- **AI 요약**: OpenAI GPT API (gpt-5-mini)
- **배포**: clasp (Google Apps Script CLI)

---

## cu_ana_wg_newsletter

CU-Ana Working Group 뉴스레터 - 두드러기/혈관부종/아나필락시스/비만세포증/식품알레르기 분야의 최신 논문을 자동 수집, 평가, 요약하여 이메일로 발송합니다.

### 파일 구성

| 파일 | 역할 |
|------|------|
| `Code.js` | PubMed 검색, 점수 산정, GPT 요약 |
| `config.js` | 설정 (API 키, 저널 목록, 검색 파라미터) |
| `email.js` | 이메일 HTML 생성 및 발송 |
| `total.js` | 전체 워크플로우 오케스트레이션 |
| `util.js` | 공통 유틸리티 함수 |

### 워크플로우

```
runWeeklyDigestWorkflow()
│
├─ 1. fetchPubMedWeeklyAndSave()       # PubMed 검색 → 스프레드시트 저장
├─ 2. scoreAndFilterPapers()            # 점수 산정 → Top 15 선정
├─ 3. summarizePubMedArticlesWithGPT()  # GPT 한국어 요약 생성
└─ 4. sendSummariesToEmail()            # 이메일 발송
```

### 1단계: PubMed 검색

주제 중심(Topic-centered) 검색 방식을 사용합니다. 저널 필터 없이 키워드와 날짜 범위만으로 검색하여 모든 저널에서 관련 논문을 포착합니다.

**PubMed 쿼리 구조:**
```
(최근 7일 EDAT 날짜 범위) AND (키워드 필터)
```

**검색 키워드 (Title/Abstract):**

| 카테고리 | 키워드 |
|---------|--------|
| 두드러기 | urticaria, chronic spontaneous urticaria, CSU, CIndU, inducible urticaria |
| 혈관부종 | angioedema, hereditary angioedema, HAE, bradykinin-mediated angioedema |
| 아나필락시스 | anaphylaxis, anaphylactic shock |
| 비만세포증 | mastocytosis, mast cell, systemic/cutaneous mastocytosis, MCAS, mast cell activation |
| 식품알레르기 | food allergy, food hypersensitivity, oral immunotherapy, OIT, FPIES |

- 최대 검색 결과: 200건
- 검색 기간: 최근 7일 (전자출판일 EDAT 기준)

### 2단계: 점수 산정 및 필터링

각 논문에 대해 3가지 점수를 합산하여 관련성을 평가합니다.

#### A. 키워드 관련성 (Base Score: 0~5)

Regex 기반(기본) 또는 GPT 기반 키워드 탐지:

| 조건 | 점수 |
|------|------|
| 제목 + 초록 모두 매칭 | 5 |
| 제목만 또는 초록만 매칭 | 2 |
| 매칭 없음 | 0 |

두드러기/아나필락시스/비만세포증 카테고리 중 **최고점**을 사용합니다.

#### B. 저널 가산점 (Journal Score: 0~3)

Impact Factor 기반 4단계 티어 시스템:

| 티어 | IF 범위 | 가산점 | 대표 저널 |
|------|---------|--------|----------|
| Tier 1 | IF ≥ 30 | +3 | NEJM, Lancet, JAMA, BMJ, Nat Med, Nat Rev Immunol, Ann Intern Med |
| Tier 2 | IF 10-30 | +2 | Lancet/JAMA 계열, Nat Immunol, Blood, JACI, Allergy, BJD, JAAD, JCI |
| Tier 3 | IF 5-10 | +1 | JACI Practice/Global, Clin Exp Allergy, Front Immunol 등 |
| Tier 4 | IF < 5 | 0 | 기타 저널 |

#### C. 출판 유형 (Publication Score: -5~+2)

| 유형 | 점수 |
|------|------|
| Meta-Analysis, Systematic Review, RCT | +2 |
| Clinical Trial, Cohort, Observational 등 | +1 |
| Neutral | 0 |
| Case Report | -1 |
| Editorial, Letter, Comment | -2 |
| Correction, Erratum, Retraction | -5 |

#### 최종 선정

```
최종 점수 = Base Score + Journal Score + Publication Score
```

- 최소 포함 점수: **3점** (`MIN_RELEVANCE_SCORE`)
- 3점 이상 중 **상위 15건** 선정 (`MAX_INCLUSION`)

### 3단계: GPT 요약

Included 논문에 대해 GPT-5-mini로 한국어 요약을 생성합니다.

**요약 형식:**
- 날짜, 저널, 저자 (처음 3명 + 교신저자)
- 질환, 연구방법 (2-3줄), 주요 결과 (2-3줄)
- 임상적 의의, 한계점
- 해시태그 (#질환 #기전 #약물)

의학 용어는 영어 원문을 유지하며, 약물명/사이토카인/임상시험명은 볼드 처리합니다.

### 4단계: 이메일 발송

- Slate Navy 디자인 테마
- 논문별 카드 형식 (넘버링 포함)
- PubMed 링크 포함
- 주 수신자 + BCC 수신자 발송

### 설정

Google Apps Script Properties Service에서 다음 키를 설정해야 합니다:

| 키 | 설명 |
|----|------|
| `OPENAI_API_KEY_SCORING` | GPT 점수 평가용 API 키 |
| `OPENAI_API_KEY_SUMMARY` | GPT 요약 생성용 API 키 |
| `PUBMED_API_KEY` | PubMed API 키 |
| `EMAIL_RECIPIENTS` | BCC 수신자 목록 |
| `EMAIL_TO_PRIMARY` | 주 수신자 |

### 주요 설정값 (config.js)

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `DAYS_RANGE` | 7 | 검색 기간 (일) |
| `MAX_RESULTS` | 200 | 최대 검색 결과 수 |
| `MIN_RELEVANCE_SCORE` | 3 | 최소 관련성 점수 |
| `MAX_INCLUSION` | 15 | 최대 포함 논문 수 |
| `SCORING_MODE` | regex | 점수 평가 방식 (regex / gpt) |
| `GPT_MODEL` | gpt-5-mini | GPT 모델 |

---

## 배포

```bash
# clasp 설치
npm install -g @google/clasp

# 로그인
clasp login

# 프로젝트 디렉토리에서 push
cd cu_ana_wg_newsletter
clasp push
```

## 라이선스

Private repository - Internal use only.
