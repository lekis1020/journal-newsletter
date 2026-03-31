/**
 * 화요일 - 호흡기 논문 위주 (천식, 비염 등)
 * PubMed 검색, 데이터 저장, Gemini 요약
 *
 * 설정/상수: config.js
 * 스코어링: scoring.js
 * 이메일: email.js
 * 워크플로우: total.js
 */

// ===== 메인 실행 함수 =====

function fetchAndSummarizeAll() {
  const spreadsheet = fetchPubMedWeeklyAndSave();
  if (spreadsheet) {
    SpreadsheetApp.setActiveSpreadsheet(spreadsheet);
    scoreAndFilterPapers(spreadsheet);
    summarizePubMedArticlesWithGemini(spreadsheet);
  }
}

// ===== PubMed 검색 및 데이터 가져오기 =====

function fetchPubMedWeeklyAndSave() {
  const journalQuery = CONFIG.JOURNALS.map(journal => `"${journal}"[Journal]`).join(" OR ");
  const meshTerms = ["asthma","rhinitis","rhinitis, allergic","sinusitis","nasal polyps","bronchial hyperreactivity","aspirin-exacerbated respiratory disease","cough","respiratory hypersensitivity"];
  const meshQuery = meshTerms.map(term => `"${term}"[MeSH Terms]`).join(" OR ");
  const diseaseTerms = ["asthma","rhinitis","allergic rhinitis","sinusitis","nasal polyp","chronic rhinosinusitis","bronchial hyperresponsiveness","AERD"];
  const diseaseQuery = diseaseTerms.map(term => `"${term}"[Title]`).join(" OR ");

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

  const keywordQuery = `(${meshQuery}) OR (${diseaseQuery})`;
  const finalQuery = `(${journalQuery}) AND (${keywordQuery}) AND (${dateRange})`;

  // PubMed ESearch API (POST 방식 — URL 길이 제한 회피)
  const esearchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';

  const params = {
    'db': 'pubmed',
    'term': finalQuery,
    'retmode': 'json',
    'retmax': CONFIG.MAX_RESULTS,
    'usehistory': 'y',
    'api_key': getSecret('PUBMED_API_KEY')
  };

  const payloadString = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const options = {
    'method': 'post',
    'contentType': 'application/x-www-form-urlencoded',
    'payload': payloadString,
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(esearchUrl, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const esearchResults = JSON.parse(responseBody);

      if (esearchResults.esearchresult && esearchResults.esearchresult.ERROR) {
        console.error('PubMed ESearch API Error:', esearchResults.esearchresult.ERROR);
        return null;
      }
      if (!esearchResults.esearchresult) {
        console.error('PubMed ESearch 응답 형식이 예상과 다릅니다.');
        return null;
      }

      const idList = esearchResults.esearchresult.idlist || [];

      if (idList.length === 0) {
        console.log(`최근 ${CONFIG.DAYS_RANGE}일간 검색된 논문이 없습니다.`);
        return null;
      }

      console.log(`총 ${idList.length}개의 논문 ID를 가져왔습니다.`);
      const results = fetchPubMedData(idList);

      if (!results || results.length === 0) {
        console.error('논문 상세 정보 가져오기에 실패했거나 결과가 없습니다.');
        return null;
      }

      return saveResultsToSheet(results);
    } else {
      console.error(`PubMed ESearch API 호출 실패. 응답 코드: ${responseCode}`);
      return null;
    }
  } catch (error) {
    console.error('PubMed 검색 실패:', error);
    return null;
  }
}

// ===== PubMed 상세 정보 가져오기 =====

function fetchPubMedData(pmidInput, options = {}) {
  const defaults = {
    includeAbstract: true,
    includeAuthors: true,
    detailedFormat: false,
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

    const ids = pmids.join(",");
    const detailUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids}&retmode=xml`;

    let attempt = 0;
    let xmlResponse;

    while (attempt < settings.maxRetries) {
      try {
        xmlResponse = UrlFetchApp.fetch(detailUrl).getContentText();
        break;
      } catch (fetchError) {
        attempt++;
        if (attempt >= settings.maxRetries) throw fetchError;
        const delay = CONFIG.RETRY_DELAY * Math.pow(CONFIG.RETRY_MULTIPLIER, attempt - 1);
        Utilities.sleep(delay);
        console.log(`PubMed API 재시도 ${attempt}/${settings.maxRetries}, 대기: ${delay}ms`);
      }
    }

    const document = XmlService.parse(xmlResponse);
    const root = document.getRootElement();
    const articles = root.getChildren('PubmedArticle');

    console.log(`XML 파싱 완료, ${articles.length}개 논문 처리 중...`);

    const results = [];

    articles.forEach(article => {
      try {
        const citation = article.getChild('MedlineCitation');
        if (!citation) return;
        const articleNode = citation.getChild('Article');
        if (!articleNode) return;

        const titleNode = articleNode.getChild('ArticleTitle');
        const articleTitle = titleNode ? titleNode.getText() : 'No Title';

        const journalNode = articleNode.getChild('Journal');
        const journalTitleNode = journalNode ? journalNode.getChild('Title') : null;
        const journal = journalTitleNode ? journalTitleNode.getText() : 'No Journal';

        const journalIssueNode = journalNode ? journalNode.getChild('JournalIssue') : null;
        const pubDateNode = journalIssueNode ? journalIssueNode.getChild('PubDate') : null;
        const pubYear = pubDateNode && pubDateNode.getChild('Year') ? pubDateNode.getChild('Year').getText() : 'NA';
        const pubMonth = pubDateNode && pubDateNode.getChild('Month') ? pubDateNode.getChild('Month').getText() : 'NA';
        const pubDay = pubDateNode && pubDateNode.getChild('Day') ? pubDateNode.getChild('Day').getText() : 'NA';

        let pubDate = pubYear;
        if (pubMonth !== 'NA') pubDate += ` ${pubMonth}`;
        if (pubDay !== 'NA') pubDate += ` ${pubDay}`;

        const pmid = citation.getChild('PMID') ? citation.getChild('PMID').getText() : 'No PMID';

        const pubTypeListNode = articleNode.getChild('PublicationTypeList');
        let pubTypeList = '';
        if (pubTypeListNode) {
          pubTypeList = pubTypeListNode.getChildren('PublicationType').map(pt => pt.getText()).join(", ");
        }

        let abstract = '';
        if (settings.includeAbstract) {
          const abstractNode = articleNode.getChild('Abstract');
          if (abstractNode) {
            abstract = abstractNode.getChildren('AbstractText').map(node => {
              const label = node.getAttribute('Label');
              const text = node.getText();
              return label ? `${label}: ${text}` : text;
            }).join("\n");
          }
        }

        let authors = '';
        if (settings.includeAuthors) {
          const authorListNode = articleNode.getChild('AuthorList');
          if (authorListNode) {
            authors = authorListNode.getChildren('Author').map(author => {
              const lastName = author.getChild('LastName') ? author.getChild('LastName').getText() : '';
              const initials = author.getChild('Initials') ? author.getChild('Initials').getText() : '';
              return lastName + (initials ? ` ${initials}` : '');
            }).join(", ");
          }
        }

        if (settings.detailedFormat) {
          results.push({ title: articleTitle, journal, pubDate, authors, pmid, publicationType: pubTypeList, abstract });
        } else {
          results.push([articleTitle, journal, pubDate, authors, pmid, pubTypeList, abstract]);
        }
      } catch (articleError) {
        console.error('개별 논문 파싱 중 오류:', articleError);
      }
    });

    console.log(`${results.length}개 논문의 데이터 처리 완료`);
    return isSinglePmid ? (results[0] || (settings.detailedFormat ? {} : [])) : results;

  } catch (error) {
    console.error('PubMed 데이터 가져오기 실패:', error);
    throw error;
  }
}

// ===== 데이터 저장 =====

function saveResultsToSheet(data) {
  try {
    const today = new Date();
    const formattedDate = Utilities.formatDate(today, "GMT+9", "yyyyMMdd");
    const fileName = `respiratory_tue_${formattedDate}`;

    const spreadsheet = SpreadsheetApp.create(fileName);
    const sheet = spreadsheet.getActiveSheet();
    sheet.setName("journal_crawl_db");

    sheet.getRange(1, 1, 1, 7).setValues([["Title", "Journal", "Date", "Authors", "PMID", "Publication Type", "Abstract"]]);

    if (data.length > 0) {
      sheet.getRange(2, 1, data.length, 7).setValues(data);
      sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, 7);
    }

    console.log(`스프레드시트 "${fileName}" 생성 완료, 총 ${data.length}개 데이터 저장됨`);
    console.log(`스프레드시트 URL: ${spreadsheet.getUrl()}`);
    return spreadsheet;

  } catch (error) {
    console.error('스프레드시트 저장 실패:', error);
    throw error;
  }
}

// ===== Gemini 호출 =====

function callGemini(prompt) {
  // Gemini OpenAI-compatible endpoint
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions";
  const payload = {
    model: CONFIG.GEMINI_MODEL,
    messages: [{ role: "user", content: prompt }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${getSecret('GEMINI_API_KEY')}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        Utilities.sleep(CONFIG.RETRY_DELAY * Math.pow(CONFIG.RETRY_MULTIPLIER, attempt - 2));
      }
      
      const res = UrlFetchApp.fetch(url, options);
      const responseCode = res.getResponseCode();

      if (responseCode === 429) {
        console.warn(`Gemini API 할당량 초과 (429). 재시도 중... (${attempt}/${CONFIG.MAX_RETRIES})`);
        continue;
      }

      if (responseCode !== 200) {
        throw new Error(JSON.parse(res.getContentText()).error?.message || `Status ${responseCode}`);
      }

      const json = JSON.parse(res.getContentText());
      if (json.error) throw new Error(json.error.message);

      return json.choices[0].message.content.trim();
    } catch (e) {
      console.error(`Gemini 호출 오류 (${attempt}/${CONFIG.MAX_RETRIES}):`, e.message);
      if (attempt >= CONFIG.MAX_RETRIES) throw e;
    }
  }
}

// ===== Gemini 요약 =====

function summarizePubMedArticlesWithGemini(spreadsheet) {
  console.log("논문 Gemini 요약 작업 시작...");

  let sheet;
  try {
    sheet = spreadsheet.getSheetByName('journal_crawl_db');
    if (!sheet) { console.error("'journal_crawl_db' 시트를 찾을 수 없습니다."); return "시트 없음"; }
  } catch (error) {
    console.error("시트 접근 오류:", error);
    return "시트 접근 오류" + error.message;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) { console.error("데이터가 없습니다."); return "데이터 없음"; }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const titleIdx = headers.indexOf("Title");
  const journalIdx = headers.indexOf("Journal");
  const dateIdx = headers.indexOf("Date");
  const authorsIdx = headers.indexOf("Authors");
  const pmidIndex = headers.indexOf("PMID");
  const pubtypeIdx = headers.indexOf("Publication Type");
  const abstractIdx = headers.indexOf("Abstract");
  const includedIdx = headers.indexOf("Included");

  if (titleIdx === -1 || abstractIdx === -1 || pmidIndex === -1) {
    return "필수 열(제목, PMID, 초록)을 찾을 수 없습니다.";
  }

  const summaryColMap = ensureSheetColumns(sheet, headers, [MESSAGES.SUMMARY_HEADER]);
  const targetCol = summaryColMap[MESSAGES.SUMMARY_HEADER] + 1;

  const summaryIdx = summaryColMap[MESSAGES.SUMMARY_HEADER];
  const dataRows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const batchLimit = CONFIG.SUMMARY_BATCH_SIZE || 10;
  const startTime = new Date().getTime();

  for (let i = 0; i < dataRows.length; i++) {
    if (!shouldSummarizeRow(dataRows[i][includedIdx], includedIdx !== -1)) {
      continue;
    }

    // 이미 요약이 있으면 스킵 (배치 재실행 시 이어서 처리)
    const existingSummary = String(dataRows[i][summaryIdx] || "").trim();
    if (existingSummary && !existingSummary.startsWith("오류:")) {
      skipCount++;
      continue;
    }

    // 배치 크기 도달 시 중단
    if (successCount + failCount >= batchLimit) {
      console.log(`배치 제한 도달 (${batchLimit}건). 나머지는 다음 실행에서 처리합니다.`);
      break;
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
      sheet.getRange(rowIndex, targetCol).setValue(MESSAGES.NO_PMID);
      failCount++;
      continue;
    }

    if (!abstract) {
      const formattedDate = formatPaperDateValue(date, Utilities);
      const message = `초록이 없습니다.\n 📅: ${formattedDate} \n 📒: ${journal}\n ${pubtype}\n 👥: ${authors}`;
      sheet.getRange(rowIndex, targetCol).setValue(message);
      failCount++;
      continue;
    }

    try {
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

Output format:
• 🗓️: [date]
• 📒: [journal]
• 👤: [first 3 and corr. author et al.]
• 🎯: [disease]
• 🔬: [study type + brief method, 2-3 lines]
• 📊: [key results, 2-3 lines]
• ✅: [clinical implications]
• ⚠️: [limitations]
• #️⃣: #disease #mechanism #keyword #drug/study_type

요약 시 주의사항:
  1. **제공된 정보만 사용**하고, **없는 정보는 빈칸으로 남겨주세요 (No hallucination)**
	2.	의학 전문가용 뉴스레터이므로 불필요하게 쉬운 말로 풀지 말고, 핵심 용어는 그대로 사용하세요.
	3.	한국어로 요약하되, 원문의 의미와 문맥이 왜곡되지 않도록 합니다.
	4.	Tag 항목은 3~5개의 핵심 해시태그를 생성해주세요.
	5.	정보가 없는 항목은 생략하지 말고 "-"로 표시해주세요.
  6. **연구 방법**은 연구 종류를 먼저 명시하고, 초록을 참고해 간략히 요약해 주세요.
  7. **의학 용어는 영어 그대로**, 저자는 1,2,3 저자 및 교신저자만, 이후는 et al 로 표시.
  8. 본문에서 의미상 중요한 단어는 이메일로 출력 시 진한 글씨체로 표시될 수 있도록 "<b>" "</b>" 로 감싸서 표시해줘.
  9. 의미상 중요한 단어로는 cytokine 이름, 연구에서 분석한 약제 이름, clinical trial 의 이름 등이 해당하고, 이러한 단어는 8번의 표시를 붙여줘.
  10. 핵심 결과 요약 영역에서 가장 중요한 내용은 "<u>"  "</u>" 로 감싸서 표시해줘.

No hallucination
`;

      const summary = callGemini(prompt);
      sheet.getRange(rowIndex, targetCol).setValue(summary);
      successCount++;
      // 429 회피를 위한 대기 시간 대폭 증가 (6초)
      Utilities.sleep(6000);

    } catch (error) {
      console.error(`PMID ${pmid} 처리 오류:`, error);
      sheet.getRange(rowIndex, targetCol).setValue(`오류: ${error.message}`);
      failCount++;
      Utilities.sleep(5000);
    }

    const itemsDone = i + 1;
    const currentTime = new Date().getTime();
    const elapsedSec = (currentTime - startTime) / 1000;
    const avgTimePerItem = elapsedSec / itemsDone;
    const remainingItems = dataRows.length - itemsDone;
    const estimatedRemaining = (avgTimePerItem * remainingItems).toFixed(1);
    console.log(`[${itemsDone}/${dataRows.length}] PMID: ${pmid}, 평균속도(건/초): ${(1/avgTimePerItem).toFixed(2)}, 예상 남은 시간: ${Math.floor(estimatedRemaining/60)}분 ${Math.floor(estimatedRemaining%60)}초`);
  }

  try { SpreadsheetApp.flush(); } catch (flushErr) { console.error("마지막 flush 오류:", flushErr); }

  // 잔여 건수 계산: Included=O이면서 아직 요약이 없는 행
  const freshData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  let remaining = 0;
  for (let j = 0; j < freshData.length; j++) {
    if (!shouldSummarizeRow(freshData[j][includedIdx], includedIdx !== -1)) continue;
    const s = String(freshData[j][summaryIdx] || "").trim();
    if (!s || s.startsWith("오류:")) remaining++;
  }

  const resultMsg = `요약 작업 완료! 성공: ${successCount}, 실패: ${failCount}, 기존 스킵: ${skipCount}, 잔여: ${remaining}`;
  console.log(resultMsg);
  return { successCount, failCount, skipCount, remaining };
}
