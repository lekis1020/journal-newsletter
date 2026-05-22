const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPaperSummaryLines,
  formatSummaryForEmail,
  normalizeJournalName,
  isInMyAllergyPortal,
  buildMyAllergyLink
} = require('./email.js');

test('normalizeJournalName strips "the", parentheticals, and punctuation', () => {
  assert.equal(normalizeJournalName('The Lancet'), 'lancet');
  assert.equal(normalizeJournalName('Lancet (London, England)'), 'lancet');
  assert.equal(
    normalizeJournalName('The Journal of allergy and clinical immunology'),
    'journalofallergyandclinicalimmunology'
  );
  assert.equal(
    normalizeJournalName('Allergy, Asthma & Immunology Research'),
    'allergyasthmaandimmunologyresearch'
  );
  assert.equal(normalizeJournalName(''), '');
  assert.equal(normalizeJournalName(null), '');
});

test('normalizeJournalName strips " : society" subtitles but keeps ". subtitle" journals', () => {
  // PubMed appends " : journal of the ... Society" to some titles
  assert.equal(
    normalizeJournalName(
      'Clinical and experimental allergy : journal of the British Society for Allergy and Clinical Immunology'
    ),
    'clinicalandexperimentalallergy'
  );
  // ". subtitle" denotes a distinct journal and must NOT be collapsed
  assert.equal(normalizeJournalName('The Lancet. Respiratory medicine'), 'lancetrespiratorymedicine');
});

test('isInMyAllergyPortal handles PubMed society subtitles', () => {
  assert.equal(
    isInMyAllergyPortal(
      'Clinical and experimental allergy : journal of the British Society for Allergy and Clinical Immunology'
    ),
    true
  );
  assert.equal(
    isInMyAllergyPortal('Pediatric allergy and immunology : official publication of the European Society'),
    true
  );
  assert.equal(isInMyAllergyPortal('The Lancet. Respiratory medicine'), true);
});

test('isInMyAllergyPortal matches portal journals by name and abbreviation', () => {
  assert.equal(isInMyAllergyPortal('Allergy'), true);
  assert.equal(isInMyAllergyPortal('The Journal of allergy and clinical immunology'), true);
  assert.equal(isInMyAllergyPortal('Lancet (London, England)'), true);
  assert.equal(isInMyAllergyPortal('J Allergy Clin Immunol'), true);
  assert.equal(isInMyAllergyPortal('Allergy, Asthma & Immunology Research'), true);
});

test('isInMyAllergyPortal rejects journals not tracked by the portal', () => {
  assert.equal(isInMyAllergyPortal('Journal of Cutaneous Immunology and Allergy'), false);
  assert.equal(isInMyAllergyPortal('Some Random Journal'), false);
  assert.equal(isInMyAllergyPortal(''), false);
  assert.equal(isInMyAllergyPortal('저널 정보 없음'), false);
});

test('buildMyAllergyLink returns a deep link only for valid PMID in a portal journal', () => {
  assert.equal(
    buildMyAllergyLink('40123456', 'Allergy'),
    'https://my-allergy.vercel.app/paper/40123456'
  );
  // non-portal journal -> no link (avoids 404)
  assert.equal(buildMyAllergyLink('40123456', 'Journal of Cutaneous Immunology and Allergy'), null);
  // invalid / missing PMID -> no link
  assert.equal(buildMyAllergyLink('PMID 정보 없음', 'Allergy'), null);
  assert.equal(buildMyAllergyLink('', 'Allergy'), null);
  assert.equal(buildMyAllergyLink(null, 'Allergy'), null);
});

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
