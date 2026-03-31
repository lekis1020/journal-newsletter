/**
 * GPT JSON 호출 및 스코어링/필터링
 */

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
