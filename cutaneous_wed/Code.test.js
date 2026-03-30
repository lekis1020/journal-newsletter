const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildColumnLayout,
  shouldSummarizeRow,
  formatPaperDateValue,
} = require('./Code.js');

test('buildColumnLayout appends only missing headers and reuses existing ones', () => {
  const layout = buildColumnLayout(
    ['Title', 'Abstract', 'Included', 'GPT 요약'],
    ['Scores', 'Final Score', 'Included', 'Exclusion Reason', 'GPT 요약']
  );

  assert.deepEqual(layout.headersToAppend, ['Scores', 'Final Score', 'Exclusion Reason']);
  assert.equal(layout.finalHeaders.length, 7);
  assert.equal(layout.indexMap['Included'], 2);
  assert.equal(layout.indexMap['GPT 요약'], 3);
  assert.equal(layout.indexMap['Scores'], 4);
  assert.equal(layout.indexMap['Final Score'], 5);
  assert.equal(layout.indexMap['Exclusion Reason'], 6);
});

test('shouldSummarizeRow skips only explicit non-included rows', () => {
  assert.equal(shouldSummarizeRow('O', true), true);
  assert.equal(shouldSummarizeRow('', true), true);
  assert.equal(shouldSummarizeRow(undefined, true), true);
  assert.equal(shouldSummarizeRow('X', true), false);
  assert.equal(shouldSummarizeRow('O', false), true);
});

test('formatPaperDateValue handles Date, string, and empty values safely', () => {
  const fakeUtilities = {
    formatDate(date, timezone, pattern) {
      assert.equal(timezone, 'GMT+9');
      assert.equal(pattern, 'yyyy년 MM월 dd일');
      return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, '0')}월 ${String(date.getDate()).padStart(2, '0')}일`;
    }
  };

  assert.equal(
    formatPaperDateValue(new Date('2025-04-22T00:00:00Z'), fakeUtilities),
    '2025년 04월 22일'
  );
  assert.equal(formatPaperDateValue('2025 Apr 22', fakeUtilities), '2025 Apr 22');
  assert.equal(formatPaperDateValue('', fakeUtilities), '');
});
