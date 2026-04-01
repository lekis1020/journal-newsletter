
/**
 * 한국어 날짜 포맷 (email, total 공용)
 */
function formatKoreanDate(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/**
 * 요약 텍스트를 줄 단위로 분리
 * @param {string} summary - GPT 요약 텍스트
 * @return {string[]} 줄 배열
 */
function buildPaperSummaryLines(summary) {
  return String(summary || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * 요약 줄을 이메일용 HTML div로 변환
 * @param {string} summary - GPT 요약 텍스트
 * @return {string} HTML 문자열
 */
function formatSummaryForEmail(summary) {
  const lines = buildPaperSummaryLines(summary);

  return lines.map(line => {
    const isTagLine = /Tag\s*:|#️⃣/.test(line);
    const baseStyle = [
      "display:block",
      "margin:0 0 8px 0",
      "font-size:17px",
      "line-height:1.7",
      "color:#0F172A"
    ];

    if (isTagLine) {
      baseStyle.push("color:#334155", "font-weight:600");
    }

    return `<div style="${baseStyle.join(";")}">${line}</div>`;
  }).join("");
}

/**
 * 논문 요약 결과를 이메일로 전송하는 함수
 * @param {SpreadsheetApp.Spreadsheet} spreadsheet - 논문 데이터가 있는 스프레드시트
 * @return {{ok: boolean, subject: string, emailBody: string}|string} 처리 결과
 */
function sendSummariesToEmail(spreadsheet) {
  try {
    if (!spreadsheet) {
      console.error("스프레드시트 객체가 전달되지 않았습니다.");
      try {
        spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        console.log("현재 활성화된 스프레드시트를 사용합니다: " + spreadsheet.getName());
      } catch (e) {
        console.error("활성화된 스프레드시트를 가져오는 데 실패했습니다:", e);
        return "스프레드시트를 찾을 수 없습니다.";
      }
    }

    const sheet = spreadsheet.getSheetByName('journal_cu_ana_db');
    if (!sheet) {
      console.error("'journal_cu_ana_db' 시트를 찾을 수 없습니다.");
      return "시트 없음";
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow <= 1) {
      console.error("전송할 데이터가 없습니다.");
      return "데이터 없음";
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const titleColIndex = headers.indexOf("Title");
    const journalColIndex = headers.indexOf("Journal");
    const dateColIndex = headers.indexOf("Date");
    const pmidColIndex = headers.indexOf("PMID");
    const pubTypeColIndex = headers.indexOf("Publication Type");
    const summaryColIndex = headers.indexOf(MESSAGES.SUMMARY_HEADER);
    const includedColIndex = headers.indexOf("Included");

    if (titleColIndex === -1 || pmidColIndex === -1 || summaryColIndex === -1) {
      console.error("필요한 열을 찾을 수 없습니다.");
      return "필요한 열 없음";
    }

    // Included="O" + 유효한 요약이 있는 논문만 사전 필터링
    const filteredData = data.filter((row, index) => {
      if (includedColIndex === -1) return true;
      const included = row[includedColIndex];
      const s = row[summaryColIndex] || "";
      const hasSummary = s && !s.startsWith("초록이 없습니다") && !s.startsWith("오류:") && s !== "요약 정보 없음";

      if (included === "O" && hasSummary) {
        console.log(`Row ${index + 2}: Included="O" with summary, adding to email`);
        return true;
      } else {
        console.log(`Row ${index + 2}: Included="${included}", hasSummary=${hasSummary}, skipping`);
        return false;
      }
    });

    console.log(`Total papers: ${data.length}, Filtered papers for email: ${filteredData.length}`);

    if (filteredData.length === 0) {
      console.log("Included='O'인 논문이 없어서 이메일을 전송하지 않습니다.");
      return "필터링된 논문 없음";
    }

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - CONFIG.DAYS_RANGE);
    const searchPeriod = `${formatKoreanDate(startDate)}부터 ${formatKoreanDate(today)}까지`;
    Logger.log(searchPeriod);

    const subject = `[CU-Ana Newsletter] ${searchPeriod}, 총 ${filteredData.length}개 논문`;

    let emailBody = `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif;">`;
    emailBody += `
    <h4 style="
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 16px;
      color: #0F172A;
    ">
      최근 ${CONFIG.DAYS_RANGE}일 간 (${searchPeriod}) 두드러기/혈관부종/아나필락시스/비만세포증/식품알레르기 논문 요약</h4>`;
    emailBody += `
    <p style="
      font-size: 16px;
      font-weight: 600;
      margin: 8px 0 18px 0;
      color: #0F172A;
    ">
      총 ${data.length}개 검색 중 상위 ${filteredData.length}개의 논문 요약을 공유합니다.</p>`;
    emailBody += `<hr style="margin: 20px 0; border-color: #CBD5E1;">`;

    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];

      const title = row[titleColIndex] || "제목 정보 없음";
      const journal = journalColIndex !== -1 ? row[journalColIndex] : "저널 정보 없음";
      const date = dateColIndex !== -1 ? row[dateColIndex] : "";
      const pmid = row[pmidColIndex] || "PMID 정보 없음";
      const pubType = pubTypeColIndex !== -1 ? row[pubTypeColIndex] : "출판 유형 정보 없음";
      const summary = row[summaryColIndex] || "요약 정보 없음";

      const pubmedLink = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

      // 논문 카드
      const paperNum = i + 1;
      emailBody += `<div style="margin-bottom: 30px; border: 1px solid #CBD5E1; padding: 15px; border-radius: 5px; background-color: #FFFFFF;">`;
      // 제목 헤더 (넘버링 포함)
      emailBody += `<div style="border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 10px;">`;
      emailBody += `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 18px; font-weight: bold; color: #1E293B; margin-bottom: 10px;">[${paperNum}/${filteredData.length}] 📔: ${title}</div>`;
      emailBody += `</div>`;

      // 요약 내용
      emailBody += `<div style="font-size: 16px; line-height: 1.7; color: #0F172A; background-color: #F8FAFC; padding: 12px 14px; border-left: 4px solid #334155;">`;
      emailBody += formatSummaryForEmail(summary);
      emailBody += `</div>`;

      // 링크
      emailBody += `<div style="margin-top: 10px; font-size: 14px; color: #0F172A;">`;
      emailBody += `<strong>링크:</strong> <a href="${pubmedLink}" target="_blank" style="color: #334155;">${pubmedLink}</a>`;
      emailBody += `</div>`;
      emailBody += `</div>`;
    }

    emailBody += `<hr style="margin: 20px 0; border-color: #CBD5E1;">`;
    emailBody += '<p style="font-size: 16px; color: #0F172A;"> <br> 최근 7일(전자출판기준) 발표된 두드러기/혈관부종/아나필락시스/비만세포증/식품알레르기 관련 논문들 중 선별한 논문들에 대한 요약입니다. </p>';
    emailBody += `<p style="color: #334155; font-size: 12px;">이 이메일은 GPT에 의해 자동으로 생성되었습니다.</p>`;
    emailBody += `</div>`;

    const plainText = emailBody
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const recipients = CONFIG.EMAIL_RECIPIENTS;
    const primaryRecipient = CONFIG.EMAIL_TO_PRIMARY;

    MailApp.sendEmail({
      to: primaryRecipient,
      subject: subject,
      htmlBody: emailBody,
      body: plainText,
      bcc: recipients,
      name: "논문 요약 자동화"
    });

    console.log("DEBUG mail subject:", subject);
    console.log(`${recipients}에게 이메일 전송 완료`);
    return { ok: true, subject, emailBody };

  } catch (error) {
    console.error("이메일 전송 오류:", error);
    return `이메일 전송 오류: ${error.message}`;
  }
}
