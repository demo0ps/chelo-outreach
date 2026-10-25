const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const csvStart = source.indexOf('const CSV_IMPORT_FIELDS = [');
const iconsStart = source.indexOf('\nconst icons = {', csvStart);
const parserStart = source.indexOf('function parseCsvDocument(text) {');
const parserEnd = source.indexOf('\nasync function handleCandidateCsv', parserStart);
const modalStart = source.indexOf('function candidateCsvPreviewModal(preview) {');
const modalEnd = source.indexOf('\nfunction leadDetailModal', modalStart);
assert(csvStart >= 0 && iconsStart > csvStart, 'CSV mapping helpers were not found');
assert(parserStart >= 0 && parserEnd > parserStart, 'CSV parser helpers were not found');
assert(modalStart >= 0 && modalEnd > modalStart, 'CSV preview UI was not found');

const helpers = `const state = { data: { leads: [], candidates: [] } };\nconst esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));\nconst money = value => 'R ' + Number(value || 0);\nconst dateOnly = value => String(value || '');\nconst svgIcon = () => '<svg></svg>';\nfunction modalFrame(title, subtitle, body, footer) { return '<dialog>' + title + subtitle + body + footer + '</dialog>'; }\n${source.slice(csvStart, iconsStart)}\n${source.slice(parserStart, parserEnd)}\n${source.slice(modalStart, modalEnd)}\nglobalThis.test = { parseCsvDocument, autoMapCsvHeaders, getCsvPreviewRows, candidateCsvPreviewModal };`;
const context = { Date, Map, Set, Number, String, Object, Array, Math, JSON, console };
vm.runInNewContext(helpers, context);

const csv = [
  'Organisation Name,Full Name,Work Email,Source,Contact Last Verified,Source Last Checked,Warm Introduction,Partner Priorities,Amount,Fit Score,Notes',
  '"Acme, Group","Ada Example",ada@acme.example,Annual report,2026-10-20,2026-10-19,"Board member knows their CSI lead","Education grants, annual cycle","R 250,000",78,"Quoted ""impact"" note"',
  'Acme Group,Ada Other,ada@acme.example,Annual report,2026-10-20,2026-10-19,,,,,Duplicate row',
].join('\n');
const parsed = context.test.parseCsvDocument(csv);
assert.equal(parsed.rows.length, 2);
assert.equal(parsed.rows[0].values[0], 'Acme, Group');
assert.equal(parsed.rows[0].values[10], 'Quoted "impact" note');

const mapping = context.test.autoMapCsvHeaders(parsed.headers);
assert.equal(mapping.company, 0);
assert.equal(mapping.contactLastVerifiedAt, 4);
assert.equal(mapping.sourceLastVerifiedAt, 5);
assert.equal(mapping.relationshipContext, 6);
assert.equal(mapping.partnerPriorities, 7);
const previewRows = context.test.getCsvPreviewRows({ headers: parsed.headers, rows: parsed.rows, mapping });
assert.equal(previewRows[0].candidate.amount, 250000);
assert.equal(previewRows[0].candidate.fitScore, 78);
assert.match(previewRows[0].candidate.relationshipContext, /CSI lead/);
assert.match(previewRows[0].candidate.partnerPriorities, /annual cycle/);
assert.equal(previewRows[0].selected, true);
assert.equal(previewRows[1].duplicate.type, 'email');
assert.equal(previewRows[1].selected, false);
const markup = context.test.candidateCsvPreviewModal({ filename: 'synthetic.csv', headers: parsed.headers, rows: parsed.rows, mapping, totalRows: parsed.rows.length, omittedRows: 0, parserErrors: [] });
assert.match(markup, /Last verified/);
assert.match(markup, /Board member knows their CSI lead/);
assert.match(markup, /Education grants, annual cycle/);
assert.match(markup, /R 250000/);
assert.match(markup, /Possible exact email match/);
assert.match(markup, /Import 1 selected to Discover/);

const malformed = context.test.parseCsvDocument('company,contact_name\n"Broken,Row');
assert(malformed.errors.some(item => item.fatal), 'Malformed quoting must block import');
console.log('Client CSV parser and mapping smoke passed.');
