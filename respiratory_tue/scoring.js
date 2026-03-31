/**
 * 키워드 기반 Regex 스코어링 및 필터링
 */

// ===== 키워드 기반 Regex 스코어링 (간소화 버전) =====

function scorePaperRegex(title, abstract) {
  const respKeywords = ["asthma", "rhinitis", "sinusitis", "nasal polyp", "rhinosinusitis", "eosinophilic", "bronchial hyperresponsiveness", "AERD", "aspirin-exacerbated", "cough hypersensitivity"];
  const airwayKeywords = ["airway remodeling", "mucus", "epithelial barrier", "type 2 inflammation", "ILC2", "alarmin", "TSLP", "IL-4", "IL-5", "IL-13", "biologics"];
  
  const content = (title + " " + abstract).toLowerCase();
  
  let respCount = 0;
  respKeywords.forEach(k => { if (content.includes(k.toLowerCase())) respCount++; });
  
  let airwayCount = 0;
  airwayKeywords.forEach(k => { if (content.includes(k.toLowerCase())) airwayCount++; });
  
  // 제목에 키워드가 있으면 가산점
  const titleLower = title.toLowerCase();
  let titleBonus = 0;
  respKeywords.concat(airwayKeywords).forEach(k => { if (titleLower.includes(k.toLowerCase())) titleBonus += 2; });

  const finalScore = respCount + airwayCount + titleBonus;
  
  return {
    score: finalScore,
    details: "Keywords: Resp(" + respCount + ") Airway(" + airwayCount + ") TitleBonus(" + titleBonus + ")",
    included: finalScore >= 2 // 최소 2점 이상이면 포함
  };
}

// ===== 스코어링 & Top N 필터링 =====

function scoreAndFilterPapers(spreadsheet) {
  const sheet = spreadsheet.getSheetByName("journal_crawl_db");
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const titleIdx = headers.indexOf("Title");
  const abstractIdx = headers.indexOf("Abstract");
  if (titleIdx === -1 || abstractIdx === -1) { console.error("필수 컬럼 누락"); return; }

  const scoreCols = ["Scores", "Final Score", "Included", "Exclusion Reason"];
  const scoreColMap = ensureSheetColumns(sheet, headers, scoreCols);

  const rows = data.slice(1);
  const results = rows.map(function(row, i) {
    const title = row[titleIdx];
    const abstract = String(row[abstractIdx] || "").trim();

    if (!abstract) return { details: "No Abstract", score: 0, included: false, reason: "No Abstract" };

    // Regex 기반으로 즉시 계산 (API 호출 없음)
    const res = scorePaperRegex(title, abstract);
    return {
      details: res.details,
      score: res.score,
      included: res.included,
      reason: "Regex Scoring"
    };
  });

  // Top N 선정 (CONFIG.MAX_INCLUSION 기준)
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
  console.log("Regex 스코어링 완료: " + rows.length + "건 중 " + includedCount + "건 선정 (최대 " + CONFIG.MAX_INCLUSION + "건)");
}
