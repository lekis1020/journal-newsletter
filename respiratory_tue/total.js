// ===== 스프레드시트 ID 저장/조회 헬퍼 =====

function saveLastSpreadsheetId(spreadsheet) {
  PropertiesService.getScriptProperties().setProperty('LAST_SPREADSHEET_ID', spreadsheet.getId());
  console.log("스프레드시트 ID 저장: " + spreadsheet.getId());
}

function getLastSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('LAST_SPREADSHEET_ID');
  if (!id) {
    console.error("저장된 스프레드시트 ID가 없습니다. Phase 1을 먼저 실행하세요.");
    return null;
  }
  return SpreadsheetApp.openById(id);
}

// ===== Phase 1: 검색 + 스코어링 =====

function phase1_fetchAndScore() {
  try {
    console.log("Phase 1 시작: 검색 + 스코어링");
    const spreadsheet = fetchPubMedWeeklyAndSave();
    console.log("논문 검색 및 저장 완료: " + (spreadsheet ? "성공" : "실패"));

    if (spreadsheet) {
      saveLastSpreadsheetId(spreadsheet);

      console.log("GPT 스코어링 시작...");
      scoreAndFilterPapers(spreadsheet);
      console.log("GPT 스코어링 완료");

      console.log("Phase 1 완료. Phase 2를 실행하세요.");
      return "Phase 1 완료";
    } else {
      const message = "금주 검색 대상 논문이 없습니다.";
      console.warn(message);
      sendNoResultsEmail(message);
      return message;
    }
  } catch (error) {
    console.error("Phase 1 오류:", error);
    return "오류: " + error.message;
  }
}

// ===== Phase 2: 요약 + 이메일 =====

function phase2_summarizeAndEmail() {
  try {
    console.log("Phase 2 시작: 요약 + 이메일");
    const spreadsheet = getLastSpreadsheet();
    if (!spreadsheet) return "스프레드시트 없음";

    console.log("스프레드시트: " + spreadsheet.getName());

    console.log("GPT 요약 시작 (Included=O 만)...");
    summarizePubMedArticlesWithGPT(spreadsheet);
    console.log("GPT 요약 완료");

    console.log("이메일 전송 시작...");
    const mailResult = sendSummariesToEmail(spreadsheet);
    if (mailResult && mailResult.ok) {
      console.log("이메일 전송 완료: " + mailResult.subject);
    } else {
      console.log("이메일 전송 결과: " + mailResult);
    }
    return mailResult;
  } catch (error) {
    console.error("Phase 2 오류:", error);
    return "오류: " + error.message;
  }
}

// ===== 전체 실행 (시간 여유 있을 때) =====

function fetchSummarizeAndSendByEmail() {
  try {
    console.log("전체 워크플로우 시작...");
    const result1 = phase1_fetchAndScore();
    if (result1 !== "Phase 1 완료") return result1;

    return phase2_summarizeAndEmail();
  } catch (error) {
    console.error("워크플로우 실행 오류:", error);
    return "오류: " + error.message;
  }
}

// ===== 결과 없음 이메일 =====

function sendNoResultsEmail(message) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - CONFIG.DAYS_RANGE);

  const searchPeriod = `${formatKoreanDate(startDate)}부터 ${formatKoreanDate(today)}까지`;
  Logger.log(searchPeriod);

  const emailSubject = `[Ajou Allergy Journal Letter] Respiratory disease ${searchPeriod}`;

  let emailBody = `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif;">`;
  emailBody += `<h4 style="font-size: 22px; font-weight: 700; color: #0C4A6E;">최근 ${CONFIG.DAYS_RANGE}일 간 (${searchPeriod}) Asthma/Rhinitis/Sinusitis 논문 요약</h4>`;
  emailBody += `<p style="color: #0C4A6E;">지난 주 새로 출간된 논문은 검색되지 않았습니다.<br>`;
  emailBody += `평안한 한 주 보내시기 바랍니다.</p>`;
  emailBody += `<hr style="margin: 20px 0; border-color: #BFDBFE;">`;
  emailBody += `<p style="color: #0369A1; font-size: 12px;">이 이메일은 GPT에 의해 자동으로 생성되었습니다.</p>`;
  emailBody += `</div>`;

  const plainText = emailBody
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  MailApp.sendEmail({
    to: getSecret('EMAIL_TO_PRIMARY'),
    subject: emailSubject,
    bcc: getSecret('EMAIL_RECIPIENTS'),
    name: "논문 요약 자동화",
    htmlBody: emailBody,
    body: plainText,
  });
  console.log("결과 없음 이메일 전송 완료");
}

// ===== 이메일만 재발송 =====

function sendEmailFromActiveSpreadsheet() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet) {
      console.log("활성화된 스프레드시트: " + spreadsheet.getName());
      return sendSummariesToEmail(spreadsheet);
    } else {
      const errorMsg = "활성화된 스프레드시트가 없습니다.";
      console.error(errorMsg);
      return errorMsg;
    }
  } catch (error) {
    console.error("이메일 전송 실행 오류:", error);
    return "오류: " + error.message;
  }
}
