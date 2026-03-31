/**
 * 화요일 - 호흡기 논문 위주 (천식, 비염 등)
 * 설정, 상수, 공용 헬퍼 함수
 */

// ===== 설정 및 상수 =====

const CONFIG = {
  OPENAI_API_KEY: '',  // Script Properties에서 가져옴
  GEMINI_API_KEY: '',  // Script Properties에서 가져옴
  PUBMED_API_KEY: '',  // Script Properties에서 가져옴
  GEMINI_MODEL: 'gemini-2.5-flash',
  MAX_RETRIES: 5,
  RETRY_DELAY: 5000,
  RETRY_MULTIPLIER: 2,
  JOURNALS: [
    "The Journal of allergy and clinical immunology",
    "Allergy",
    "Annals of allergy, asthma & immunology",
    "Clinical and experimental allergy",
    "The journal of allergy and clinical immunology. In practice",
    "Allergology international",
    "The World Allergy Organization journal",
    "NEJM evidence",
    "The New England journal of medicine",
    "Chest",
    "The Lancet. Respiratory medicine",
    "American journal of respiratory and critical care medicine",
    "The European respiratory journal",
    "Thorax",
    "Respiratory research",
    "Respiratory medicine",
    "The Journal of asthma",
    "Current Opinion in Allergy and Clinical Immunology",
    "Journal of Investigational Allergology and Clinical Immunology",
    "Allergy and asthma proceedings",
    "Allergy, asthma, and clinical immunology",
    "Allergy, Asthma and Immunology Research",
    "Allergy, Asthma and Respiratory Disease",
    "Frontiers in Immunology"
  ],
  PUB_TYPES: [
    "Meta-Analysis",
    "Randomized Controlled Trial",
    "Review",
    "Systematic Review",
    "Original article"
  ],
  DAYS_RANGE: 7,
  MAX_RESULTS: 100,
  MIN_RELEVANCE_SCORE: 3,
  MAX_INCLUSION: 15,
  EMAIL_RECIPIENTS: '',
  EMAIL_TO_PRIMARY: '',
  EMAIL_SUBJECT_PREFIX: '[Ajou Allergy Journal Letter]',
  SUMMARY_BATCH_SIZE: 10,              // 한 번 실행에 요약할 최대 논문 수
  EMAIL_BATCH_SIZE: 15,
  EMAIL_MAX_LENGTH: 100000
};

const MESSAGES = {
  NO_ABSTRACT: "초록을 찾을 수 없습니다.",
  NO_PMID: "PMID를 찾을 수 없습니다.",
  SUMMARY_HEADER: "Gemini 요약",
  COLUMN_HEADERS: ["Title", "Journal", "Year", "PMID", "Publication Type", "Gemini 요약"]
};

// ===== Script Properties 헬퍼 =====

function getSecret(key, fallback) {
  const props = PropertiesService.getScriptProperties();
  const value = props.getProperty(key);
  return value || fallback || '';
}

// ===== 공용 헬퍼 함수 =====

function buildColumnLayout(existingHeaders, desiredHeaders) {
  const finalHeaders = existingHeaders.slice();
  const headersToAppend = [];
  const indexMap = {};

  desiredHeaders.forEach(function(header) {
    let idx = finalHeaders.indexOf(header);
    if (idx === -1) {
      headersToAppend.push(header);
      finalHeaders.push(header);
      idx = finalHeaders.length - 1;
    }
    indexMap[header] = idx;
  });

  return { finalHeaders: finalHeaders, headersToAppend: headersToAppend, indexMap: indexMap };
}

function ensureSheetColumns(sheet, headers, desiredHeaders) {
  const layout = buildColumnLayout(headers, desiredHeaders);
  if (layout.headersToAppend.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, layout.headersToAppend.length).setValues([layout.headersToAppend]);
  }
  return layout.indexMap;
}

function shouldSummarizeRow(includedValue, hasIncludedColumn) {
  if (!hasIncludedColumn) return true;
  return includedValue === "O" || includedValue === "" || typeof includedValue === "undefined";
}

function formatPaperDateValue(dateValue, utilitiesRef) {
  if (!dateValue) return "";
  if (dateValue instanceof Date) {
    return utilitiesRef.formatDate(dateValue, "GMT+9", "yyyy년 MM월 dd일");
  }
  return String(dateValue);
}
