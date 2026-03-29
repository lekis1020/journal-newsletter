/**
* 전체 워크플로우 실행 함수 (이메일 전송 포함)
 */
function fetchSummarizeAndSendByEmail() {
  try {
    console.log("워크플로우 시작...");
    const spreadsheet = fetchPubMedWeeklyAndSave();
    console.log("논문 검색 및 저장 완료: " + (spreadsheet ? "성공" : "실패"));
    
    if (spreadsheet) {
      console.log("GPT 요약 시작...");
      summarizePubMedArticlesWithGPT(spreadsheet);
      console.log("GPT 요약 완료");
      
      console.log("이메일 전송 시작...");
      const result = sendSummariesToEmail(spreadsheet);
      console.log("이메일 전송 결과: " + result);
      return result;
    } else {
      const message = "금주 검색 대상 논문이 없습니다.";
      console.warn(message);
      sendNoResultsEmail(message);
      return message;
      //const errorMsg = "스프레드시트가 생성되지 않아 이후 과정을 건너뜁니다.";
      //console.error(errorMsg);
      //return errorMsg;
    }
  } catch (error) {
    console.error("워크플로우 실행 오류:", error);
    return "오류: " + error.message;
  }
}
/**
* 검색된 논문이 없을때 안내 메일을 전송하는 함수
*/

function sendNoResultsEmail(message) {
      // 이메일 제목

  const today = new Date();
  const formattedDate = Utilities.formatDate(today, "GMT+9", "yyyy-MM-dd");

  const startDate = new Date(today);
  startDate.setDate(today.getDate() - CONFIG.DAYS_RANGE);

  function formatKoreanDate(date) {
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;  
  }
  
  const searchPeriod = `${formatKoreanDate(startDate)}부터 ${formatKoreanDate(today)}까지`;
  Logger.log(searchPeriod); 

  const emailSubject = `[Ajou Allergy Journal Letter] Respiratory disease (Asthma/Rhinitis/Sinusitis) ${searchPeriod} `;

  // 이메일 본문 시작
  let emailBody = `<div style="font-family: Arial, sans-serif;">`;
  emailBody += `<h4>최근 ${CONFIG.DAYS_RANGE}일 간 (${searchPeriod}) Asthma/Rhinitis/Sinusitis 논문 요약  </h4>`;
  emailBody += `<p>지난 주 새로 출간된 논문은 검색되지 않았습니다.<br>`;
  emailBody += `평안한 한 주 보내시기 바랍니다.</p>`;
  emailBody += `<hr style="margin: 20px 0;">`;
// 이메일 본문 마무리
  emailBody += `<p style="color: #777; font-size: 12px;">이 이메일은 GPT에 의해 자동으로 생성되었습니다.</p>`;
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
  //console.log(emailBody);
  console.log("결과 없음 이메일 전송 완료");
}


 
/**
 * 활성화된 스프레드시트의 요약 결과만 이메일로 전송하는 함수
 * (독립적으로 이메일 전송만 실행하고 싶은 경우 사용)
 */
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

