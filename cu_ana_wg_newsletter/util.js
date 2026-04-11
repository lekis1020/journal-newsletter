/**
 * 공통 유틸리티 함수 모음
 */

// ===== 날짜 관련 함수 =====

/**
 * 한국어 날짜 형식으로 포맷팅
 * @param {Date} date - 날짜 객체
 * @return {string} "M월 D일" 형식의 문자열
 */
function formatKoreanDate(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/**
 * PubMed 검색을 위한 날짜 형식 변환
 * @param {Date} date - 날짜 객체
 * @return {string} "YYYY/MM/DD" 형식의 문자열
 */
function formatPubMedDate(date) {
  const y = date.getFullYear();
  const m = ("0" + (date.getMonth() + 1)).slice(-2);
  const day = ("0" + date.getDate()).slice(-2);
  return `${y}/${m}/${day}`;
}

/**
 * ISO 형식 날짜 문자열 반환
 * @return {string} "YYYY-MM-DD" 형식의 오늘 날짜
 */
function getTodayISO() {
  return Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
}

// ===== 텍스트 처리 함수 =====

/**
 * 마크다운 볼드 표시를 HTML로 변환
 * @param {string} text - 변환할 텍스트
 * @return {string} 변환된 텍스트
 */
function normalizeBoldMarkup(text) {
  if (!text) return text;
  // **bold** -> <b>bold</b>
  return text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/**
 * JSON 응답에서 마크다운 코드 블록 제거
 * @param {string} jsonStr - 원본 JSON 문자열
 * @return {string} 정리된 JSON 문자열
 */
function cleanMarkdownFromJson(jsonStr) {
  return jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
}

// ===== 배열/데이터 처리 함수 =====

/**
 * 열 인덱스 찾기 (여러 후보 이름 지원)
 * @param {Array} headers - 헤더 배열
 * @param {Array} candidates - 후보 이름 배열
 * @return {number} 찾은 인덱스 (없으면 -1)
 */
function findColumnIndex(headers, candidates) {
  const normalize = (s) => String(s || "").trim().toLowerCase();
  const candidatesNorm = candidates.map(normalize).filter(Boolean);

  for (let i = 0; i < headers.length; i++) {
    if (candidatesNorm.includes(normalize(headers[i]))) {
      return i;
    }
  }
  return -1;
}

// ===== 에러 처리 함수 =====

/**
 * 재시도 로직을 포함한 API 호출
 * @param {Function} apiCallFn - 실행할 API 함수
 * @param {number} maxRetries - 최대 재시도 횟수
 * @param {number} baseDelay - 기본 대기 시간 (ms)
 * @param {number} multiplier - 지수 백오프 승수
 * @return {*} API 응답
 */
function retryApiCall(apiCallFn, maxRetries, baseDelay, multiplier) {
  maxRetries = maxRetries || CONFIG.MAX_RETRIES;
  baseDelay = baseDelay || CONFIG.RETRY_DELAY;
  multiplier = multiplier || CONFIG.RETRY_MULTIPLIER;

  let attempt = 0;
  let lastError;

  while (attempt < maxRetries) {
    try {
      return apiCallFn();
    } catch (error) {
      lastError = error;
      attempt++;

      if (attempt >= maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(multiplier, attempt - 1);
      console.log(`API 재시도 ${attempt}/${maxRetries}, 대기: ${delay}ms`);
      Utilities.sleep(delay);
    }
  }

  throw lastError;
}

// ===== HTML/이메일 관련 함수 =====

/**
 * HTML을 플레인 텍스트로 변환
 * @param {string} html - HTML 문자열
 * @return {string} 플레인 텍스트
 */
function htmlToPlainText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}