const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('public/app.js', 'utf8');
const serverSource = fs.readFileSync('server.js', 'utf8');
function sliceFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `Could not find ${startMarker}`);
  return source.slice(start, end);
}

const lead = {
  id: 'synthetic-intro', company: 'Synthetic Community Foundation', contactName: 'Ada Example',
  email: 'ada@example.test', sector: 'Community investment', project: 'School connectivity',
  amount: 250000, bookingToken: 'synthetic-booking-token', followUpStep: 1,
};
const meetingMinutes = 20;
const priorityQuestion = 'Which education or community-impact priorities are most important to your team this year?';
const countQuestions = body => (String(body).match(/\?/g) || []).length;

const appEmailFunction = sliceFunction(appSource, 'function makeEmailDraft(lead, followUp) {', '\nfunction makeClientOutreachSubject');
const appHelperFunction = sliceFunction(appSource, 'function emailBodyForAttachmentMode(body, attachProposal = false) {', '\nfunction followUpPdfSelected');
const appOutreachModal = sliceFunction(appSource, 'function outreachModal(lead) {', '\nfunction makeEmailDraft');
const appContext = {
  INTRO_MEETING_MINUTES: meetingMinutes,
  state: { data: { aiConfigured: false, aiModel: '' }, modal: {} },
  bookingLink: item => `https://chelo.test/track/cta/${item.bookingToken}`,
  optOutLink: item => `https://chelo.test/opt-out/${item.bookingToken}`,
  makeClientOutreachSubject: () => 'School connectivity introduction',
  money: value => `R ${Number(value || 0).toLocaleString('en-ZA')}`,
  stripProposalLinks: body => String(body || '').split(/\r?\n/).filter(line => !/\/proposal\//i.test(line)).join('\n').trim(),
  esc: value => String(value ?? ''),
  svgIcon: () => '<svg></svg>',
  modalFrame: (title, subtitle, body, footer) => `<dialog>${title}${subtitle}${body}${footer}</dialog>`,
};
vm.runInNewContext(`${appEmailFunction}\n${appHelperFunction}\n${appOutreachModal}\nglobalThis.test = { makeEmailDraft, emailBodyForAttachmentMode, outreachModal };`, appContext);

const intro = appContext.test.makeEmailDraft(lead, false);
assert.equal(countQuestions(intro.body), 1, 'The first-touch email must ask only the priorities question.');
assert.match(intro.body, /Which education or community-impact priorities/);
assert.match(intro.body, /Yes — choose a time/);
assert.match(intro.body, /20-minute introductory video briefing/);
assert.match(intro.body, /No preparation or commitment is required/);
assert.match(intro.body, /track\/cta\/synthetic-booking-token/);
assert.doesNotMatch(intro.body, /proposal|\.pdf|attached/i, 'The opener must not mention or claim a PDF attachment.');

const withOldAttachmentClaim = `${intro.body}\n\nThe personalised Chelo proposal PDF is attached for context.`;
const cleanedIntro = appContext.test.emailBodyForAttachmentMode(withOldAttachmentClaim, false);
assert.doesNotMatch(cleanedIntro, /proposal PDF|attached/i, 'First-touch sanitation must remove stale attachment copy.');
const followUp = appContext.test.makeEmailDraft({ ...lead, proposalFile: 'prepared.pdf' }, true);
assert.doesNotMatch(followUp.body, /proposal PDF|attached/i, 'A prepared PDF must not auto-attach to an ordinary follow-up.');
const optedInFollowUp = appContext.test.emailBodyForAttachmentMode(followUp.body, true);
assert.match(optedInFollowUp, /proposal PDF is attached/);

const outreachMarkup = appContext.test.outreachModal(lead);
assert.match(outreachMarkup, /Prepare the first-touch invitation/);
assert.match(outreachMarkup, /No proposal PDF or proposal link is included/);
assert.match(outreachMarkup, /Generate intro email/);
assert.doesNotMatch(outreachMarkup, /Generate email \+ proposal PDF/);

const serverTemplateFunction = sliceFunction(serverSource, 'function makeOutreachEmail(lead, origin) {', '\nfunction makeFollowUpEmail');
const serverFollowUpFunction = sliceFunction(serverSource, 'function makeFollowUpEmail(lead, origin, attachProposal = false) {', '\nasync function generateFollowUpEmail');
const serverEmailHelpers = sliceFunction(serverSource, 'function cleanApprovedEmailBody(draft, attachProposal = false) {', '\nfunction openTrackingUrl');
const serverEmlBuilder = sliceFunction(serverSource, 'function buildEmailEml(lead, draft, followUp, pixelUrl = \'\', pdfBuffer = null) {', '\nfunction sendPdf');
const serverContext = {
  INTRO_MEETING_MINUTES: meetingMinutes,
  Buffer,
  crypto,
  safeFilename: name => String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '-'),
  mimeBase64: value => {
    const encoded = Buffer.from(value).toString('base64');
    return encoded.match(/.{1,76}/g)?.join('\r\n') || '';
  },
  outreachLinks: (item, origin) => ({
    booking: `${origin}/track/cta/${encodeURIComponent(item.bookingToken)}`,
    optOut: `${origin}/opt-out/${encodeURIComponent(item.bookingToken)}`,
  }),
  makeOutreachSubject: () => 'School connectivity introduction',
  subjectWordPrefix: (value, maxChars = 26, maxWords = 4) => String(value || '').split(/\s+/).slice(0, maxWords).join(' ').slice(0, maxChars),
};
vm.runInNewContext(`${serverTemplateFunction}\n${serverFollowUpFunction}\n${serverEmailHelpers}\n${serverEmlBuilder}\nglobalThis.test = { makeOutreachEmail, makeFollowUpEmail, cleanApprovedEmailBody, emailHtml, buildEmailEml };`, serverContext);

const serverIntro = serverContext.test.makeOutreachEmail(lead, 'https://chelo.test');
assert.equal(countQuestions(serverIntro.body), 1);
assert.match(serverIntro.body, /20-minute introductory video briefing/);
assert.match(serverIntro.body, /Yes — choose a time/);
assert.doesNotMatch(serverIntro.body, /proposal|\.pdf|attached/i);
const generatedFollowUp = serverContext.test.makeFollowUpEmail({ ...lead, proposalFile: 'prepared.pdf' }, 'https://chelo.test');
assert.doesNotMatch(generatedFollowUp.body, /proposal PDF|attached/i, 'A prepared PDF remains opt-in for follow-ups.');

const html = serverContext.test.emailHtml(serverIntro.body);
assert.match(html, /role="button"/);
assert.match(html, /Yes — choose a time/);
assert.match(html, /href="https:\/\/chelo\.test\/track\/cta\/synthetic-booking-token"/);
assert.match(html, /20-minute introductory video chat/);

const textOnlyEml = serverContext.test.buildEmailEml(lead, serverIntro, false, '', null);
assert.match(textOnlyEml.eml, /Content-Type: multipart\/alternative/);
assert.doesNotMatch(textOnlyEml.eml, /application\/pdf|Chelo-Partnership-Proposal\.pdf/i);
const preparedPdfEml = serverContext.test.buildEmailEml(lead, { subject: serverIntro.subject, body: generatedFollowUp.body }, true, '', Buffer.from('%PDF-synthetic'));
assert.match(preparedPdfEml.eml, /Content-Type: application\/pdf/);
assert.match(preparedPdfEml.eml, /Content-Disposition: attachment/);

const generationRoute = sliceFunction(serverSource, "      if (method === 'POST' && action === 'outreach/generate') {", "      if (method === 'POST' && action === 'follow-up/draft') {");
assert.match(generationRoute, /generateOutreachEmail\(/);
assert.doesNotMatch(generationRoute, /generateProposalDraft\(|createProposal\(/, 'Intro-email generation must not create a proposal PDF.');
const approvalRoute = sliceFunction(serverSource, "      if (method === 'POST' && action === 'approve-email') {", "      if (method === 'POST' && action === 'send-email') {");
assert.match(approvalRoute, /Boolean\(followUp && body\.attachProposal && lead\.proposalFile\)/);
const sendRoute = sliceFunction(serverSource, "      if (method === 'POST' && action === 'send-email') {", "      if (method === 'POST' && action === 'mark-sent') {");
assert.match(sendRoute, /Boolean\(followUp && draft\?\.attachProposal && lead\.proposalFile\)/);
assert.match(sendRoute, /attachments: attachProposal \?/);

console.log('First-touch email, booking-button and optional-PDF handoff smoke passed.');
