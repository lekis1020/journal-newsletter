const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPaperSummaryLines, formatSummaryForEmail } = require('./email.js');

test('buildPaperSummaryLines splits summary into trimmed non-empty lines', () => {
  const lines = buildPaperSummaryLines(
    '• 🗓️: Tue Apr 22 2025\n• 📒: Allergy\n• 🎯: 핵심 결과'
  );

  assert.deepEqual(lines, [
    '• 🗓️: Tue Apr 22 2025',
    '• 📒: Allergy',
    '• 🎯: 핵심 결과'
  ]);
});

test('buildPaperSummaryLines handles empty and null input', () => {
  assert.deepEqual(buildPaperSummaryLines(''), []);
  assert.deepEqual(buildPaperSummaryLines(null), []);
  assert.deepEqual(buildPaperSummaryLines(undefined), []);
});

test('formatSummaryForEmail renders emoji-based lines as styled divs', () => {
  const html = formatSummaryForEmail(
    '• 🗓️: Tue Apr 22 2025\n• 📒: Allergy\n• 👤: Kim et al.\n• Tag: #Urticaria #MastCell'
  );

  assert.match(html, /🗓️: Tue Apr 22 2025/);
  assert.match(html, /📒: Allergy/);
  assert.match(html, /👤: Kim et al\./);
  assert.match(html, /Tag: #Urticaria #MastCell/);
  assert.doesNotMatch(html, /<br>/);
  assert.match(html, /display:block/);
});

test('formatSummaryForEmail highlights Tag lines with blue bold style', () => {
  const html = formatSummaryForEmail('• Tag: #Urticaria');

  assert.match(html, /color:#0891B2/);
  assert.match(html, /font-weight:600/);
});
