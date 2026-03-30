

/**
 * * 화요일 - 호흡기 논문 위주로 (천식, 비염 등등)
 * PubMed 논문 검색 및 GPT 요약 시스템
 * 1. PubMed에서 최근 논문 검색
 * 2. 논문 초록 및 메타데이터 수집
 * 3. GPT를 사용한 요약 생성
 * 4. 결과를 스프레드시트에 저장
 */

// ===== 1. 설정 및 상수 =====

const CONFIG = {
  OPENAI_API_KEY: '',  // Script Properties에서 가져옴
  PUBMED_API_KEY: '',  // Script Properties에서 가져옴
  GPT_MODEL: 'gpt-5-mini',                // GPT 모델명 (gpt-5-mini, gpt-4o-mini, gpt-4-turbo 등)
  MAX_RETRIES: 3,                    // 재시도 횟수
  RETRY_DELAY: 1000,                 // 기본 대기(ms)
  RETRY_MULTIPLIER: 2,               // 재시도 지수 백오프 승수
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
  DAYS_RANGE: 7,                     // 몇 일 전 논문부터 검색할지
  MAX_RESULTS: 100,                    // 최대 검색 결과 수
  MIN_RELEVANCE_SCORE: 3,              // 최소 관련성 점수
  MAX_INCLUSION: 15,                   // Top N 논문만 요약
  EMAIL_RECIPIENTS: '',  // Script Properties에서 가져옴
  EMAIL_TO_PRIMARY: '',  // Script Properties에서 가져옴
  EMAIL_SUBJECT_PREFIX: '[Ajou Allergy Journal Letter]', // 이메일 제목 접두사
  EMAIL_BATCH_SIZE: 15, // 한 이메일에 포함할 논문 요약 수
  EMAIL_MAX_LENGTH: 100000 // 이메일 최대 길이 제한 (Gmail은 대략 25MB 제한)
};

// 메시지 상수
const MESSAGES = {
  NO_ABSTRACT: "초록을 찾을 수 없습니다.",
  NO_PMID: "PMID를 찾을 수 없습니다.",
  SUMMARY_HEADER: "GPT 요약",
  COLUMN_HEADERS: ["Title", "Journal", "Year", "PMID", "Publication Type", "GPT 요약"]
};

// ===== 1-1. Script Properties 헬퍼 =====

/**
 * Script Properties에서 비밀 설정값을 가져옵니다.
 * 설정 방법: 스크립트 에디터 > 프로젝트 설정 > 스크립트 속성에 키 추가
 *   - OPENAI_API_KEY
 *   - PUBMED_API_KEY
 * @param {string} key - 속성 키
 * @param {string} [fallback] - 기본값 (Properties에 없을 경우)
 * @returns {string}
 */
function getSecret(key, fallback) {
  const props = PropertiesService.getScriptProperties();
  const value = props.getProperty(key);
  return value || fallback || '';
}

// ===== 1-2. 헬퍼 함수 =====

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

// ===== 2. 메인 실행 함수 =====

/**
 * 전체 워크플로우 실행 함수 (scoring 포함)
 */
function fetchAndSummarizeAll() {
  const spreadsheet = fetchPubMedWeeklyAndSave();
  if (spreadsheet) {
    SpreadsheetApp.setActiveSpreadsheet(spreadsheet);
    scoreAndFilterPapers(spreadsheet);
    summarizePubMedArticlesWithGPT(spreadsheet);
  }
}

// ===== 3. PubMed 검색 및 데이터 가져오기 =====

/**
 * PubMed에서 최근 1주일간의 논문 검색 및 저장
 */
// 2. fetchPubMedWeeklyAndSave 함수 수정 - 스프레드시트 객체 반환
function fetchPubMedWeeklyAndSave() {
  // 1. 검색 쿼리 준비
  const journalQuery = CONFIG.JOURNALS.map(journal => `"${journal}"[Journal]`).join(" OR ");
  const pubTypeQuery = CONFIG.PUB_TYPES.map(type => `"${type}"[Publication Type]`).join(" OR ");
  const meshTerms = ["asthma","rhinitis","rhinitis, allergic","sinusitis","nasal polyps","bronchial hyperreactivity","eosinophilic esophagitis","aspirin-exacerbated respiratory disease","cough","respiratory hypersensitivity"];
  const meshQuery = meshTerms.map(term => `"${term}"[MeSH Terms]`).join(" OR ");
  const diseaseTerms = ["asthma","rhinitis","allergic rhinitis","sinusitis","nasal polyp","chronic rhinosinusitis","eosinophilic","bronchial hyperresponsiveness","AERD","aspirin-exacerbated"];
  const diseaseQuery = diseaseTerms.map(term => `"${term}"[Title]`).join(" OR ");

  // 2. 날짜 범위 설정
  const today = new Date();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(today.getDate() - CONFIG.DAYS_RANGE);
  
  const formatDate = date => {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    return `${year}/${month}/${day}`;
  };
  
  const startDate = formatDate(oneWeekAgo);
  const endDate = formatDate(today);
  const dateRange = `"${startDate}"[EDAT] : "${endDate}"[EDAT]`;
  
  // 3. 최종 쿼리 생성 및 URL 인코딩
  const finalQuery = `(${journalQuery}) AND ((${diseaseQuery}) OR (${meshQuery})) AND (${dateRange})`;
  const encodedQuery = encodeURIComponent(finalQuery);
  
  // 4. PubMed API 호출
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodedQuery}&retmax=${CONFIG.MAX_RESULTS}&sort=pubdate&retmode=json&api_key=${getSecret('PUBMED_API_KEY')}`;
  console.log(url);
  try {
    const response = UrlFetchApp.fetch(url);
    const json = JSON.parse(response.getContentText());
    const idList = json.esearchresult.idlist;
    
    // 5. 검색 결과 확인
    if (idList.length === 0) {
      console.log('최근 1주일간 검색된 논문이 없습니다.');
      return null;  // 결과가 없으면 null 반환
    }
    
    // 6. 검색된 논문의 상세 정보 가져오기
    console.log(`총 ${idList.length}개의 논문 ID를 가져왔습니다.`);
    const results = fetchPubMedData(idList);
    
    // 7. 결과를 스프레드시트에 저장하고 스프레드시트 객체 반환 (수정된 부분)
    return saveResultsToSheet(results);
    
  } catch (error) {
    console.error('PubMed 검색 실패:', error);
    return null;  // 오류 발생시 null 반환
  }
}
/**
 * PubMed에서 여러 논문의 상세 정보 가져오기
 * @param {string[]} idList - PMID 배열
 * @return {Array} 논문 데이터 배열
 */
/**
 * PubMed에서 논문 데이터를 가져오는 통합 함수
 * 단일 PMID 또는 PMID 배열을 처리할 수 있음
 * 
 * @param {string|string[]} pmidInput - 단일 PMID 또는 PMID 배열
 * @param {Object} options - 옵션 객체 (상세 정보 지정 등)
 * @return {Object|Array} 단일 객체 또는 논문 데이터 배열
 */
function fetchPubMedData(pmidInput, options = {}) {
  const defaults = {
    includeAbstract: true, // 초록 포함 여부
    includeAuthors: true,  // 저자 정보 포함 여부
    detailedFormat: false, // true: 객체 형식 반환, false: 배열 형식 반환
    maxRetries: CONFIG.MAX_RETRIES
  };
  
  const settings = { ...defaults, ...options };
  const isSinglePmid = typeof pmidInput === 'string';
  const pmids = isSinglePmid ? [pmidInput] : pmidInput;
  
  try {
    console.log(`PubMed 데이터 가져오기 시작: ${isSinglePmid ? '단일 PMID' : pmids.length + '개 PMID'}`);
    
    if (pmids.length === 0) {
      console.warn('PMID가 제공되지 않았습니다.');
      return isSinglePmid ? {} : [];
    }
    
    // XML 형식으로 상세 정보 가져오기
    const ids = pmids.join(",");
    const detailUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids}&retmode=xml`;
    
    // 재시도 로직 적용
    let attempt = 0;
    let xmlResponse;
    
    while (attempt < settings.maxRetries) {
      try {
        xmlResponse = UrlFetchApp.fetch(detailUrl).getContentText();
        break;
      } catch (fetchError) {
        attempt++;
        if (attempt >= settings.maxRetries) throw fetchError;
        
        // 지수 백오프
        const delay = CONFIG.RETRY_DELAY * Math.pow(CONFIG.RETRY_MULTIPLIER, attempt - 1);
        Utilities.sleep(delay);
        console.log(`PubMed API 재시도 ${attempt}/${settings.maxRetries}, 대기: ${delay}ms`);
      }
    }
    
    const document = XmlService.parse(xmlResponse);
    const root = document.getRootElement();
    const articles = root.getChildren('PubmedArticle');
    
    console.log(`XML 파싱 완료, ${articles.length}개 논문 처리 중...`);
    
    // 결과 저장 배열
    const results = [];
    
    articles.forEach(article => {
      try {
        const citation = article.getChild('MedlineCitation');
        if (!citation) {
          console.log('MedlineCitation 요소를 찾을 수 없습니다.');
          return;
        }
        
        const articleNode = citation.getChild('Article');
        if (!articleNode) {
          console.log('Article 요소를 찾을 수 없습니다.');
          return;
        }
        
        // 제목 추출
        const titleNode = articleNode.getChild('ArticleTitle');
        const articleTitle = titleNode ? titleNode.getText() : 'No Title';
        
        // 저널 추출
        const journalNode = articleNode.getChild('Journal');
        const journalTitleNode = journalNode ? journalNode.getChild('Title') : null;
        const journal = journalTitleNode ? journalTitleNode.getText() : 'No Journal';
        
        // 출판 날짜 정보 추출
        const journalIssueNode = journalNode ? journalNode.getChild('JournalIssue') : null;
        const pubDateNode = journalIssueNode ? journalIssueNode.getChild('PubDate') : null;
        const pubYear = pubDateNode && pubDateNode.getChild('Year') ? pubDateNode.getChild('Year').getText() : 'NA';
        const pubMonth = pubDateNode && pubDateNode.getChild('Month') ? pubDateNode.getChild('Month').getText() : 'NA';
        const pubDay = pubDateNode && pubDateNode.getChild('Day') ? pubDateNode.getChild('Day').getText() : 'NA';
        
        // 날짜 형식 구성
        let pubDate = pubYear;
        if (pubMonth !== 'NA') pubDate += ` ${pubMonth}`;
        if (pubDay !== 'NA') pubDate += ` ${pubDay}`;
        
        // PMID 추출
        const pmid = citation.getChild('PMID') ? citation.getChild('PMID').getText() : 'No PMID';
        
        // 출판 유형 추출
        const pubTypeListNode = articleNode.getChild('PublicationTypeList');
        let pubTypeList = '';
        
        if (pubTypeListNode) {
          const pubTypes = pubTypeListNode.getChildren('PublicationType');
          pubTypeList = pubTypes.map(pt => pt.getText()).join(", ");
        }
        
        // 초록 추출 (설정에 따라)
        let abstract = '';
        if (settings.includeAbstract) {
          const abstractNode = articleNode.getChild('Abstract');
          if (abstractNode) {
            const abstractTextNodes = abstractNode.getChildren('AbstractText');
            abstract = abstractTextNodes.map(node => {
              const label = node.getAttribute('Label');
              const text = node.getText();
              return label ? `${label}: ${text}` : text;
            }).join("\n");
          }
        }
        
        // 저자 정보 추출 (설정에 따라)
        let authors = '';
        if (settings.includeAuthors) {
          const authorListNode = articleNode.getChild('AuthorList');
          if (authorListNode) {
            const authorNodes = authorListNode.getChildren('Author');
            authors = authorNodes.map(author => {
              const lastName = author.getChild('LastName') ? author.getChild('LastName').getText() : '';
              const initials = author.getChild('Initials') ? author.getChild('Initials').getText() : '';
              return lastName + (initials ? ` ${initials}` : '');
            }).join(", ");
          }
        }
        
        // 결과 형식에 따라 반환 데이터 구성
        if (settings.detailedFormat) {
          // 객체 형식 (키-값 페어)
          results.push({
            title: articleTitle,
            journal: journal,
            pubDate: pubDate,
            authors: authors,
            pmid: pmid,
            publicationType: pubTypeList,
            abstract: abstract
          });
        } else {
          // 배열 형식 (순서가 중요)
          const resultRow = [articleTitle, journal, pubDate, authors, pmid, pubTypeList, abstract];
          // 옵션에 따라 추가 필드 포함         
          results.push(resultRow);
        }
        
      } catch (articleError) {
        console.error('개별 논문 파싱 중 오류:', articleError);
      }
    });
    
    console.log(`${results.length}개 논문의 데이터 처리 완료`);
    
    // 단일 PMID인 경우 첫 번째 결과만 반환, 그렇지 않으면 전체 배열 반환
    return isSinglePmid ? (results[0] || (settings.detailedFormat ? {} : [])) : results;
    
  } catch (error) {
    console.error('PubMed 데이터 가져오기 실패:', error);
    throw error;
  }
}

// ===== 4. 데이터 저장 함수 =====

/**
 * 논문 데이터를 새 스프레드시트에 저장
 * @param {Array} data - 논문 데이터 배열
 */

// 1. saveResultsToSheet 함수 수정 - 스프레드시트 객체 반환
function saveResultsToSheet(data) {
  try {
    const today = new Date();
    const formattedDate = Utilities.formatDate(today, "GMT+9", "yyyyMMdd");
    const fileName = `respiratory_tue_${formattedDate}`;
    
    // 새로운 스프레드시트 생성 후 데이터 저장
    const spreadsheet = SpreadsheetApp.create(fileName);
    const sheet = spreadsheet.getActiveSheet();
    sheet.setName("journal_crawl_db");
    
    // 헤더 추가
    sheet.getRange(1, 1, 1, 7).setValues([["Title", "Journal", "Date", "Authors","PMID", "Publication Type","Abstract"]]);
    
    // 데이터 입력
    if (data.length > 0) {
      sheet.getRange(2, 1, data.length, 7).setValues(data);
      
      // 스타일 적용
      sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
      sheet.setFrozenRows(1);
      
      // 열 너비 자동 조정
      sheet.autoResizeColumns(1, 7);
    }
    
    console.log(`스프레드시트 "${fileName}" 생성 완료, 총 ${data.length}개 데이터 저장됨`);
    
    // 링크 얻기
    const url = spreadsheet.getUrl();
    console.log(`스프레드시트 URL: ${url}`);
    
    // 스프레드시트 객체 반환 
    return spreadsheet;
    
  } catch (error) {
    console.error('스프레드시트 저장 실패:', error);
    throw error;
  }
}

// ===== GPT JSON 호출 (scoring 용) =====

function callGPTJson(prompt) {
  const url = "https://api.openai.com/v1/chat/completions";
  const payload = {
    model: CONFIG.GPT_MODEL,
    messages: [
      { role: "system", content: "You analyze medical papers for keywords. Return only valid JSON." },
      { role: "user", content: prompt }
    ],
    max_completion_tokens: 500,
    reasoning_effort: "minimal",
    response_format: { type: "json_object" }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${getSecret('OPENAI_API_KEY')}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        Utilities.sleep(CONFIG.RETRY_DELAY * Math.pow(CONFIG.RETRY_MULTIPLIER, attempt - 2));
      }
      const res = UrlFetchApp.fetch(url, options);
      if (res.getResponseCode() !== 200) {
        throw new Error(JSON.parse(res.getContentText()).error?.message || `Status ${res.getResponseCode()}`);
      }
      const json = JSON.parse(res.getContentText());
      const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (content) return content.trim();
    } catch (e) {
      console.error(`GPT JSON 오류 (${attempt}/${CONFIG.MAX_RETRIES}):`, e.message);
      if (attempt >= CONFIG.MAX_RETRIES) break;
    }
  }
  return null;
}

// ===== 스코어링 & Top N 필터링 =====

function scoreAndFilterPapers(spreadsheet) {
  const sheet = spreadsheet.getSheetByName("journal_crawl_db");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const titleIdx = headers.indexOf("Title");
  const abstractIdx = headers.indexOf("Abstract");
  if (titleIdx === -1 || abstractIdx === -1) { console.error("필수 컬럼 누락"); return; }

  const scoreCols = ["Scores", "Final Score", "Included", "Exclusion Reason"];
  const scoreColMap = ensureSheetColumns(sheet, headers, scoreCols);

  const rows = data.slice(1);
  const results = rows.map(function(row, i) {
    var title = row[titleIdx];
    var abstract = String(row[abstractIdx] || "").trim();

    if (!abstract) return { details: "No Abstract", score: 0, included: false, reason: "No Abstract" };

    try {
      var jsonStr = callGPTJson('Detect keywords in title/abstract:\n\nTitle: "' + title + '"\nAbstract: "' + abstract + '"\n\nCategories:\n1. RESPIRATORY_ALLERGY: asthma, allergic rhinitis, rhinitis, sinusitis, nasal polyp, chronic rhinosinusitis, eosinophilic, bronchial hyperresponsiveness, AERD, aspirin-exacerbated respiratory disease, cough hypersensitivity\n2. AIRWAY_INFLAMMATION: airway remodeling, mucus, epithelial barrier, type 2 inflammation, ILC2, alarmin, TSLP, IL-4, IL-5, IL-13, biologics\n\nReturn JSON: {"hasRespAllergyInTitle":true/false,"hasRespAllergyInAbstract":true/false,"hasAirwayInflamInTitle":true/false,"hasAirwayInflamInAbstract":true/false}');

      if (!jsonStr) return { details: "GPT Error", score: 0, included: false, reason: "GPT 응답 없음" };

      var cleanStr = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      var f = JSON.parse(cleanStr);

      var respScore = (f.hasRespAllergyInTitle && f.hasRespAllergyInAbstract) ? 5
        : (f.hasRespAllergyInTitle ? 2 : 0) + (f.hasRespAllergyInAbstract ? 2 : 0);
      var airwayScore = (f.hasAirwayInflamInTitle && f.hasAirwayInflamInAbstract) ? 5
        : (f.hasAirwayInflamInTitle ? 2 : 0) + (f.hasAirwayInflamInAbstract ? 2 : 0);
      var score = Math.max(respScore, airwayScore);

      Utilities.sleep(500);
      return {
        details: JSON.stringify(f), score: score,
        included: score >= CONFIG.MIN_RELEVANCE_SCORE,
        reason: "Resp(" + respScore + ") Airway(" + airwayScore + ") = " + score
      };
    } catch (e) {
      console.error("Row " + (i + 2) + " scoring error:", e);
      return { details: "Error", score: 0, included: false, reason: e.message };
    }
  });

  // Top N 선정
  var passed = [];
  for (var i = 0; i < results.length; i++) {
    if (results[i].included) passed.push({ idx: i, score: results[i].score });
  }
  passed.sort(function(a, b) { return b.score - a.score; });

  var topSet = {};
  for (var j = 0; j < Math.min(passed.length, CONFIG.MAX_INCLUSION); j++) {
    topSet[passed[j].idx] = true;
  }

  var updates = results.map(function(r, idx) {
    var isFinal = r.included && topSet[idx];
    var reason = (r.included && !topSet[idx]) ? r.reason + " (Top " + CONFIG.MAX_INCLUSION + " 초과)" : r.reason;
    return [r.details, r.score, isFinal ? "O" : "X", reason];
  });

  scoreCols.forEach(function(header, colOffset) {
    var columnValues = updates.map(function(row) { return [row[colOffset]]; });
    sheet.getRange(2, scoreColMap[header] + 1, columnValues.length, 1).setValues(columnValues);
  });

  var includedCount = updates.filter(function(u) { return u[2] === "O"; }).length;
  console.log("스코어링 완료: " + rows.length + "건 중 " + includedCount + "건 선정");
}

/**
 * GPT API 호출 함수
 * @param {string} prompt - 프롬프트 텍스트
 * @return {string} GPT 응답 텍스트
 */
function callGPT(prompt) {
  const url = "https://api.openai.com/v1/chat/completions";
  const payload = {
    model: CONFIG.GPT_MODEL,
    messages: [{ role: "user", content: prompt }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${getSecret('OPENAI_API_KEY')}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error(json.error.message);
  }

  return json.choices[0].message.content.trim();
}

/**
 * @param {SpreadsheetApp.Spreadsheet} spreadsheet - 요약 논문 결과 스프레드시트
 * @return {string} GPT 요약 결과
 */
// 3. summarizePubMedArticlesWithGPT 함수 수정 - 스프레드시트 매개변수 추가

function summarizePubMedArticlesWithGPT(spreadsheet) {
  console.log("논문 GPT 요약 작업 시작...");

  // 스프레드시트 / 시트 확인
  let sheet;
  try {
    // 매개변수로 받은 스프레드시트 사용
    sheet = spreadsheet.getSheetByName('journal_crawl_db');
    if (!sheet) {
      console.error("'journal_crawl_db' 시트를 찾을 수 없습니다.");
      return "시트 없음";
    }
  } catch (error) {
    console.error("시트 접근 오류:", error);
    return "시트 접근 오류" + error.message;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    console.error("데이터가 없습니다.");
    return "데이터 없음";
  }

  // 헤더 행 읽기
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // 필요한 열 인덱스 찾기
  const titleIdx = headers.indexOf("Title");
  const journalIdx = headers.indexOf("Journal");
  const dateIdx = headers.indexOf("Date");
  const authorsIdx = headers.indexOf("Authors");
  const pmidIndex = headers.indexOf("PMID");
  const pubtypeIdx = headers.indexOf("Publication Type");
  const abstractIdx = headers.indexOf("Abstract");
  const includedIdx = headers.indexOf("Included");

  // 필수 열 확인
  if (titleIdx === -1 || abstractIdx === -1 || pmidIndex === -1) {
    return "필수 열(제목, PMID, 초록)을 찾을 수 없습니다.";
  }
  const lastCol = sheet.getLastColumn();

  // 요약 결과 열 추가
  const summaryColMap = ensureSheetColumns(sheet, headers, [MESSAGES.SUMMARY_HEADER]);
  const targetCol = summaryColMap[MESSAGES.SUMMARY_HEADER] + 1;
  
// 데이터 전체 가져오기
  const dataRows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  let successCount = 0;
  let failCount = 0;
  const startTime = new Date().getTime();
  //let lastSaveTime = startTime;
  //console.log(`총 ${pmids.length}개의 PMID에 대해 요약을 진행합니다.`);
  

for (let i = 0; i < dataRows.length; i++) {
    // Included="O" 만 요약 (스코어링 단계가 있는 경우)
    if (!shouldSummarizeRow(dataRows[i][includedIdx], includedIdx !== -1)) {
      continue;
    }
    const rowIndex = i + 2;
    const row = dataRows[i];

    const pmid = row[pmidIndex] || "";
    const title = row[titleIdx] || "";
    const journal = row[journalIdx] || "";
    const date = row[dateIdx] || "";
    const authors = row[authorsIdx] || "";
    const pubtype = row[pubtypeIdx] || "";
    const abstract = row[abstractIdx] || "";

    if (!pmid) {
      console.log(`행 ${rowIndex}: PMID가 없어서 스킵`);
      sheet.getRange(rowIndex, targetCol).setValue(MESSAGES.NO_PMID);
      failCount++;
      continue;
    }

    if (!abstract) {
      console.log(`행 ${rowIndex}: 초록이 없어서 스킵`);
      const formattedDate = formatPaperDateValue(date, Utilities);
      const message = `초록이 없습니다.\n 📅: ${formattedDate} \n 📒: ${journal}\n ${pubtype}\n 👥: ${authors}`;
      sheet.getRange(rowIndex, targetCol).setValue(message);
      
      failCount++;
      continue;
    }
    //if (!abstract) {
    //  console.log(`행 ${rowIndex}: 초록이 없어서 스킵`);
    //  sheet.getRange(rowIndex, targetCol).setValue(MESSAGES.NO_ABSTRACT);
    //  failCount++;
    //  continue;
    //}

    try {
      // GPT 프롬프트 구성
      const prompt = `
아래의 논문을 전문가 대상 뉴스레터용으로 요약해 주세요. 다음 형식과 기준을 반드시 따라 주십시오:
다음은 의학 논문의 메타데이터입니다:

제목: ${title}  
저널: ${journal}  
출판 일자: ${date}  
저자: ${authors}  
PMID: ${pmid}  
초록: ${abstract}

위 정보를 바탕으로 아래 형식으로 **요약만 출력**해 주세요.  

요약 시 주의사항:
  1. **제공된 정보만 사용**하고, **없는 정보는 빈칸으로 남겨주세요 (No hallucination)**  
	2.	의학 전문가용 뉴스레터이므로 불필요하게 쉬운 말로 풀지 말고, 핵심 용어는 그대로 사용하세요.
	3.	한국어로 요약하되, 원문의 의미와 문맥이 왜곡되지 않도록 합니다.
	4.	Tag 항목은 3~5개의 핵심 해시태그를 생성해주세요.
	5.	정보가 없는 항목은 생략하지 말고 “-”로 표시해주세요.
  6. **연구 방법**은 연구 종류를 먼저 명시하고, 초록을 참고해 간략히 요약해 주세요.  
  7. **의학 용어는 영어 그대로**, 저자는 1,2,3 저자 및 교신저자만, 이후는 et al 로 표시.  
  8. 본문에서 의미상 중요한 단어는 이메일로 출력 시 진한 글씨체로 표시될 수 있도록 "<b>" "</b>" 로 감싸서 표시해줘. 
  9. 의미상 중요한 단어로는 cytokine 이름, 연구에서 분석한 약제 이름, clinical trial 의 이름 등이 해당하고, 이러한 단어는 8번의 표시를 붙여줘. 
  10. 핵심 결과 요약 영역에서 가장 중요한 내용은 "<u>"  "</u>" 로 감싸서 표시해줘.

No hallucination

출력 형식은 아래와 같습니다: (영문 원문 기준 요약 후, 한국어로 정리):

  
  • 🗓️: [일시]  
  • 📒: [출판사 이름]
  • 👤: [제1,2,3 저자 및 교신저자 et al.]
  • 주요 대상 질환: [논문에서 주로 다루는 질환명]
  • 연구 방법: [연구 디자인 또는 리뷰라면 주요 논의점 요약 (2~3줄)] 
  • 🎯: [핵심 결과 요약. 임상적으로 중요한 정보 포함 (2~3줄)] 
  • 임상적용 가능성: [해당 연구가 임상 진료에 미칠 수 있는 영향. 가능하면 구체적으로]
  • 제한점: [해당 연구의 한계 또는 아직 밝혀지지 않은 점]  
  • Tag: #[질환] #[기전/중요한 키워드1] #[기전/중요한 키워드2] #[약물명 또는 연구종류 등]

다음은 출력 예시입니다. 

• 🗓️: Tue Apr 01 2025
• 📒: Allergy
• 👤: Domingo C, Busse WW, Hanania NA, et al.
• 주요 대상 질환: Allergic Asthma
• 연구 방법: 이 리뷰 연구에서는 IgE의 <b>기도 상피세포</b>에 대한 직접적이고 간접적인 역할에 대해 논의하였으며, 알레르기성 천식 질환에 초점을 맞추었습니다.
• 🎯: IgE는 알레르기성 기도 질환에서 핵심 분자로, T2 inflammation 및 <b>기도 상피 내 리모델링</b> 과정에서 중요한 역할을 합니다. IgE와 기도 상피 간 복잡한 상호작용 네트워크에 대한 더 깊은 이해는 천식 병리생리학에 대한 이해를 향상시킬 것입니다.
• 임상적용 가능성: IgE를 차단하는 omalizumab은 알레르기성 천식 치료에 효과적인 것으로 나타났습니다.
• 제한점: IgE의 기도 상피세포에 대한 역할은 덜 알려져 있습니다.
• Tag: #AllergicAsthma #AirwayEpithelium #IgE


• 🗓️: Tue Apr 01 2025 
• 📒: The Journal of Allergy and Clinical Immunology
• 👤: Akenroye A, Boyce JA, Kita H
• 주요 대상 질환: Asthma
• 연구 방법: Allergy와 2형(T2) 중재 기도염증의 메커니즘 연구를 통해 천식 치료를 위한 다양한 항체 치료법을 개발하고, 특히 <b>alarmin</b>과 그들의 수용체를 대상으로 한 치료법에 대해 검토하였습니다.
• 🎯: <b>Alarmins</b>과 그들의 수용체를 대상으로 한 치료법은 <b>T2-high 및 T2-low asthma</b> 치료에 효과적일 수 있으며, 이미 <b>tezepelumab</b>이라는 alarmins 대상 항체가 severe asthma 치료를 위해 승인 받았습니다.
• 임상적용 가능성: Alarmins과 그들의 수용체를 대상으로 한 치료법은 asthma의 정밀 의학 분야에서 새로운 전선을 열 수 있습니다.
• 제한점: 아직 많은 T2-high 천식 환자들이 IgE- 또는 T2 사이토카인 대상 치료에 반응하지 않고, T2-low 천식 환자들에게는 치료 옵션이 적다는 점입니다.
• Tag: #asthma #alarmin #precisonal_treatment #tezepelumab


• 🗓️: Tue Apr 01 2025 
• 📒: The Journal of Allergy and Clinical Immunology
• 👤: Meledathu S, Naidu MP, Brunner PM
• 주요 대상 질환: Atopic dermatitis
• 연구 방법: 분자 endotype, 임상적 phenotype, 피부 <b>microbiome</b>, 진단 도구 및 치료법 발전에 관한 최신 연구 문헌을 종합적으로 검토한 리뷰 논문
• 🎯: <b>아토피 피부염</b>의 <b>병태생리학적 기전</b>에 대한 이해가 크게 향상되었으며, 이를 바탕으로 새로운 표적 치료법이 개발되어 치료 옵션이 혁신적으로 발전함
• 임상적용 가능성: 새로운 분자적 이해를 바탕으로 개발된 표적 치료법은 기존의 치료에 반응하지 않는 중증 아토피 피부염 환자들에게 새로운 치료 대안을 제공할 수 있음
• 제한점: 초록에서는 구체적인 제한점을 언급하지 않았으나, 새로운 치료법의 장기적 안전성과 효과에 대한 추가 연구가 필요할 수 있음
• Tag: #AtopicDermatitis #SkinMicrobiome #TargetedTreatment

No hallucination
`;
      
      // GPT API 호출
      const summary = callGPT(prompt);
      
      // 요약 결과 저장
      sheet.getRange(rowIndex, targetCol).setValue(summary);
      successCount++;
      
      // 너무 빠른 API 호출 방지
      Utilities.sleep(1500);
      
    } catch (error) {
      console.error(`PMID ${pmid} 처리 오류:`, error);
      sheet.getRange(rowIndex, targetCol).setValue(`오류: ${error.message}`);
      failCount++;
      
      // API 오류 시 더 오래 대기
      Utilities.sleep(5000);
    }

    // 처리 속도 측정 및 남은 시간 예상
    const itemsDone = i + 1;
    const currentTime = new Date().getTime();
    const elapsedSec = (currentTime - startTime) / 1000;
    const avgTimePerItem = elapsedSec / itemsDone;
    const remainingItems = dataRows.length - itemsDone;
    const estimatedRemaining = (avgTimePerItem * remainingItems).toFixed(1);
    console.log(`[${itemsDone}/${dataRows.length}] PMID: ${pmid}, 평균속도(건/초): ${(1/avgTimePerItem).toFixed(2)}, 예상 남은 시간: ${Math.floor(estimatedRemaining/60)}분 ${Math.floor(estimatedRemaining%60)}초`);
  }

  // 마지막 저장
  try {
    SpreadsheetApp.flush();
  } catch (flushErr) {
    console.error("마지막 flush 오류:", flushErr);
  }

  const resultMsg = `요약 작업 완료! 성공: ${successCount}, 실패: ${failCount}`;
  console.log(resultMsg);
  return resultMsg;
}


