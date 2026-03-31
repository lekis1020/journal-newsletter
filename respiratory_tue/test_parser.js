
const testParsing = (jsonStr) => {
  console.log("--- Testing with raw input: ---");
  console.log(jsonStr);
  
  try {
    // Logic from scoring.js
    let cleanStr = jsonStr.trim();
    
    if (cleanStr.startsWith('```')) {
      cleanStr = cleanStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    const startIdx = cleanStr.indexOf('{');
    const endIdx = cleanStr.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      cleanStr = cleanStr.substring(startIdx, endIdx + 1);
    }

    const f = JSON.parse(cleanStr);
    console.log("Result: SUCCESS");
    console.log(JSON.stringify(f, null, 2));
  } catch (e) {
    console.log("Result: FAILED - " + e.message);
  }
  console.log("----------------------------\n");
};

// Scenario 1: Markdown wrapped JSON (Common with Gemini)
testParsing('```json\n{\n  "hasRespAllergyInTitle": true,\n  "hasRespAllergyInAbstract": false,\n  "hasAirwayInflamInTitle": true,\n  "hasAirwayInflamInAbstract": true\n}\n```');

// Scenario 2: Prefixed with text (What might cause Unterminated string if truncated or malformed)
testParsing('Here is the analysis:\n{\n  "hasRespAllergyInTitle": true,\n  "hasRespAllergyInAbstract": true,\n  "hasAirwayInflamInTitle": false,\n  "hasAirwayInflamInAbstract": false\n}');

// Scenario 3: Potential "Unterminated string" culprit (extra quotes or bad escaping)
testParsing('{\n  "hasRespAllergyInTitle": "true",\n  "hasRespAllergyInAbstract": "false",\n  "hasAirwayInflamInTitle": "true",\n  "hasAirwayInflamInAbstract": "true"\n}');

// Scenario 4: Tricky case where Gemini might add notes after JSON
testParsing('{\n  "hasRespAllergyInTitle": true,\n  "hasRespAllergyInAbstract": true,\n  "hasAirwayInflamInTitle": false,\n  "hasAirwayInflamInAbstract": false\n}\nNote: I found these keywords.');
