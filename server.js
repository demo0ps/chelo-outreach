const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('node:dns/promises');
const { domainToASCII } = require('node:url');
const nodemailer = require('nodemailer');
const createConfigStore = require('./lib/config-store');
const createSqliteStore = require('./lib/sqlite-store');
const { clampText, toPdfText, pdfEscape, parseVerifiedMetrics, makeProposalPdf } = require('./lib/pdf-engine');
const calendar = require('./lib/calendar-ics');
const popia = require('./lib/popia-copilot');
const inbound = require('./lib/inbound-sync');
const createFunderResearch = require('./lib/funder-research');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PROPOSAL_DIR = path.join(DATA_DIR, 'proposals');
const configStore = createConfigStore(DATA_DIR);
const store = createSqliteStore(DATA_DIR);
const research = createFunderResearch({ log: message => console.warn(`[research] ${message}`), allowLoopback: process.env.RESEARCH_ALLOW_LOOPBACK === 'true' && process.env.NODE_ENV !== 'production' });
const sendingLocks = new Set();
const emailDomainCheckCache = new Map();
const PORT = Number(process.env.PORT || 3000);
const DEMO_ADMIN_ACCESS = process.env.DEMO_ADMIN_ACCESS === 'true' && process.env.NODE_ENV !== 'production' && Boolean(process.env.DATA_DIR);
const DEMO_OPEN_ACCESS = process.env.DEMO_OPEN_ACCESS === 'true' && process.env.NODE_ENV !== 'production' && Boolean(process.env.DATA_DIR);
// Deterministic when SETTINGS_ENCRYPTION_KEY is set so multi-instance demo hosts (e.g. serverless) agree on the token.
const DEMO_OPEN_CSRF_TOKEN = DEMO_OPEN_ACCESS
  ? (process.env.SETTINGS_ENCRYPTION_KEY ? crypto.createHash('sha256').update(`chelo-demo-csrf:${process.env.SETTINGS_ENCRYPTION_KEY}`).digest('hex') : crypto.randomBytes(32).toString('hex'))
  : '';
const INTRO_MEETING_MINUTES = 20;
const HOST = '0.0.0.0';
const STAGES = ['New', 'Researched', 'Contacted', 'Interested', 'Proposal sent', 'Briefing requested', 'Briefing booked', 'Won', 'Not proceeding'];
const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape', 'National'];
const ALLOWED_LEAD_FIELDS = new Set(['company', 'contactName', 'title', 'email', 'phone', 'sector', 'sourceUrl', 'sourceName', 'sourceLastVerifiedAt', 'contactLastVerifiedAt', 'relationshipContext', 'partnerPriorities', 'grantWindowOpenMonth', 'grantWindowCloseMonth', 'nextGrantDeadline', 'projectId', 'project', 'amount', 'stage', 'fitScore', 'notes', 'owner', 'nextAction', 'doNotContact', 'emailStatus', 'emailDraft', 'followUpDraft', 'followUpEmailStatus', 'proposalData']);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PROPOSAL_DIR, { recursive: true });

const db = store.db;
let savePending = false;
let saveTimer = null;
function flushDb() {
  savePending = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  store.saveDb();
}
// Critical writes persist immediately; high-frequency tracking hits are coalesced (ACID transaction per flush).
function saveDb() { flushDb(); }
function saveDbDeferred() {
  if (savePending) return;
  savePending = true;
  saveTimer = setTimeout(() => { try { flushDb(); } catch (err) { console.error('Deferred persist failed:', err.message); } }, 400);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { if (savePending) flushDb(); } catch {}
    try { store.close(); } catch {}
    process.exit(0);
  });
}
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function addActivity(text, type = 'update', actor = 'staff') {
  db.activities.unshift({ id: id('activity'), text, type, createdAt: new Date().toISOString() });
  db.activities = db.activities.slice(0, 60);
  configStore.recordAudit({ actor, action: type, entityType: 'activity', summary: text });
}
function addEmailEvent(leadId, type, messageId = null, source = 'first-party') {
  const event = { id: id('event'), leadId, messageId, type, occurredAt: new Date().toISOString(), source };
  db.emailEvents.unshift(event);
  db.emailEvents = db.emailEvents.slice(0, 10000);
  return event;
}
function addBusinessDays(date, count) {
  const d = new Date(date);
  let added = 0;
  while (added < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added += 1;
  }
  return d;
}
function normalizeDateOnly(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const datePart = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  if (text.length > 10 && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text) || Number.isNaN(new Date(text).valueOf()))) return null;
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === datePart ? datePart : null;
}
function verificationDateFields(record) {
  const contactRaw = String(record?.contactLastVerifiedAt ?? '').trim();
  const sourceRaw = String(record?.sourceLastVerifiedAt ?? '').trim();
  const contactLastVerifiedAt = normalizeDateOnly(contactRaw);
  const sourceLastVerifiedAt = normalizeDateOnly(sourceRaw);
  const issues = [];
  if (contactRaw && contactLastVerifiedAt === null) issues.push('Contact last-verified date must use YYYY-MM-DD or an ISO timestamp.');
  if (sourceRaw && sourceLastVerifiedAt === null) issues.push('Source last-checked date must use YYYY-MM-DD or an ISO timestamp.');
  return { ok: issues.length === 0, issues, contactLastVerifiedAt: contactLastVerifiedAt || '', sourceLastVerifiedAt: sourceLastVerifiedAt || '' };
}
function monthField(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 0;
}
function projectLinkFields(body) {
  const projectId = String(body.projectId || '').trim();
  const linked = projectId ? db.projects.find(p => p.id === projectId) : null;
  if (projectId && !linked) throw new Error('Linked verified project no longer exists. Choose another catalog project.');
  const deadline = normalizeDateOnly(body.nextGrantDeadline);
  if (deadline === null) throw new Error('Next grant deadline must be a valid YYYY-MM-DD date.');
  return {
    projectId: linked ? linked.id : '',
    project: linked ? linked.name : String(body.project || 'Education impact partnership').trim(),
    grantWindowOpenMonth: monthField(body.grantWindowOpenMonth),
    grantWindowCloseMonth: monthField(body.grantWindowCloseMonth),
    nextGrantDeadline: deadline || ''
  };
}
function safeProject(body = {}) {
  const name = clampText(body.name, 160);
  if (!name) throw new Error('Project name is required.');
  const recipientName = clampText(body.recipientName ?? body.recipient_name, 200);
  if (!recipientName) throw new Error('Verified recipient (school, NGO or community organisation) is required.');
  const targetAmount = Math.max(0, Number(String(body.targetAmount ?? body.target_amount ?? 0).replace(/[^\d.]/g, '')) || 0);
  const committedAmount = Math.max(0, Number(String(body.committedAmount ?? body.committed_amount ?? 0).replace(/[^\d.]/g, '')) || 0);
  if (committedAmount > targetAmount && targetAmount > 0) throw new Error('Committed funding cannot exceed the target budget.');
  const verifiedAt = normalizeDateOnly(body.verifiedAt ?? body.verified_at);
  if (verifiedAt === null) throw new Error('Verified date must use YYYY-MM-DD.');
  const sourceUrl = clampText(body.sourceUrl ?? body.source_url, 2000);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('Verification source must be an http(s) URL.');
  const metricsInput = body.verifiedMetrics ?? body.verified_metrics;
  return {
    name,
    recipientName,
    recipientType: clampText(body.recipientType ?? body.recipient_type, 120),
    province: clampText(body.province, 60),
    sector: clampText(body.sector, 120),
    targetAmount,
    committedAmount,
    status: clampText(body.status, 60) || 'Verified · Seeking Partners',
    grantCycleWindow: clampText(body.grantCycleWindow ?? body.grant_cycle_window, 200),
    sourceUrl,
    verifiedAt: verifiedAt || '',
    summary: clampText(body.summary, 1200),
    verifiedMetrics: parseVerifiedMetrics(metricsInput, { strict: typeof metricsInput === 'string' && metricsInput.trim().length > 0 })
  };
}
function projectFunding(project) {
  const pipeline = db.leads.filter(l => l.projectId === project.id && !['Won', 'Not proceeding'].includes(l.stage)).reduce((sum, l) => sum + Number(l.amount || 0), 0);
  const won = db.leads.filter(l => l.projectId === project.id && l.stage === 'Won').reduce((sum, l) => sum + Number(l.amount || 0), 0);
  const committed = Number(project.committedAmount || 0) + won;
  const gap = Math.max(0, Number(project.targetAmount || 0) - committed);
  return { committedTotal: committed, wonFromPipeline: won, pipelineAmount: pipeline, fundingGap: gap, coveragePct: project.targetAmount ? Math.min(100, Math.round((committed / project.targetAmount) * 100)) : 0 };
}
function clientProject(project) {
  return { ...project, funding: projectFunding(project), linkedProspects: db.leads.filter(l => l.projectId === project.id).length, linkedPartners: db.partners.filter(p => p.projectId === project.id).length };
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2_000_000) { reject(new Error('Request is too large.')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function safeLead(body, contactCheck = null) {
  const company = String(body.company || '').trim();
  if (!company) throw new Error('Company or organisation name is required.');
  const dates = verificationDateFields(body);
  if (!dates.ok) throw new Error(dates.issues.join(' '));
  const now = new Date().toISOString();
  return {
    id: id('lead'), company,
    contactName: String(body.contactName || '').trim(),
    title: String(body.title || '').trim(),
    email: normalizeEmail(body.email),
    phone: String(body.phone || '').trim(),
    sector: String(body.sector || '').trim(),
    sourceUrl: clampText(body.sourceUrl, 2000),
    sourceName: clampText(body.sourceName, 300),
    sourceLastVerifiedAt: dates.sourceLastVerifiedAt,
    contactLastVerifiedAt: dates.contactLastVerifiedAt,
    relationshipContext: clampText(body.relationshipContext, 800),
    partnerPriorities: clampText(body.partnerPriorities, 1200),
    ...projectLinkFields(body),
    amount: Math.max(0, Number(body.amount || 0)),
    stage: STAGES.includes(body.stage) ? body.stage : 'New',
    fitScore: Math.max(0, Math.min(100, Number(body.fitScore || 70))),
    notes: String(body.notes || '').trim(),
    owner: String(body.owner || 'Nandi').trim(),
    nextAction: String(body.nextAction || 'Review lead fit').trim(),
    doNotContact: Boolean(body.doNotContact),
    contactCheck: contactCheck || body.contactCheck || null,
    emailStatus: 'Not started', emailDraft: null,
    proposalData: null, proposalFile: null, proposalToken: null,
    bookingToken: crypto.randomBytes(18).toString('hex'),
    lastContactedAt: null, followUpAt: null,
    createdAt: now, updatedAt: now
  };
}
function safeCandidate(body, contactCheck = null) {
  const company = String(body.company || '').trim();
  if (!company) throw new Error('Company or organisation name is required.');
  const dates = verificationDateFields(body);
  if (!dates.ok) throw new Error(dates.issues.join(' '));
  return {
    id: id('candidate'), company,
    contactName: String(body.contactName || '').trim(), title: String(body.title || '').trim(),
    email: normalizeEmail(body.email), phone: String(body.phone || '').trim(),
    sector: String(body.sector || '').trim(), sourceUrl: clampText(body.sourceUrl, 2000),
    sourceName: clampText(body.sourceName, 300),
    sourceLastVerifiedAt: dates.sourceLastVerifiedAt,
    contactLastVerifiedAt: dates.contactLastVerifiedAt,
    relationshipContext: clampText(body.relationshipContext, 800),
    partnerPriorities: clampText(body.partnerPriorities, 1200),
    ...projectLinkFields(body),
    amount: Math.max(0, Number(body.amount || 0)),
    fitScore: Math.max(0, Math.min(100, Number(body.fitScore || 70))),
    notes: clampText(body.notes, 2000), owner: String(body.owner || 'Nandi').trim(), sourceKind: 'CSV import',
    status: 'New candidate', promotedLeadId: null, contactCheck: contactCheck || null, createdAt: new Date().toISOString()
  };
}
function normCompany(value) { return String(value || '').toLowerCase().replace(/\s·\s*demo$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function emailHash(value) {
  const email = normalizeEmail(value);
  return email ? configStore.hashSuppressionAddress(email) : '';
}
function isSuppressedEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return false;
  const hash = emailHash(email);
  return (db.suppressedEmailHashes || []).includes(hash) || db.leads.some(lead => lead.doNotContact && normalizeEmail(lead.email) === email);
}
function rememberSuppressedEmail(value) {
  const hash = emailHash(value);
  if (!hash) return;
  db.suppressedEmailHashes ||= [];
  if (!db.suppressedEmailHashes.includes(hash)) db.suppressedEmailHashes.push(hash);
  if (db.suppressedEmailHashes.length > 50000) db.suppressedEmailHashes = db.suppressedEmailHashes.slice(-50000);
}
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
function validateEmailSyntax(value) {
  const email = normalizeEmail(value);
  if (!email) return { ok: false, missing: true, reason: 'Work email is missing.' };
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const rawDomain = email.slice(at + 1);
  const domain = domainToASCII(rawDomain);
  if (email.length > 254 || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain || !EMAIL_PATTERN.test(`${local}@${domain}`) || domain.length > 253) {
    return { ok: false, reason: 'Email address format is invalid.' };
  }
  return { ok: true, email, domain };
}
const TRANSIENT_DNS_CODES = new Set(['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'EAI_FAIL', 'ENOTIMP', 'EREFUSED', 'SERVFAIL', 'TIMEOUT', 'REFUSED', 'ECANCELED', 'CANCELLED']);
async function checkEmailDomain(value) {
  const syntax = validateEmailSyntax(value);
  if (!syntax.ok) return { status: syntax.missing ? 'missing' : 'invalid', reason: syntax.reason };
  const now = Date.now();
  const cached = emailDomainCheckCache.get(syntax.domain);
  if (cached && cached.expiresAt > now) return { ...cached.result, email: syntax.email, cached: true };
  const resolver = new dns.Resolver({ timeout: 1800, tries: 1 });
  let transient = false;
  const lookup = async method => {
    try {
      const records = await resolver[method](syntax.domain);
      return { found: Array.isArray(records) && records.length > 0, records: Array.isArray(records) ? records : [], error: null };
    } catch (err) {
      const code = String(err.code || '').toUpperCase();
      if (TRANSIENT_DNS_CODES.has(code)) transient = true;
      else if (!['ENODATA', 'ENOTFOUND', 'NODATA', 'NOTFOUND'].includes(code)) transient = true;
      return { found: false, records: [], error: code };
    }
  };
  const mx = await lookup('resolveMx');
  if (mx.found && mx.records.length === 1 && Number(mx.records[0].priority) === 0 && ['', '.'].includes(String(mx.records[0].exchange || '').trim())) {
    const result = { status: 'invalid', reason: 'Email domain publishes a null MX and explicitly does not accept email.' };
    emailDomainCheckCache.set(syntax.domain, { result, expiresAt: now + 60 * 1000 });
    return { ...result, email: syntax.email };
  }
  if (mx.found) {
    const result = { status: 'domain-valid', method: 'MX', reason: 'Email domain has a mail-server record; this does not confirm the individual mailbox.' };
    emailDomainCheckCache.set(syntax.domain, { result, expiresAt: now + 10 * 60 * 1000 });
    return { ...result, email: syntax.email };
  }
  for (const method of ['resolve4', 'resolve6']) {
    const address = await lookup(method);
    if (address.found) {
      const result = { status: 'domain-valid', method: 'A/AAAA fallback', reason: 'Email domain resolves; this does not confirm the individual mailbox.' };
      emailDomainCheckCache.set(syntax.domain, { result, expiresAt: now + 10 * 60 * 1000 });
      return { ...result, email: syntax.email };
    }
  }
  if (transient) return { status: 'retry-required', reason: 'A temporary DNS lookup failure prevented checking the email domain. Retry before drafting.' };
  const result = { status: 'invalid', reason: 'Email domain has no mail-server or address records.' };
  emailDomainCheckCache.set(syntax.domain, { result, expiresAt: now + 60 * 1000 });
  return { ...result, email: syntax.email };
}
function missingContactFields(record) {
  const missing = [];
  if (!String(record.company || '').trim()) missing.push('organisation name');
  if (!String(record.contactName || '').trim()) missing.push('contact name');
  if (!normalizeEmail(record.email)) missing.push('work email');
  if (!String(record.sourceName || '').trim() && !String(record.sourceUrl || '').trim()) missing.push('source name or URL');
  return missing;
}
async function inspectContactRecord(record) {
  const checkedAt = new Date().toISOString();
  const missing = missingContactFields(record);
  const domain = await checkEmailDomain(record.email);
  if (domain.status === 'invalid') return { status: 'invalid', emailStatus: 'invalid', reason: domain.reason, issues: [...missing, domain.reason], checkedAt };
  if (domain.status === 'retry-required') return { status: 'retry-required', emailStatus: 'retry-required', method: null, issues: [...missing, domain.reason], checkedAt };
  if (domain.status === 'missing') return { status: 'needs-clarification', emailStatus: 'missing', method: null, issues: missing, checkedAt };
  if (missing.length) return { status: 'needs-clarification', emailStatus: 'domain-valid', method: domain.method, issues: missing, reason: domain.reason, checkedAt };
  return { status: 'ready', emailStatus: 'domain-valid', method: domain.method, issues: [], reason: domain.reason, checkedAt };
}
async function requireContactReady(lead) {
  if (lead.doNotContact || isSuppressedEmail(lead.email)) return { ok: false, contactCheck: lead.contactCheck || null, error: 'This address is on the do-not-contact suppression list; drafting and sending are disabled.' };
  const contactCheck = await inspectContactRecord(lead);
  lead.contactCheck = contactCheck;
  if (contactCheck.status !== 'ready') {
    const detail = contactCheck.issues?.length ? ` Missing/failed: ${contactCheck.issues.join(', ')}.` : '';
    return { ok: false, contactCheck, error: `Contact intake check is not ready; resolve it before drafting or sending.${detail}` };
  }
  return { ok: true, contactCheck };
}
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}
function ensurePartner(lead, actor = 'staff') {
  let partner = db.partners.find(p => p.leadId === lead.id);
  if (!partner) {
    partner = {
      id: id('partner'), leadId: lead.id, company: lead.company,
      contactName: lead.contactName, title: lead.title, email: lead.email,
      phone: lead.phone, projectId: lead.projectId || '', project: lead.project, amount: Number(lead.amount || 0),
      sourceName: lead.sourceName || '', sourceUrl: lead.sourceUrl || '',
      sourceLastVerifiedAt: lead.sourceLastVerifiedAt || '', contactLastVerifiedAt: lead.contactLastVerifiedAt || '',
      relationshipContext: lead.relationshipContext || '', partnerPriorities: lead.partnerPriorities || '',
      status: 'Active', partnerSince: new Date().toISOString(), owner: lead.owner || 'Nandi',
      notes: lead.notes || ''
    };
    db.partners.unshift(partner);
    addActivity(`${lead.company} converted to partner`, 'won', actor);
  } else {
    Object.assign(partner, { company: lead.company, contactName: lead.contactName, title: lead.title, email: lead.email, phone: lead.phone, projectId: lead.projectId || '', project: lead.project, amount: Number(lead.amount || 0), sourceName: lead.sourceName || '', sourceUrl: lead.sourceUrl || '', sourceLastVerifiedAt: lead.sourceLastVerifiedAt || '', contactLastVerifiedAt: lead.contactLastVerifiedAt || '', relationshipContext: lead.relationshipContext || '', partnerPriorities: lead.partnerPriorities || '', owner: lead.owner || partner.owner });
  }
  return partner;
}
function updateLead(lead, body, actor = 'staff') {
  const before = { ...lead };
  const previousStage = lead.stage;
  if (body && (body.projectId !== undefined || body.project !== undefined || body.grantWindowOpenMonth !== undefined || body.grantWindowCloseMonth !== undefined || body.nextGrantDeadline !== undefined)) {
    Object.assign(lead, projectLinkFields({ ...lead, ...body }));
  }
  for (const [key, value] of Object.entries(body || {})) {
    if (!ALLOWED_LEAD_FIELDS.has(key)) continue;
    if (['projectId', 'project', 'grantWindowOpenMonth', 'grantWindowCloseMonth', 'nextGrantDeadline'].includes(key)) continue;
    if (key === 'amount') lead.amount = Math.max(0, Number(value || 0));
    else if (key === 'fitScore') lead.fitScore = Math.max(0, Math.min(100, Number(value || 0)));
    else if (key === 'stage') lead.stage = STAGES.includes(value) ? value : lead.stage;
    else if (key === 'doNotContact') lead.doNotContact = Boolean(value);
    else if (key === 'relationshipContext') lead[key] = clampText(value, 800);
    else if (key === 'partnerPriorities') lead[key] = clampText(value, 1200);
    else if (key === 'sourceName') lead[key] = clampText(value, 300);
    else if (key === 'sourceUrl') lead[key] = clampText(value, 2000);
    else lead[key] = value;
  }
  lead.updatedAt = new Date().toISOString();
  if (lead.doNotContact) { rememberSuppressedEmail(lead.email); lead.followUpAt = null; }
  if (lead.stage === 'Won') ensurePartner(lead, actor);
  if (previousStage !== lead.stage) addActivity(`${lead.company} moved to ${lead.stage}`, lead.stage === 'Won' ? 'won' : 'stage', actor);
  const changedFields = [...ALLOWED_LEAD_FIELDS].filter(key => JSON.stringify(before[key]) !== JSON.stringify(lead[key]));
  if (changedFields.length) configStore.recordAudit({ actor, action: 'lead.updated', entityType: 'lead', entityId: lead.id, summary: `Updated ${changedFields.join(', ')} for ${lead.company}` });
  return lead;
}

function emailCopyProfile(message = {}) {
  const subject = String(message.subject || '').trim();
  const body = cleanApprovedEmailBody({ body: message.body || '' }).replace(/https?:\/\/\S+/g, ' ');
  const wordCount = (body.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
  const paragraphs = body.split(/\n{2,}/).map(value => value.trim()).filter(Boolean).length;
  const subjectLength = [...subject].length;
  return {
    subjectBand: subjectLength <= 35 ? '≤35 characters' : subjectLength <= 50 ? '36–50 characters' : '51+ characters',
    bodyBand: wordCount <= 120 ? '≤120 words' : wordCount <= 165 ? '121–165 words' : '166+ words',
    layoutBand: paragraphs <= 5 ? 'compact (≤5 paragraphs)' : 'structured (6+ paragraphs)',
    subjectLength, wordCount, paragraphs
  };
}
function outreachLearningSignals() {
  const cutoff = Date.now() - 365 * 86400000;
  const messages = db.messages.filter(message => message.kind === 'initial'
    && ['Sent', 'Confirmed by staff'].includes(message.status)
    && Number.isFinite(Date.parse(message.sentAt || '')) && Date.parse(message.sentAt) >= cutoff);
  const messageIds = new Set(messages.map(message => message.id));
  const conversions = new Set(db.emailEvents.filter(event => event.type === 'booking' && event.messageId && messageIds.has(event.messageId)).map(event => event.messageId));
  const clicks = new Set(db.emailEvents.filter(event => event.type === 'click_cta' && event.messageId && messageIds.has(event.messageId)).map(event => event.messageId));
  const replies = new Set(db.emailEvents.filter(event => event.type === 'reply' && event.messageId && messageIds.has(event.messageId)).map(event => event.messageId));
  const profiles = messages.map(message => ({ message, profile: message.copyProfile || emailCopyProfile(message) }));
  const dimensions = [
    ['subject length', 'subjectBand'],
    ['body length', 'bodyBand'],
    ['paragraph layout', 'layoutBand']
  ];
  const recommendations = [];
  for (const [dimension, key] of dimensions) {
    const groups = new Map();
    for (const { message, profile } of profiles) {
      const label = profile[key] || 'unclassified';
      if (!groups.has(label)) groups.set(label, { band: label, sent: 0, preferredTimeRequests: 0, replies: 0, ctaClicks: 0 });
      const group = groups.get(label);
      group.sent += 1;
      if (conversions.has(message.id)) group.preferredTimeRequests += 1;
      if (replies.has(message.id)) group.replies += 1;
      if (clicks.has(message.id)) group.ctaClicks += 1;
    }
    const eligible = [...groups.values()].filter(group => group.sent >= 5);
    if (eligible.length < 2) continue;
    const best = eligible.sort((a, b) => (b.preferredTimeRequests / b.sent) - (a.preferredTimeRequests / a.sent))[0];
    const baseRate = messages.length ? conversions.size / messages.length : 0;
    if (best.preferredTimeRequests / best.sent > baseRate && best.sent < messages.length) {
      recommendations.push({
        dimension, band: best.band, sent: best.sent, preferredTimeRequests: best.preferredTimeRequests,
        requestRate: Math.round(best.preferredTimeRequests / best.sent * 1000) / 10
      });
    }
  }
  const initialSends = messages.length;
  const status = initialSends >= 10 ? 'directional' : 'collecting';
  return {
    status, sampleWindowDays: 365, initialSends, preferredTimeRequests: conversions.size,
    replies: replies.size, ctaClickers: clicks.size, minimumPatternSample: 5,
    recommendations: status === 'directional' ? recommendations.slice(0, 3) : [],
    note: 'Observational aggregate signals only; no causal claim. Preferred-time requests are the primary conversion. Opens and CTA clicks are not treated as confirmed bookings.'
  };
}
/** Staff-approved, cited funder research; the only research that may reach drafting or the PDF. */
function approvedResearchContext(lead) {
  return research.approvedContext(lead?.research || null);
}
function approvedAlignmentForPdf(lead) {
  const brief = lead?.research;
  if (!brief || brief.status !== 'approved') return null;
  const points = brief.alignmentPoints.filter(a => brief.approvedAlignmentIds.includes(a.id)).slice(0, 3);
  const facts = brief.findings.filter(f => brief.approvedFindingIds.includes(f.id)).slice(0, 3);
  if (!points.length && !facts.length) return null;
  return {
    missionSummary: brief.missionSummary || '',
    points: points.map(a => ({ text: a.text, sourceUrl: a.sourceUrl })),
    facts: facts.map(f => ({ text: f.text, sourceUrl: f.sourceUrl })),
    researchedAt: brief.generatedAt
  };
}
function researchAlignmentSentence(lead) {
  const ctx = approvedResearchContext(lead);
  if (!ctx) return '';
  const point = ctx.alignmentWithChelo[0]?.point || ctx.citedFunderFacts[0]?.fact || ctx.funderMissionSummary;
  return point ? ` ${point.replace(/\s+$/, '').replace(/\.$/, '')}.` : '';
}
function createProposal(lead, proposal, actor = 'staff') {
  const linkedProject = lead.projectId ? db.projects.find(p => p.id === lead.projectId) : null;
  if (linkedProject) proposal = { ...proposal, recipientName: linkedProject.recipientName, province: linkedProject.province, verifiedMetrics: proposal.verifiedMetrics || linkedProject.verifiedMetrics };
  const alignment = approvedAlignmentForPdf(lead);
  if (alignment) proposal = { ...proposal, alignment };
  const buffer = makeProposalPdf(lead, proposal);
  const filename = `chelo-proposal-${lead.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(PROPOSAL_DIR, filename), buffer);
  lead.proposalFile = filename;
  lead.proposalToken = crypto.randomBytes(24).toString('hex');
  if (['Approved', 'Pending second approval'].includes(lead.emailStatus)) { lead.emailStatus = 'Draft'; lead.emailApproval = null; delete lead.approvedAt; if (lead.emailDraft?.openToken) delete lead.emailDraft.openToken; }
  if (['Approved', 'Pending second approval'].includes(lead.followUpEmailStatus)) { lead.followUpEmailStatus = 'Draft'; lead.followUpApproval = null; delete lead.followUpApprovedAt; if (lead.followUpDraft?.openToken) delete lead.followUpDraft.openToken; }
  lead.proposalData = {
    company: String(proposal.company || lead.company), contactName: String(proposal.contactName || lead.contactName),
    project: String(proposal.project || lead.project), amount: Number(proposal.amount ?? lead.amount ?? 0),
    opening: String(proposal.opening || ''), impact: String(proposal.impact || ''), rationale: String(proposal.rationale || ''), nextStep: String(proposal.nextStep || ''),
    userNotes: String(proposal.userNotes || ''), rewriteNotes: String(proposal.rewriteNotes || ''), guidelines: String(proposal.guidelines || ''), generationMode: String(proposal.generationMode || 'manual'),
    verifiedMetrics: parseVerifiedMetrics(proposal.verifiedMetrics)
  };
  lead.updatedAt = new Date().toISOString();
  addActivity(`Proposal generated for ${lead.company}`, 'proposal', actor);
  return lead;
}
function safeOrigin(value, req) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
  } catch {}
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded === 'https' ? 'https' : 'http';
  return `${protocol}://${req.headers.host || 'localhost'}`;
}
function publicOrigin(req) {
  const fallback = safeOrigin(req.headers.origin || req.headers.referer, req);
  return configStore.getPublicBaseUrl(fallback) || fallback;
}
function outreachLinks(lead, origin) {
  return {
    booking: `${origin}/track/cta/${encodeURIComponent(lead.bookingToken)}`,
    optOut: `${origin}/opt-out/${encodeURIComponent(lead.bookingToken)}`
  };
}
function ensurePrimaryBookingCta(body, links) {
  let cleaned = String(body || '').split(/\r?\n/)
    .filter(line => !/yes\s*[—-]\s*choose/i.test(line) && !line.includes(links.booking))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const cta = `Yes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${links.booking}`;
  const optOutAt = cleaned.indexOf(links.optOut);
  cleaned = optOutAt >= 0
    ? `${cleaned.slice(0, optOutAt).trimEnd()}\n\n${cta}\n\n${cleaned.slice(optOutAt)}`
    : `${cleaned}\n\n${cta}`.trim();
  return cleaned;
}
function subjectWordPrefix(value, maxChars = 26, maxWords = 4) {
  const words = String(value || '').replace(/\s*&\s*/g, ' ').split(/\s+/).filter(Boolean);
  let result = '';
  for (const word of words.slice(0, maxWords)) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxChars && result) break;
    result = next;
  }
  return result || 'Education partnership';
}
function makeOutreachSubject(company, project) {
  const cleanCompany = String(company || '').replace(/\s·\sDemo$/, '').trim();
  const projectLabel = subjectWordPrefix(String(project || 'education partnership').split(/[|;.!?]/)[0], 27, 2);
  const companyLabel = subjectWordPrefix(cleanCompany, 22, 2);
  const candidates = [
    `${projectLabel} partnership: ${companyLabel}`,
    `Chelo partnership: ${projectLabel} · ${companyLabel}`,
    `${projectLabel} for ${companyLabel}`,
    `Chelo + ${companyLabel}: ${projectLabel}`
  ];
  const preferred = candidates.find(value => value.length >= 36 && value.length <= 50);
  if (preferred) return preferred;
  return candidates.sort((a, b) => Math.abs(a.length - 43) - Math.abs(b.length - 43))[0].slice(0, 58).trim();
}
function outreachAudienceFrame(lead) {
  const profile = `${lead.company || ''} ${lead.title || ''} ${lead.sector || ''}`;
  return /\b(foundation|trust|grantmaking|philanthrop)\b/i.test(profile)
    ? 'Corporate foundation or philanthropic trust: frame around programme alignment and accountable community outcomes, without assuming a grant window or eligibility.'
    : 'Corporate CSI/ESG or sustainability leader: frame around authentic local community-investment alignment and clear reporting, without promising ESG compliance or ROI.';
}
function makeOutreachEmail(lead, origin) {
  const firstName = String(lead.contactName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Dear ${firstName},` : 'Hello,';
  const company = String(lead.company || '').replace(/\s·\sDemo$/, '');
  const project = lead.project || 'an education impact project';
  const links = outreachLinks(lead, origin);
  const amount = Number(lead.amount || 0) ? `, with a staff-proposed contribution of R ${Number(lead.amount).toLocaleString('en-ZA')}` : '';
  return {
    subject: makeOutreachSubject(company, project),
    body: `${greeting}\n\nI’m reaching out because ${company}’s work in ${lead.sector || 'community investment'} may align with Chelo’s focus on verified schools, NGOs and community projects, with traceable funding and progress reporting.${researchAlignmentSentence(lead)}\n\nOne possible focus is ${project}${amount}. Scope and feasibility would be validated with the project partner before any commitment. A short video conversation would let us hear your priorities, share how Chelo works, and explore whether a next step makes sense.\n\nWhich education or community-impact priorities are most important to your team this year?\n\nYes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${links.booking}\nChelo will review your preferred time and confirm it personally. No preparation or commitment is required.\n\nIf you prefer not to receive further outreach, opt out here: ${links.optOut}\n\nKind regards,\nChelo Partnerships Team`
  };
}
function makeFollowUpEmail(lead, origin, attachProposal = false) {
  const step = Number(lead.followUpStep || 1);
  const firstName = String(lead.contactName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Dear ${firstName},` : 'Hello,';
  const company = String(lead.company || '').replace(/\s·\sDemo$/, '');
  const project = lead.project || 'an education impact project';
  const links = outreachLinks(lead, origin);
  const companyShort = subjectWordPrefix(company, 24, 3);
  const projectShort = subjectWordPrefix(project, 42, 5);
  const subject = step >= 2 ? `Final note: ${companyShort}` : `Following up: ${projectShort}`;
  const opening = step >= 2 ? 'A final, low-pressure note in case this is relevant to your team.' : `I’m following up on my note about a possible Chelo partnership focused on ${project}.`;
  const proposalAttachment = attachProposal && lead.proposalFile ? '\n\nThe personalised Chelo proposal PDF is attached for context.' : '';
  return {
    subject,
    body: `${greeting}\n\n${opening}\n\nWhich education or community-impact priorities are most important to your team this year?\n\nYes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${links.booking}\nChelo will review your preferred time and confirm it personally. No preparation or commitment is required.${proposalAttachment}\n\nIf the timing is not right, no problem. To stop further outreach, use this link: ${links.optOut}\n\nKind regards,\nChelo Partnerships Team`
  };
}
async function generateFollowUpEmail(lead, input = {}, origin) {
  const attachProposal = Boolean(lead.proposalFile && input.attachProposal);
  const fallback = makeFollowUpEmail(lead, origin, attachProposal);
  const aiConfig = configStore.getAIConfig();
  if (!aiConfig.apiKey) return { draft: fallback, mode: 'guided-preview', message: 'AI provider is not configured. This follow-up uses a local guided template.' };
  const links = outreachLinks(lead, origin);
  const learning = outreachLearningSignals();
  const context = {
    company: clampText(lead.company, 150), contactName: clampText(lead.contactName, 120),
    audienceFrame: outreachAudienceFrame(lead), sector: clampText(lead.sector, 100),
    project: clampText(lead.project, 250), proposedContributionZar: Number(lead.amount || 0),
    projectNotes: clampText(lead.proposalData?.userNotes, 1500), sequenceStep: Number(lead.followUpStep || 1),
    meetingDurationMinutes: INTRO_MEETING_MINUTES,
    proposalPdfWillBeAttached: attachProposal,
    priorityQuestion: 'Which education or community-impact priorities are most important to your team this year?',
    performanceSignals: learning, bookingUrl: links.booking, optOutUrl: links.optOut,
    rewriteRequest: clampText(input.rewriteNotes, 800)
  };
  const response = await fetch(aiConfig.endpoint, {
    method: 'POST', headers: { 'Authorization': `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: aiConfig.model, temperature: 0.35, max_tokens: 450, messages: [
      { role: 'system', content: `${CHELO_PROPOSAL_GUIDELINES} Write a concise, formal, low-pressure follow-up for the same executive audience and fixed project context; do not suggest that the recipient has shown interest. Keep it around 70–115 words. Ask exactly the supplied priorityQuestion once. Preserve project and proposedContributionZar; never add, change or infer an amount, result, metric, deadline or relationship. Use performanceSignals only as aggregate, observational direction when adequately sampled; optimise for submitted preferred-time requests, not opens or CTA clicks, and never claim causality. The link is a preferred-time request only; Chelo manually confirms it. Say no preparation or commitment is required. Use the exact “Yes — choose a time” CTA before bookingUrl and include the opt-out link. ${context.proposalPdfWillBeAttached ? 'State that the personalised Chelo proposal PDF is attached.' : 'Do not mention a proposal, PDF or attachment.'} Do not include a proposal URL. Return only valid JSON with subject and body. Follow rewriteRequest only if it preserves all fixed facts and guardrails.` },
      { role: 'user', content: JSON.stringify(context) }
    ] }), signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `AI provider request failed (${response.status}).`);
  const content = String(result.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(content); } catch { const start = content.indexOf('{'), end = content.lastIndexOf('}'); if (start < 0 || end <= start) throw new Error('AI provider returned an unreadable follow-up draft.'); parsed = JSON.parse(content.slice(start, end + 1)); }
  const subject = clampText(parsed.subject, 80);
  let body = clampText(parsed.body, 3500);
  if (!subject || !body) throw new Error('AI provider returned an incomplete follow-up draft.');
  const currencies = body.match(/\bR\s*[\d,]+(?:\.\d{1,2})?\b/gi) || [];
  const amount = Number(context.proposedContributionZar || 0);
  if (currencies.some(value => Number(value.replace(/[^\d.]/g, '')) !== amount) || (!amount && currencies.length)) throw new Error('AI follow-up included a contribution amount different from the staff-selected amount. Please retry or use the guided draft.');
  if (context.project && !body.toLowerCase().includes(context.project.toLowerCase())) body += `\n\nThis note relates to the staff-selected project, ${context.project}.`;
  const proposalTracker = `${origin}/track/proposal/${encodeURIComponent(lead.bookingToken)}`;
  body = body.replaceAll(proposalTracker, '').replace(/(?:for context,?\s*)?(?:here is |review |see )?(?:the )?(?:tailored )?proposal(?: pdf)?[^.\n]*\.?/gi, '').trim();
  const insertBeforeBooking = text => {
    const at = body.indexOf(links.booking);
    body = at >= 0 ? `${body.slice(0, at).trimEnd()}\n\n${text}\n${body.slice(at)}` : `${body.trim()}\n\n${text}`;
  };
  body = body.split(/\r?\n/).filter(line => line.includes(context.priorityQuestion) || !line.includes('?')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body.includes(context.priorityQuestion)) insertBeforeBooking(context.priorityQuestion);
  if (!/yes\s*[—-]\s*choose/i.test(body) || !body.includes(links.booking)) body += `\n\nYes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${links.booking}`;
  if (!/chelo.{0,100}confirm/i.test(body)) insertBeforeBooking('Chelo will review your preferred time and confirm it personally.');
  if (!/no preparation/i.test(body) || !/no commitment/i.test(body)) insertBeforeBooking('No preparation is needed, and there is no commitment to proceed.');
  if (!/video/i.test(body)) insertBeforeBooking(`This is a ${INTRO_MEETING_MINUTES}-minute introductory video briefing.`);
  if (context.proposalPdfWillBeAttached && !/proposal.{0,40}attached|attached.{0,40}proposal/i.test(body)) insertBeforeBooking('The personalised Chelo proposal PDF is attached for context.');
  if (!body.includes(links.optOut)) body += `\n\nIf you prefer not to receive further outreach, opt out here: ${links.optOut}`;
  body = ensurePrimaryBookingCta(body, links);
  body = cleanApprovedEmailBody({ subject, body }, context.proposalPdfWillBeAttached);
  return { draft: { subject, body }, mode: 'openai', message: `Follow-up drafted with ${aiConfig.model} using aggregate outcome signals where available. Review and approve before sharing.` };
}
async function generateOutreachEmail(lead, input, origin) {
  const fallback = makeOutreachEmail(lead, origin);
  const aiConfig = configStore.getAIConfig();
  if (!aiConfig.apiKey) return { draft: fallback, mode: 'guided-preview', message: 'AI provider is not configured. This email uses a local guided template.' };
  const links = outreachLinks(lead, origin);
  const learning = outreachLearningSignals();
  const context = {
    company: clampText(lead.company, 150), contactName: clampText(lead.contactName, 120),
    sector: clampText(lead.sector, 100), audienceFrame: outreachAudienceFrame(lead), project: clampText(input.project || lead.project, 250),
    proposedContributionZar: Number(input.amount ?? lead.amount ?? 0), userNotes: clampText(input.userNotes, 2000), rewriteRequest: clampText(input.rewriteNotes, 1000),
    meetingDurationMinutes: INTRO_MEETING_MINUTES,
    priorityQuestion: 'Which education or community-impact priorities are most important to your team this year?',
    successDefinition: 'A preferred-time request submitted on Chelo’s form; it is not a confirmed appointment.',
    performanceSignals: learning,
    approvedFunderResearch: approvedResearchContext(lead),
    bookingUrl: links.booking, optOutUrl: links.optOut
  };
  const model = aiConfig.model;
  const response = await fetch(aiConfig.endpoint, {
    method: 'POST', headers: { 'Authorization': `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.45, max_tokens: 650, messages: [
      { role: 'system', content: `${CHELO_PROPOSAL_GUIDELINES} Write a concise, formal, executive-friendly first-touch email for the audienceFrame supplied. Address both corporate CSI/ESG leaders and corporate foundations in neutral, accurate language. Lead with one relevant, supplied reason; make the mutual benefit clear without impact-washing. Target 110–150 words before URLs and signature. Prefer a specific, natural subject around 36–50 characters when it fits; this is a starting heuristic, not a universal rule, and do not pad or use clickbait. Ask exactly one question: use the supplied priorityQuestion verbatim. Invite a ${INTRO_MEETING_MINUTES}-minute no-preparation, no-commitment introductory video briefing. The link is only a request for a preferred time; Chelo must manually confirm it. Success is a submitted preferred-time request, not a CTA click, open or confirmed booking. Use performanceSignals only as weak, aggregate, observational guidance when the sample is sufficient; optimize for preferred-time requests, never estimated opens, and do not imply causality. When the sample is small or has no clear pattern, use the stable concise default. Project and proposedContributionZar are fixed staff-selected inputs: do not select, change, infer, omit or recommend another project or amount. Treat the ask as exploratory and subject to validation. Use only supplied facts; invent no outcomes, metrics, eligibility, deadlines or relationships. Return only valid JSON with subject and body. Follow rewriteRequest only where consistent with the facts and fixed context. Include bookingUrl and optOutUrl exactly as supplied, with one primary CTA. This is a text-only first-touch email: do not mention a proposal, PDF or attachment and do not include a proposal URL. Use the exact CTA “Yes — choose a time” before bookingUrl. If approvedFunderResearch is present it contains staff-approved, publicly sourced organisational facts about the funder: use at most one or two of them to show genuine alignment between the funder's stated priorities and Chelo's verified-project model, paraphrased in a respectful, non-flattering tone; never quote figures that are not in citedFunderFacts and never imply inside knowledge. If it is absent, do not speculate about the funder's priorities.` },
      { role: 'user', content: JSON.stringify(context) }
    ] }), signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `AI provider request failed (${response.status}).`);
  const content = String(result.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(content); } catch { const start = content.indexOf('{'), end = content.lastIndexOf('}'); if (start < 0 || end <= start) throw new Error('AI provider returned an unreadable email draft.'); parsed = JSON.parse(content.slice(start, end + 1)); }
  const subject = clampText(parsed.subject, 80);
  let body = clampText(parsed.body, 4000);
  if (!subject || !body) throw new Error('AI provider returned an incomplete email draft.');
  const amount = Number(context.proposedContributionZar || 0);
  const currencies = body.match(/\bR\s*[\d,]+(?:\.\d{1,2})?\b/gi) || [];
  if (currencies.some(value => Number(value.replace(/[^\d.]/g, '')) !== amount) || (!amount && currencies.length)) throw new Error('AI draft included a contribution amount different from the staff-selected amount. Please retry or use the local draft.');
  const exactAmount = amount ? `R ${amount.toLocaleString('en-ZA')}` : '';
  if (!body.toLowerCase().includes(String(context.project).toLowerCase()) || (exactAmount && !body.includes(exactAmount))) body += `\n\nOne possible focus is ${context.project}${exactAmount ? `, with a potential contribution of ${exactAmount}` : ''}. The scope and contribution would be confirmed together before any commitment.`;
  const proposalTracker = `${origin}/track/proposal/${encodeURIComponent(lead.bookingToken)}`;
  body = body.replaceAll(proposalTracker, '').replace(/(?:for context,?\s*)?(?:here is |review |see )?(?:the )?(?:tailored )?proposal(?: pdf)?[^.\n]*\.?/gi, '').trim();
  const insertBeforeBooking = text => {
    const at = body.indexOf(links.booking);
    body = at >= 0 ? `${body.slice(0, at).trimEnd()}\n\n${text}\n${body.slice(at)}` : `${body.trim()}\n\n${text}`;
  };
  body = body.split(/\r?\n/).filter(line => line.includes(context.priorityQuestion) || !line.includes('?')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body.includes(context.priorityQuestion)) insertBeforeBooking(context.priorityQuestion);
  if (!new RegExp(`${INTRO_MEETING_MINUTES}[- ]minute`, 'i').test(body)) insertBeforeBooking(`A ${INTRO_MEETING_MINUTES}-minute introductory video briefing is available to explore fit.`);
  if (!/video/i.test(body)) insertBeforeBooking('The invitation is for a short introductory video conversation.');
  if (!/no preparation/i.test(body) || !/no commitment/i.test(body)) insertBeforeBooking('No preparation is needed, and there is no commitment to proceed.');
  if (!/yes\s*[—-]\s*choose/i.test(body) || !body.includes(links.booking)) body += `\n\nYes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${links.booking}\nChelo will review your preferred time and confirm it personally.`;
  if (!/chelo.{0,80}confirm/i.test(body)) insertBeforeBooking('Chelo will review your preferred time and confirm it personally.');
  if (!body.includes(links.optOut)) body += `\n\nIf you prefer not to receive further outreach, opt out here: ${links.optOut}`;
  body = ensurePrimaryBookingCta(body, links);
  body = cleanApprovedEmailBody({ subject, body }, false);
  return { draft: { subject, body }, mode: 'openai', message: `Email draft generated with ${model}. Performance signals were aggregate and directional; review every claim and approve before sharing.` };
}

const CHELO_PROPOSAL_GUIDELINES = `Chelo is a South African project-management and funding platform for businesses and philanthropists. Its public positioning emphasizes verified schools, NGOs and community projects, traceable funding, accountability, and project progress/impact reporting. Keep education and community benefit central. Show authentic mission alignment and a clear mutual benefit for both corporate CSI/ESG leaders and corporate foundations; use measurable outcomes only when supplied with a verified source, and distinguish activity from impact. Prefer local relevance, right-sized next steps and credible stewardship over grand claims. Use only the confirmed Chelo context and the user's project notes. Never invent beneficiary counts, project outcomes, donor commitments, budget line items, partner names, certifications, ESG claims or tax benefits. Phrase unconfirmed impact and contribution details as proposals to validate. Keep the writing warm, clear, specific and suitable for an executive audience.`;
function clipProposalText(value, max) {
  const text = clampText(value, max + 120);
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const boundary = head.lastIndexOf(' ');
  return `${(boundary > max * 0.65 ? head.slice(0, boundary) : head).trim()}...`;
}
function localProposalDraft(lead, input) {
  const company = clampText(input.company || lead.company, 150);
  const project = clampText(input.project || lead.project || 'an education impact project', 200);
  const amount = Number(input.amount ?? lead.amount ?? 0);
  const sector = clampText(lead.sector || 'community investment', 80);
  const notes = clampText(input.userNotes, 1800);
  const rewriteNotes = clampText(input.rewriteNotes, 800);
  const contribution = amount ? ` with a proposed contribution of R ${amount.toLocaleString('en-ZA')}` : '';
  const opening = `We invite ${company} to explore a partnership with Chelo${contribution}, focused on ${project}.`;
  const impact = notes
    ? `This draft reflects the project context provided by Chelo: ${notes} The final scope, beneficiaries, milestones and delivery plan should be confirmed with the verified recipient before approval.`
    : `A potential partnership could support ${project}. The project scope, intended beneficiaries, milestones and delivery plan should be confirmed with the verified recipient before approval.`;
  const researchPoint = input.approvedFunderResearch?.alignmentWithChelo?.[0]?.point || '';
  const rationale = researchPoint
    ? `${researchPoint} Chelo's approach emphasizes traceable funding, accountability and project progress reporting for verified schools, NGOs and community projects.`
    : `Chelo connects businesses and philanthropic partners with verified schools, NGOs and community projects. Its approach emphasizes traceable funding, accountability and project progress reporting, which may align with ${company}'s work in ${sector}.`;
  let nextStep = `Agree a briefing to validate the project need, contribution range, delivery timing and reporting expectations before a formal commitment.`;
  let finalOpening = opening;
  let finalImpact = impact;
  if (rewriteNotes) {
    const low = rewriteNotes.toLowerCase();
    if (/shorter|concise|brief|cut down/.test(low)) {
      finalOpening = `Explore a Chelo partnership supporting ${project}${contribution}.`;
      finalImpact = `Confirm project scope, intended beneficiaries and milestones with the verified recipient before approval. ${notes ? `Context supplied: ${notes}` : ''}`.trim();
      nextStep = `Use a briefing to confirm scope, contribution, timing and reporting.`;
    }
    if (/emphas|highlight|focus on/.test(low)) {
      const instruction = rewriteNotes.replace(/^(please\s+)?(emphasise|emphasize|highlight|focus on)\s*/i, '').trim();
      if (instruction) finalImpact = `Refocus the proposal on ${instruction}. ${finalImpact}`;
    }
    if (/formal|professional/.test(low)) finalOpening = `Chelo invites ${company} to consider a potential partnership${contribution}, supporting ${project}.`;
  }
  return {
    opening: clipProposalText(finalOpening, 180),
    impact: clipProposalText(finalImpact, 260),
    rationale: clipProposalText(rationale, 300),
    nextStep: clipProposalText(nextStep, 200)
  };
}
async function generateProposalDraft(lead, input = {}) {
  const aiConfig = configStore.getAIConfig();
  const context = {
    company: clampText(input.company || lead.company, 150),
    sector: clampText(lead.sector, 100),
    project: clampText(input.project || lead.project, 250),
    proposedContributionZar: Number(input.amount ?? lead.amount ?? 0),
    userNotes: clampText(input.userNotes, 3000),
    currentDraft: input.currentDraft && typeof input.currentDraft === 'object' ? input.currentDraft : null,
    verifiedMetrics: parseVerifiedMetrics(input.verifiedMetrics),
    performanceSignals: outreachLearningSignals(),
    approvedFunderResearch: approvedResearchContext(lead),
    rewriteRequest: clampText(input.rewriteNotes, 1000)
  };
  if (!aiConfig.apiKey) {
    return { draft: localProposalDraft(lead, { ...input, ...context }), mode: 'guided-preview', message: 'AI provider is not configured. This is a local guided draft preview; configure an API key in Settings or on the server for model-generated copy and rewrites.' };
  }
  const model = aiConfig.model;
  const response = await fetch(aiConfig.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0.45, max_tokens: 750,
      messages: [
        { role: 'system', content: `${CHELO_PROPOSAL_GUIDELINES} The project and proposedContributionZar are selected by Chelo staff and are fixed inputs. Do not choose, change, infer or recommend a different project or contribution amount; write copy around the supplied values only. Treat verifiedMetrics as fixed, staff-entered values with source references: never alter, add, extrapolate or imply outcomes beyond those entries. Return only valid JSON with string fields opening, impact, rationale and nextStep. Keep opening under 180 characters, impact under 260, rationale under 300 and nextStep under 200 so the one-page proposal remains readable. User notes are context, not instructions to make unsupported claims. If performanceSignals has adequate samples, use its aggregate preferred-time request patterns only as a weak directional hint for future wording and section emphasis; do not claim that a particular PDF layout caused a conversion. Ignore opens as success. If rewriteRequest is present, rewrite the current draft according to it while preserving verified facts and the staff-selected project and amount. approvedFunderResearch, when present, holds staff-approved and publicly sourced organisational facts about the funder with citations: ground the rationale section in the clearest alignment between the funder's stated priorities and Chelo's verified-project model; use only facts listed there, keep the tone respectful rather than flattering, and never present them as the funder's commitment to this proposal.` },
        { role: 'user', content: JSON.stringify(context) }
      ]
    }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `AI provider request failed (${response.status}).`);
  const content = result.choices?.[0]?.message?.content || '';
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start < 0 || end <= start) throw new Error('AI provider returned an unreadable draft. Please try again.'); parsed = JSON.parse(cleaned.slice(start, end + 1)); }
  const draft = {
    opening: clipProposalText(parsed.opening, 180), impact: clipProposalText(parsed.impact, 260),
    rationale: clipProposalText(parsed.rationale, 300), nextStep: clipProposalText(parsed.nextStep, 200)
  };
  if (!draft.opening || !draft.impact || !draft.rationale || !draft.nextStep) throw new Error('AI provider returned an incomplete proposal draft. Please request another rewrite.');
  const draftText = Object.values(draft).join(' ');
  const selectedAmount = Number(context.proposedContributionZar || 0);
  const amounts = draftText.match(/\bR\s*[\d,]+(?:\.\d{1,2})?\b/gi) || [];
  if (amounts.some(value => Number(value.replace(/[^\d.]/g, '')) !== selectedAmount) || (!selectedAmount && amounts.length)) throw new Error('AI draft included a contribution amount different from the staff-selected amount. Please retry or use the local draft.');
  if (context.project && !draftText.toLowerCase().includes(String(context.project).toLowerCase())) {
    draft.opening = clipProposalText(`${draft.opening} Project focus: ${context.project}.`, 180);
  }
  return { draft, mode: 'openai', message: `AI draft generated with ${model}. Staff-selected project/amount preserved; review every claim before sharing.` };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const data = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(data);
}
const SESSION_COOKIE = 'chelo_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
let setupInProgress = false;
function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part, ''] : [decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1))];
  }));
}
function sessionForRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  return store.getSession(token);
}
function csrfMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected)); const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookieHeader(req, token, maxAge) {
  const forwardedHttps = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const originHttps = /^https:\/\//i.test(String(req.headers.origin || req.headers.referer || ''));
  const secure = forwardedHttps || originHttps || Boolean(req.socket.encrypted);
  // Live previews may be embedded cross-site. Partitioned cookies keep the session usable there while CSRF tokens protect mutations.
  const sameSite = secure ? '; SameSite=None; Secure; Partitioned' : '; SameSite=Strict';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}${sameSite}`;
}
function createSession(req, user, res, options = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const demoAccess = Boolean(options.demoAccess);
  const account = typeof user === 'string' ? { username: user, displayName: user.split('@')[0], role: 'admin', id: '' } : user;
  store.putSession(token, { username: account.username, userId: account.id || '', displayName: account.displayName || account.username, role: account.role || 'admin', csrfToken, demoAccess, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', cookieHeader(req, token, Math.floor(SESSION_TTL_MS / 1000)));
  return { authenticated: true, setupRequired: false, username: account.username, displayName: account.displayName || account.username, role: account.role || 'admin', userId: account.id || '', csrfToken, demoAccess, approvalPolicy: configStore.getGovernanceConfig().approvalPolicy };
}
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}
function roleAllows(session, roles) {
  if (!session) return false;
  if (session.demoAccess) return true;
  return roles.includes(session.role || 'admin');
}
function safeOriginRequest(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return parsed.host === requestHost;
  } catch { return false; }
}
function authStatus(req) {
  const approvalPolicy = configStore.getGovernanceConfig().approvalPolicy;
  if (DEMO_OPEN_ACCESS) return { authenticated: true, setupRequired: false, username: 'demo@cheloapp.com', displayName: 'Demo Admin', role: 'admin', userId: 'demo', csrfToken: DEMO_OPEN_CSRF_TOKEN, demoAccess: true, openAccessDemo: true, demoAccessAvailable: false, approvalPolicy };
  const session = sessionForRequest(req);
  if (!session) return { authenticated: false, setupRequired: !configStore.hasAdmin(), demoAccessAvailable: DEMO_ADMIN_ACCESS };
  if (session.expiresAt - Date.now() < SESSION_TTL_MS - 5 * 60 * 1000) {
    store.putSession(session.token, { ...session, expiresAt: Date.now() + SESSION_TTL_MS });
  }
  return { authenticated: true, setupRequired: false, username: session.username, displayName: session.displayName, role: session.role, userId: session.userId, csrfToken: session.csrfToken, demoAccess: Boolean(session.demoAccess), demoAccessAvailable: DEMO_ADMIN_ACCESS, approvalPolicy };
}
function smtpTransporter() {
  const smtp = configStore.getSmtpConfig();
  if (!smtp.host || !smtp.fromEmail) throw new Error('Configure the SMTP host and sender email in Settings first.');
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    ...(smtp.username ? { auth: { user: smtp.username, pass: smtp.password } } : {}),
    requireTLS: !smtp.secure && (smtp.port === 587 || Boolean(smtp.username)),
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 25000,
    tls: { minVersion: 'TLSv1.2' }
  });
  return { smtp, transport };
}
function cleanApprovedEmailBody(draft, attachProposal = false) {
  const lines = String(draft?.body || '').split(/\r?\n/)
    .filter(line => !/\/track\/proposal\/|\/api\/public\/proposal\/|\/proposal\/[a-f0-9]{40,}/i.test(line)
      && !/^(?:A tailored proposal is ready to review:|For context, here is the tailored proposal:|Review the tailored proposal:)\s*$/i.test(line)
      && (attachProposal || !/(?:proposal|pdf).{0,60}(?:attach|enclos)|(?:attach|enclos).{0,60}(?:proposal|pdf)/i.test(line)));
  let body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (attachProposal && !/proposal.{0,40}attached|attached.{0,40}proposal/i.test(body)) body += '\n\nThe personalised Chelo proposal PDF is attached for context.';
  return body;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function emailHtml(body, pixelUrl = '') {
  const paragraphs = String(body || '').split(/\n{2,}/).map(paragraph => {
    const lines = paragraph.split('\n').map(line => {
      const cta = line.match(/yes\s*[—-]\s*choose\b[^\r\n]*?(https?:\/\/[^\s<]+)/i);
      if (cta) {
        let href = cta[1];
        while (/[),.;!?]$/.test(href)) href = href.slice(0, -1);
        return `<a href="${escapeHtml(href)}" role="button" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#5945e8;color:#ffffff;text-decoration:none;font-weight:700;line-height:1.2">Yes — choose a time</a><br><span style="display:inline-block;margin-top:6px;color:#55516f;font-size:12px">For your ${INTRO_MEETING_MINUTES}-minute introductory video chat</span>`;
      }
      const escaped = escapeHtml(line);
      return escaped.replace(/https?:\/\/[^\s<]+/g, raw => {
        let href = raw; let tail = '';
        while (/[),.;!?]$/.test(href)) { tail = href.slice(-1) + tail; href = href.slice(0, -1); }
        return `<a href="${href}" style="color:#5945e8">${href}</a>${tail}`;
      });
    }).join('<br>');
    return `<p style="margin:0 0 16px;line-height:1.6">${lines}</p>`;
  }).join('');
  const pixel = pixelUrl ? `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,sans-serif;font-size:14px;color:#24213f">${paragraphs}${pixel}</body></html>`;
}
function openTrackingUrl(token) {
  if (!configStore.publicSettings().openTrackingEnabled) return '';
  const publicUrl = configStore.getPublicBaseUrl();
  if (!publicUrl || !publicUrl.startsWith('https://') || !token) return '';
  return `${publicUrl}/track/open/${encodeURIComponent(token)}.gif`;
}
function recordSentMessage(lead, followUp, provider, openToken = null, providerMessageId = '', actor = 'staff') {
  const now = new Date().toISOString();
  const draft = followUp ? lead.followUpDraft : lead.emailDraft;
  if (!draft) throw new Error('Approved email draft is missing.');
  const step = followUp ? Number(lead.followUpStep || 1) : 0;
  const cleanBody = cleanApprovedEmailBody(draft, Boolean(followUp && draft.attachProposal && lead.proposalFile));
  const message = { id: id('message'), leadId: lead.id, kind: followUp ? 'follow-up' : 'initial', sequence: step, subject: draft.subject, body: cleanBody, copyProfile: emailCopyProfile({ subject: draft.subject, body: cleanBody }), sentAt: now, status: provider === 'SMTP' ? 'Sent' : 'Confirmed by staff', provider, openToken: openToken || null, ...(providerMessageId ? { providerMessageId: String(providerMessageId).slice(0, 250) } : {}) };
  db.messages.unshift(message);
  addEmailEvent(lead.id, followUp ? 'sent_follow_up' : 'sent_initial', message.id);
  if (followUp) {
    lead.followUpEmailStatus = provider === 'SMTP' ? 'Sent via SMTP' : 'Sent (confirmed by staff)';
    lead.emailStatus = `Sent (follow-up ${step}${provider === 'SMTP' ? ' via SMTP' : ' confirmed'})`;
    lead.lastContactedAt = now;
    if (step === 1) {
      lead.followUpStep = 2;
      lead.followUpAt = addBusinessDays(new Date(lead.firstSentAt || now), 10).toISOString();
      lead.nextAction = 'Review reply or send follow-up 2 of 2';
    } else {
      lead.followUpAt = null; lead.followUpStep = 0; lead.nextAction = 'Monitor for a reply';
    }
  } else {
    lead.emailStatus = provider === 'SMTP' ? 'Sent via SMTP' : 'Sent (confirmed by staff)';
    lead.lastContactedAt = now; lead.firstSentAt = now; lead.followUpStep = 1;
    lead.followUpAt = addBusinessDays(new Date(now), 5).toISOString();
    lead.nextAction = 'Review reply or send follow-up 1 of 2';
    if (['New', 'Researched'].includes(lead.stage)) lead.stage = 'Contacted';
  }
  if (draft.openToken) delete draft.openToken;
  lead.updatedAt = now;
  addActivity(`${followUp ? `Follow-up ${step}` : 'Outreach'} sent for ${lead.company} (${provider})`, 'email', actor);
  saveDb();
  return message;
}
function sendTransparentPixel(res) {
  const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': gif.length, 'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(gif);
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) { reject(new Error('Request is too large.')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}
function findLead(leadId) { return db.leads.find(x => x.id === leadId); }
function clientLead(lead) {
  const stripToken = draft => {
    if (!draft) return null;
    const { openToken, ...safeDraft } = draft;
    return safeDraft;
  };
  return { ...lead, emailDraft: stripToken(lead.emailDraft), followUpDraft: stripToken(lead.followUpDraft) };
}
function safeFilename(name) { return path.basename(String(name || '')); }
function mimeBase64(value) {
  const encoded = Buffer.from(value).toString('base64');
  return encoded.match(/.{1,76}/g)?.join('\r\n') || '';
}
function buildEmailEml(lead, draft, followUp, pixelUrl = '', pdfBuffer = null) {
  const to = String(lead.email || '').replace(/[\r\n<>]/g, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Add a valid recipient email before preparing the email draft.');
  const subject = String(draft.subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!subject || !draft.body) throw new Error('Approve an email draft before preparing the handoff.');
  const attachProposal = Boolean(pdfBuffer);
  const body = cleanApprovedEmailBody(draft, attachProposal).replace(/\n/g, '\r\n');
  const htmlBody = emailHtml(body, pixelUrl);
  const mixed = `=_Chelo_Mixed_${crypto.randomBytes(12).toString('hex')}`;
  const alternative = `=_Chelo_Alternative_${crypto.randomBytes(12).toString('hex')}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const alternativeParts = [
    `--${alternative}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', mimeBase64(body),
    `--${alternative}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', mimeBase64(htmlBody),
    `--${alternative}--`
  ];
  const parts = [
    `To: ${to}`, `Subject: ${encodedSubject}`, 'MIME-Version: 1.0', 'X-Unsent: 1',
    attachProposal ? `Content-Type: multipart/mixed; boundary="${mixed}"` : `Content-Type: multipart/alternative; boundary="${alternative}"`, ''
  ];
  if (attachProposal) {
    parts.push(
      `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, '', ...alternativeParts,
      `--${mixed}`, 'Content-Type: application/pdf; name="Chelo-Partnership-Proposal.pdf"',
      'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="Chelo-Partnership-Proposal.pdf"', '',
      mimeBase64(pdfBuffer), `--${mixed}--`, ''
    );
  } else {
    parts.push(...alternativeParts, '');
  }
  const eml = parts.join('\r\n');
  const downloadName = `${safeFilename(String(lead.company || 'Chelo').replace(/\s·\sDemo$/, '')).replace(/[^a-zA-Z0-9_-]/g, '-')}-Chelo-email${followUp ? '-follow-up' : ''}.eml`;
  return { eml, downloadName };
}
function sendPdf(res, file, downloadName, disposition = 'attachment') {
  if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Proposal PDF not found.' });
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Content-Disposition': `${disposition}; filename="${downloadName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=60' });
  res.end(buf);
}
function serveStatic(req, res, pathname) {
  let requested = pathname === '/' || pathname.startsWith('/book/') || pathname.startsWith('/opt-out/') ? '/index.html' : pathname;
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  requested = decodeURIComponent(requested.split('?')[0]);
  const filePath = path.resolve(PUBLIC_DIR, '.' + requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, body) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, html) => {
        if (fallbackErr) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ['.html', '.css', '.js', '.csv'].includes(ext) ? 'no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  });
}

async function sendBriefingConfirmation(booking, actor = 'staff') {
  const lead = findLead(booking.leadId);
  const smtp = configStore.getSmtpConfig();
  const organizerEmail = smtp.fromEmail || 'partnerships@cheloapp.com';
  let ics;
  try {
    ics = calendar.buildBriefingIcs(booking, { method: 'REQUEST', project: lead?.project, organizerEmail, organizerName: smtp.fromName });
  } catch (err) {
    return { ok: false, sent: false, error: err.message };
  }
  const mail = calendar.buildBriefingConfirmationEmail(booking, { project: lead?.project, organizerName: smtp.fromName });
  if (!booking.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) return { ok: false, sent: false, error: 'Booking has no valid recipient email.' };
  if (!smtp.host || !smtp.fromEmail) {
    booking.confirmationStatus = 'Pending (SMTP not configured – download .ics and send manually)';
    configStore.recordAudit({ actor, action: 'briefing.invite_prepared', entityType: 'booking', entityId: booking.id, summary: `Calendar invite prepared for ${booking.organization}; SMTP not configured so staff must send manually` });
    return { ok: true, sent: false, message: 'SMTP is not configured. Download the .ics invite and send it from your mail client.', subject: mail.subject };
  }
  try {
    const { transport } = smtpTransporter();
    const info = await transport.sendMail({
      from: { name: smtp.fromName, address: smtp.fromEmail },
      to: { name: booking.contactName || booking.organization, address: booking.email },
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      icalEvent: { method: 'REQUEST', filename: 'chelo-briefing.ics', content: ics },
      attachments: [{ filename: 'chelo-briefing.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }]
    });
    booking.confirmationSentAt = new Date().toISOString();
    booking.confirmationStatus = 'Sent';
    booking.confirmationMessageId = info?.messageId || '';
    if (lead) addEmailEvent(lead.id, 'briefing_invite', null, 'smtp');
    addActivity(`Calendar invite sent to ${booking.organization}`, 'booking', actor);
    configStore.recordAudit({ actor, action: 'briefing.invite_sent', entityType: 'booking', entityId: booking.id, summary: `.ics invite + ${calendar.VIDEO_PLATFORMS[booking.videoPlatform]?.label || 'video'} link emailed to ${booking.organization} for ${booking.date} ${booking.time} SAST` });
    return { ok: true, sent: true, message: `Calendar invite emailed to ${booking.email}.`, subject: mail.subject };
  } catch (err) {
    booking.confirmationStatus = `Failed: ${String(err.message || err).slice(0, 120)}`;
    configStore.recordAudit({ actor, action: 'briefing.invite_failed', entityType: 'booking', entityId: booking.id, summary: `Calendar invite email failed for ${booking.organization}: ${String(err.message || err).slice(0, 120)}` });
    return { ok: false, sent: false, error: `Invite email failed: ${err.message}` };
  }
}
function computeAnalytics(days = 30) {
  const requestedDays = [7, 30, 90, 365, 0].includes(Number(days)) ? Number(days) : 30;
  const now = Date.now();
  const cutoff = requestedDays ? now - requestedDays * 86400000 : -Infinity;
  const inRange = value => { const time = Date.parse(value || ''); return Number.isFinite(time) && time >= cutoff && time <= now + 60000; };
  const messages = db.messages.filter(message => inRange(message.sentAt));
  const events = db.emailEvents.filter(event => inRange(event.occurredAt));
  const smtpSent = messages.filter(message => message.provider === 'SMTP' && message.status === 'Sent').length;
  const handoffs = messages.filter(message => message.provider === 'email-client handoff' && message.status === 'Confirmed by staff').length;
  const periodMessageIds = new Set(messages.map(message => message.id));
  const opens = new Set(events.filter(event => event.type === 'open' && event.messageId && periodMessageIds.has(event.messageId)).map(event => event.messageId));
  const tracked = messages.filter(message => message.openToken && (message.status === 'Sent' || message.status === 'Confirmed by staff')).length;
  const yesEvents = events.filter(event => event.type === 'click_cta');
  const bookings = events.filter(event => event.type === 'booking').length;
  const replies = events.filter(event => event.type === 'reply').length;
  const bounces = events.filter(event => event.type === 'bounce').length;
  const chartDays = requestedDays === 7 ? 7 : requestedDays === 30 ? 14 : 30;
  const chartStart = new Date(now - (chartDays - 1) * 86400000); chartStart.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = 0; i < chartDays; i++) {
    const day = new Date(chartStart); day.setDate(day.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    const next = new Date(day); next.setDate(next.getDate() + 1);
    const within = value => { const t = Date.parse(value || ''); return Number.isFinite(t) && t >= day.getTime() && t < next.getTime(); };
    const dailyMessages = messages.filter(m => within(m.sentAt));
    series.push({ date: key, sent: dailyMessages.length, smtpSent: dailyMessages.filter(m => m.provider === 'SMTP' && m.status === 'Sent').length, handoffs: dailyMessages.filter(m => m.provider === 'email-client handoff' && m.status === 'Confirmed by staff').length, opens: events.filter(e => e.type === 'open' && within(e.occurredAt)).length, clicks: yesEvents.filter(e => within(e.occurredAt)).length, briefingRequests: events.filter(e => e.type === 'booking' && within(e.occurredAt)).length });
  }
  return {
    days: requestedDays, sent: messages.length, smtpSent, manualHandoffs: handoffs,
    uniqueOpens: opens.size, trackedSends: tracked, openRate: tracked ? Math.round(opens.size / tracked * 1000) / 10 : null,
    yesClicks: yesEvents.length, uniqueYesClickers: new Set(yesEvents.map(event => event.leadId)).size,
    briefingRequests: bookings, replies, bounces, projectFunding: db.projects.map(p => ({ id: p.id, name: p.name, province: p.province, ...projectFunding(p) })), series, learning: outreachLearningSignals(), openTrackingEnabled: configStore.publicSettings().openTrackingEnabled
  };
}
async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  try {
    if (method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true, app: 'Chelo Partnerships Workspace', version: '0.2.0', storage: 'sqlite-wal', approvalPolicy: configStore.getGovernanceConfig().approvalPolicy });
    if (method === 'GET' && pathname === '/api/auth/status') return sendJson(res, 200, authStatus(req));
    if (method === 'POST' && pathname === '/api/auth/demo') {
      if (!DEMO_ADMIN_ACCESS) return sendJson(res, 404, { error: 'Demo admin access is disabled.' });
      if (!safeOriginRequest(req)) return sendJson(res, 403, { error: 'Demo access must be opened from this workspace origin.' });
      const session = createSession(req, { username: 'demo@cheloapp.com', displayName: 'Demo Admin', role: 'admin', id: 'demo' }, res, { demoAccess: true });
      configStore.recordAudit({ actor: 'demo@cheloapp.com', action: 'auth.demo_login', entityType: 'security', summary: 'Full demo administrator session started' });
      return sendJson(res, 200, session);
    }
    if (method === 'POST' && pathname === '/api/auth/setup') {
      if (!safeOriginRequest(req)) return sendJson(res, 403, { error: 'Setup must be completed from this workspace origin.' });
      if (sessionForRequest(req)?.demoAccess) return sendJson(res, 403, { error: 'Sign out of the demo session before creating a real administrator account.' });
      if (configStore.hasAdmin() || setupInProgress) return sendJson(res, 409, { error: 'Admin setup is already complete. Sign in instead.' });
      const body = await readBody(req);
      setupInProgress = true;
      try {
        const user = configStore.createUser({ username: body.username, displayName: body.displayName, role: 'admin', password: body.password });
        configStore.recordAudit({ actor: user.username, action: 'auth.setup', entityType: 'security', summary: 'Initial administrator account created' });
        return sendJson(res, 201, createSession(req, user, res));
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      } finally { setupInProgress = false; }
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
      if (!safeOriginRequest(req)) return sendJson(res, 403, { error: 'Sign-in must be completed from this workspace origin.' });
      const body = await readBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const limitKey = `${username || 'anon'}@@${clientIp(req)}`;
      const failure = store.getLoginFailure(limitKey);
      if (failure && failure.resetAt > Date.now() && failure.count >= 5) return sendJson(res, 429, { error: 'Too many sign-in attempts for this account. Wait 15 minutes and try again.' });
      const user = configStore.authenticateUser(username, password);
      if (!user) {
        store.recordLoginFailure(limitKey);
        configStore.recordAudit({ actor: 'unknown', action: 'auth.login.failed', entityType: 'security', summary: 'Failed staff sign-in attempt' });
        return sendJson(res, 401, { error: 'Email or password is incorrect.' });
      }
      store.clearLoginFailure(limitKey);
      configStore.recordAudit({ actor: user.username, action: 'auth.login', entityType: 'security', summary: `${user.displayName} signed in (${user.role})` });
      return sendJson(res, 200, createSession(req, user, res));
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const session = sessionForRequest(req);
      if (session && !csrfMatches(session.csrfToken, req.headers['x-csrf-token'])) return sendJson(res, 403, { error: 'Security token expired. Refresh and try again.' });
      if (session) { store.deleteSession(session.token); configStore.recordAudit({ actor: session.username, action: 'auth.logout', entityType: 'security', summary: 'Staff member signed out' }); }
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }
    // Inbound provider webhooks authenticate via HMAC signature instead of a staff session.
    if (method === 'POST' && pathname === '/api/inbound/webhook') {
      const raw = await readRawBody(req);
      const secret = configStore.getInboundConfig().webhookSecret;
      const signature = req.headers['x-chelo-signature'] || req.headers['x-signature'] || url.searchParams.get('signature');
      if (!inbound.verifyWebhookSignature(raw, signature, secret)) return sendJson(res, 401, { error: 'Invalid webhook signature.' });
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { return sendJson(res, 400, { error: 'Webhook body must be JSON.' }); }
      const events = Array.isArray(payload) ? payload : [payload];
      const results = events.slice(0, 100).map(evt => inbound.applyInboundSignal({ db, configStore, addEmailEvent, addActivity, saveDb, normalized: inbound.normalizeInboundEvent(evt), source: 'webhook' }));
      return sendJson(res, 200, { ok: true, processed: results.length, matched: results.filter(r => r.matched).length, results });
    }

    const publicApi = pathname.startsWith('/api/public/');
    if (!publicApi && !(method === 'GET' && pathname === '/api/health') && !pathname.startsWith('/api/auth/')) {
      if (DEMO_OPEN_ACCESS) {
        req.authSession = { username: 'demo@cheloapp.com', displayName: 'Demo Admin', role: 'admin', userId: 'demo', csrfToken: DEMO_OPEN_CSRF_TOKEN, demoAccess: true, openAccessDemo: true };
      } else {
        const session = sessionForRequest(req);
        if (!session) return sendJson(res, 401, { error: 'Sign in required.', authRequired: true });
        if (session.expiresAt - Date.now() < SESSION_TTL_MS - 5 * 60 * 1000) store.putSession(session.token, { ...session, expiresAt: Date.now() + SESSION_TTL_MS });
        req.authSession = session;
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !csrfMatches(req.authSession.csrfToken, req.headers['x-csrf-token'])) return sendJson(res, 403, { error: 'Security token expired. Refresh and try again.' });
      // Role gate: reviewers can read everything and approve, but cannot change workspace settings or staff; settings/staff are admin-only.
      const adminOnly = pathname.startsWith('/api/settings') || pathname.startsWith('/api/staff') || pathname === '/api/demo/clear' || pathname === '/api/inbound/imap-sync';
      if (adminOnly && !['GET'].includes(method) && !roleAllows(req.authSession, ['admin'])) return sendJson(res, 403, { error: 'Administrator role required for this action.' });
      if (pathname.startsWith('/api/staff') && !roleAllows(req.authSession, ['admin'])) return sendJson(res, 403, { error: 'Administrator role required.' });
      if (req.authSession.role === 'reviewer' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !/\/(approve-email|return-draft)$/.test(pathname) && pathname !== '/api/copilot/extract') {
        return sendJson(res, 403, { error: 'Reviewer accounts can approve or return drafts but cannot edit pipeline records.' });
      }
    }
    const actorName = () => req.authSession ? `${req.authSession.displayName || req.authSession.username} <${req.authSession.username}>` : 'staff';

    // ---- Verified Projects Catalog ----
    if (method === 'GET' && pathname === '/api/projects') return sendJson(res, 200, db.projects.map(clientProject));
    if (method === 'POST' && pathname === '/api/projects') {
      const body = await readBody(req);
      const project = safeProject(body);
      project.id = id('proj');
      project.createdAt = project.updatedAt = new Date().toISOString();
      db.projects.push(project);
      saveDb();
      configStore.recordAudit({ actor: actorName(), action: 'project.created', entityType: 'project', entityId: project.id, summary: `Verified project added: ${project.name}` });
      return sendJson(res, 201, clientProject(project));
    }
    if (method === 'POST' && pathname === '/api/projects/import') {
      const body = await readBody(req);
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
      let created = 0, updated = 0; const errors = [];
      rows.forEach((row, index) => {
        try {
          const project = safeProject(row);
          const existing = db.projects.find(p => normCompany(p.name) === normCompany(project.name));
          if (existing) { Object.assign(existing, project, { id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }); updated += 1; }
          else { project.id = id('proj'); project.createdAt = project.updatedAt = new Date().toISOString(); db.projects.push(project); created += 1; }
        } catch (err) { errors.push({ row: index + 1, error: err.message }); }
      });
      saveDb();
      configStore.recordAudit({ actor: actorName(), action: 'project.imported', entityType: 'project', summary: `Project CSV import: ${created} created, ${updated} updated, ${errors.length} rejected` });
      return sendJson(res, 200, { created, updated, errors, projects: db.projects.map(clientProject) });
    }
    const projectRoute = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectRoute) {
      const project = db.projects.find(p => p.id === projectRoute[1]);
      if (!project) return sendJson(res, 404, { error: 'Project not found.' });
      if (method === 'PUT') {
        const body = await readBody(req);
        Object.assign(project, safeProject({ ...project, ...body }), { id: project.id, createdAt: project.createdAt, updatedAt: new Date().toISOString() });
        for (const lead of db.leads) if (lead.projectId === project.id) lead.project = project.name;
        saveDb();
        configStore.recordAudit({ actor: actorName(), action: 'project.updated', entityType: 'project', entityId: project.id, summary: `Verified project updated: ${project.name}` });
        return sendJson(res, 200, clientProject(project));
      }
      if (method === 'DELETE') {
        const linked = db.leads.filter(l => l.projectId === project.id).length + db.partners.filter(p => p.projectId === project.id).length;
        if (linked) return sendJson(res, 409, { error: `${linked} prospect/partner record(s) reference this project. Re-link them first.` });
        db.projects = db.projects.filter(p => p.id !== project.id);
        saveDb();
        configStore.recordAudit({ actor: actorName(), action: 'project.deleted', entityType: 'project', entityId: project.id, summary: `Verified project removed: ${project.name}` });
        return sendJson(res, 200, { ok: true });
      }
    }

    // ---- Staff accounts & governance ----
    if (method === 'GET' && pathname === '/api/staff') return sendJson(res, 200, { users: configStore.listUsers(), approvalPolicy: configStore.getGovernanceConfig().approvalPolicy });
    if (method === 'POST' && pathname === '/api/staff') {
      const body = await readBody(req);
      const user = configStore.createUser({ username: body.username, displayName: body.displayName, role: body.role, password: body.password });
      configStore.recordAudit({ actor: actorName(), action: 'staff.created', entityType: 'user', entityId: user.id, summary: `Staff account created for ${user.displayName} (${user.role})` });
      return sendJson(res, 201, user);
    }
    const staffRoute = pathname.match(/^\/api\/staff\/([^/]+)$/);
    if (staffRoute && method === 'PUT') {
      const body = await readBody(req);
      const user = configStore.updateUser(staffRoute[1], body);
      if (body.active === false || body.password) store.deleteSessionsForUser(user.username);
      configStore.recordAudit({ actor: actorName(), action: 'staff.updated', entityType: 'user', entityId: user.id, summary: `Staff account updated: ${user.displayName} (${user.role}${user.active ? '' : ', deactivated'})` });
      return sendJson(res, 200, user);
    }
    if (method === 'GET' && pathname === '/api/audit/verify') return sendJson(res, 200, configStore.verifyAuditChain());
    if (method === 'POST' && pathname === '/api/demo/clear') {
      const result = store.clearDemoRecords();
      configStore.recordAudit({ actor: actorName(), action: 'workspace.demo_cleared', entityType: 'workspace', summary: `Demo records cleared: ${result.removedLeads} prospects, ${result.removedCandidates} candidates, ${result.removedPartners} partners, ${result.removedBookings} briefings` });
      return sendJson(res, 200, result);
    }

    // ---- POPIA Paste-to-Extract copilot & Grant-Cycle Radar ----
    if (method === 'POST' && pathname === '/api/copilot/extract') {
      const body = await readBody(req);
      const result = await popia.extractDonorIntelligence(body.text, configStore.getAIConfig(), db.projects);
      configStore.recordAudit({ actor: actorName(), action: 'copilot.extracted', entityType: 'research', summary: `Paste-to-Extract run (${result.mode}); ${result.redactions.total} identifier(s) scrubbed before processing` });
      return sendJson(res, 200, result);
    }
    if (method === 'GET' && pathname === '/api/radar') {
      const now = new Date();
      const items = [...db.leads.map(l => ({ kind: 'prospect', id: l.id, company: l.company, owner: l.owner, stage: l.stage, project: l.project, amount: l.amount, cycle: popia.computeGrantCycleStatus(l, now) })), ...db.candidates.filter(c => !c.promotedLeadId).map(c => ({ kind: 'candidate', id: c.id, company: c.company, owner: c.owner, stage: c.status, project: c.project, amount: c.amount, cycle: popia.computeGrantCycleStatus(c, now) }))]
        .filter(item => item.cycle.code !== 'none');
      const order = { 'closing-soon': 0, open: 1, upcoming: 2, scheduled: 3, passed: 4 };
      items.sort((a, b) => (order[a.cycle.code] ?? 9) - (order[b.cycle.code] ?? 9));
      return sendJson(res, 200, { generatedAt: now.toISOString(), items, followUps: inbound.buildFollowUpDigest(db.leads, now) });
    }
    if (method === 'GET' && pathname === '/api/followups/digest') return sendJson(res, 200, inbound.buildFollowUpDigest(db.leads));
    if (method === 'POST' && pathname === '/api/inbound/imap-sync') {
      const result = await inbound.checkImapInbox({ host: configStore.getInboundConfig().imapHost, port: configStore.getInboundConfig().imapPort, username: configStore.getInboundConfig().imapUsername, password: configStore.getInboundConfig().imapPassword });
      const applied = result.signals.map(sig => inbound.applyInboundSignal({ db, configStore, addEmailEvent, addActivity, saveDb, normalized: { ...sig, providerMessageId: '' }, source: 'imap' }));
      configStore.recordAudit({ actor: actorName(), action: 'inbound.imap_synced', entityType: 'integration', summary: `IMAP sync checked ${result.checked} message(s); ${applied.filter(a => a.matched).length} matched prospects` });
      return sendJson(res, 200, { ok: true, checked: result.checked, matched: applied.filter(a => a.matched).length, results: applied });
    }
    if (method === 'GET' && pathname === '/api/inbound/webhook-info') {
      return sendJson(res, 200, { url: `${publicOrigin(req)}/api/inbound/webhook`, header: 'X-Chelo-Signature', algorithm: 'HMAC-SHA256 hex digest of raw JSON body', secret: roleAllows(req.authSession, ['admin']) ? configStore.getInboundConfig().webhookSecret : '' });
    }

    if (method === 'GET' && pathname === '/api/init') {
      const messages = db.messages.map(({ openToken, body, ...message }) => ({ ...message, openTracked: Boolean(openToken) }));
      const leads = db.leads.map(clientLead);
      const settings = configStore.publicSettings();
      return sendJson(res, 200, { leads, candidates: db.candidates, partners: db.partners, bookings: db.bookings, activities: db.activities, messages, emailEvents: db.emailEvents, projects: db.projects.map(clientProject), provinces: PROVINCES, videoPlatforms: Object.values(calendar.VIDEO_PLATFORMS), staff: roleAllows(req.authSession, ['admin']) ? configStore.listUsers() : [], currentUser: { username: req.authSession.username, displayName: req.authSession.displayName, role: req.authSession.role, userId: req.authSession.userId }, stages: STAGES, aiConfigured: settings.aiConfigured, aiModel: settings.aiModel, emailProviderConfigured: settings.smtpConfigured, settings });
    }
    if (method === 'GET' && pathname === '/api/leads') return sendJson(res, 200, db.leads.map(clientLead));
    if (method === 'GET' && pathname === '/api/candidates') return sendJson(res, 200, db.candidates);
    if (method === 'GET' && pathname === '/api/partners') return sendJson(res, 200, db.partners);
    if (method === 'GET' && pathname === '/api/bookings') return sendJson(res, 200, db.bookings);

    if (method === 'GET' && pathname === '/api/settings') return sendJson(res, 200, configStore.publicSettings());
    if (method === 'PUT' && pathname === '/api/settings') {
      const body = await readBody(req);
      const settings = configStore.saveSettings(body);
      configStore.recordAudit({ actor: actorName(), action: 'settings.updated', entityType: 'settings', summary: 'Workspace settings updated (AI, SMTP, tracking, governance, briefings or inbound); secret values omitted' });
      return sendJson(res, 200, settings);
    }
    if (method === 'POST' && pathname === '/api/settings/test-ai') {
      const ai = configStore.getAIConfig();
      if (!ai.apiKey) return sendJson(res, 400, { error: 'Add an AI API key in Settings before testing the connection.' });
      const response = await fetch(ai.endpoint, { method: 'POST', headers: { 'Authorization': `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: ai.model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK.' }] }), signal: AbortSignal.timeout(15000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || `AI provider returned HTTP ${response.status}.`);
      configStore.recordAudit({ actor: actorName(), action: 'settings.ai_tested', entityType: 'integration', summary: 'AI provider connection test succeeded' });
      return sendJson(res, 200, { ok: true, model: ai.model, message: 'AI provider connection succeeded.' });
    }
    if (method === 'POST' && pathname === '/api/settings/test-search') {
      const searchConfig = configStore.getSearchConfig();
      if (!searchConfig.apiKey || searchConfig.provider === 'none') return sendJson(res, 400, { error: 'Choose a search provider and add its API key before testing.' });
      const probe = createFunderResearch();
      const brief = await probe.researchFunder({ company: 'Chelo', website: '' }, { searchConfig: { ...searchConfig }, aiConfig: { apiKey: '' }, projects: [] }).catch(err => { throw new Error(`Search provider test failed: ${err.message}`); });
      configStore.recordAudit({ actor: actorName(), action: 'settings.search_tested', entityType: 'integration', summary: `Web-search provider (${searchConfig.provider}) connection test succeeded` });
      return sendJson(res, 200, { ok: true, provider: searchConfig.provider, message: `${searchConfig.provider} responded with ${brief.sources.length + brief.attempted.length} candidate source(s).` });
    }
    if (method === 'POST' && pathname === '/api/settings/test-smtp') {
      const { transport, smtp } = smtpTransporter();
      await transport.verify();
      configStore.recordAudit({ actor: actorName(), action: 'settings.smtp_tested', entityType: 'integration', summary: `SMTP connection verified for ${smtp.host}:${smtp.port}` });
      return sendJson(res, 200, { ok: true, host: smtp.host, port: smtp.port, message: 'SMTP connection verified. No email was sent.' });
    }
    if (method === 'GET' && pathname === '/api/audit') {
      const rows = configStore.getAuditLogs({ limit: url.searchParams.get('limit') || 300, action: url.searchParams.get('action') || '', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', query: url.searchParams.get('query') || '' });
      return sendJson(res, 200, { entries: rows, retentionDays: 365 });
    }
    if (method === 'GET' && pathname === '/api/audit/export.csv') {
      const rows = configStore.getAuditLogs({ limit: 50000, action: url.searchParams.get('action') || '', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', query: url.searchParams.get('query') || '' });
      const csv = ['timestamp,actor,action,entity type,entity id,summary', ...rows.map(row => [row.timestamp, row.actor, row.action, row.entityType, row.entityId, row.summary].map(csvCell).join(','))].join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="chelo-audit-log.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(csv);
    }
    if (method === 'GET' && pathname === '/api/analytics') return sendJson(res, 200, computeAnalytics(url.searchParams.get('days') || 30));
    if (method === 'GET' && pathname === '/api/analytics/export.csv') {
      const analytics = computeAnalytics(url.searchParams.get('days') || 30);
      const csv = ['date,emails sent,SMTP accepted,staff-confirmed handoffs,estimated opens,Yes CTA clicks,preferred-time requests', ...analytics.series.map(row => [row.date, row.sent, row.smtpSent, row.handoffs, row.opens, row.clicks, row.briefingRequests].map(csvCell).join(','))].join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="chelo-analytics.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(csv);
    }

    const publicOptOut = pathname.match(/^\/api\/public\/opt-out\/([^/]+)$/);
    if (publicOptOut && method === 'GET') {
      const lead = db.leads.find(l => l.bookingToken === publicOptOut[1]);
      if (!lead) return sendJson(res, 404, { error: 'This opt-out link is unavailable.' });
      return sendJson(res, 200, { company: lead.company, optedOut: Boolean(lead.doNotContact) });
    }
    if (publicOptOut && method === 'POST') {
      const lead = db.leads.find(l => l.bookingToken === publicOptOut[1]);
      if (!lead) return sendJson(res, 404, { error: 'This opt-out link is unavailable.' });
      lead.doNotContact = true;
      rememberSuppressedEmail(lead.email);
      lead.followUpAt = null; lead.followUpStep = 0;
      lead.emailStatus = 'Do not contact';
      lead.followUpEmailStatus = 'Do not contact';
      lead.updatedAt = new Date().toISOString();
      addActivity(`${lead.company} opted out of further outreach`, 'privacy', 'recipient');
      saveDb();
      return sendJson(res, 200, { ok: true, message: 'You will not receive further Chelo outreach at this address.' });
    }

    const publicBooking = pathname.match(/^\/api\/public\/booking\/([^/]+)$/);
    if (publicBooking && method === 'GET') {
      const lead = db.leads.find(l => l.bookingToken === publicBooking[1]);
      if (!lead || lead.doNotContact) return sendJson(res, 404, { error: 'This briefing link is unavailable.' });
      const displayCompany = String(lead.company || '').replace(/\s·\sDemo$/, '');
      return sendJson(res, 200, { company: displayCompany, organization: displayCompany, contactName: lead.contactName || '', email: lead.email || '', phone: lead.phone || '', project: lead.project || 'Education impact partnership', meetingDurationMinutes: INTRO_MEETING_MINUTES, timezone: 'Africa/Johannesburg (SAST, UTC+02:00)', videoPlatforms: Object.values(calendar.VIDEO_PLATFORMS).map(p => ({ id: p.id, label: p.label })), defaultPlatform: configStore.getBriefingsConfig().defaultPlatform, token: lead.bookingToken });
    }
    if (publicBooking && method === 'POST') {
      const lead = db.leads.find(l => l.bookingToken === publicBooking[1]);
      if (!lead || lead.doNotContact) return sendJson(res, 404, { error: 'This briefing link is unavailable.' });
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim();
      const phone = String(body.phone || '').trim();
      const date = String(body.date || '').trim();
      const time = String(body.time || '').trim();
      if (!name || !email || !date || !time) return sendJson(res, 400, { error: 'Please complete your name, work email, preferred date and time.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
      // Recipients pick times in South Africa Standard Time (UTC+02:00) regardless of the server's timezone.
      const dateValue = calendar.parseSastDateTime(date, time);
      if (!dateValue || dateValue < new Date()) return sendJson(res, 400, { error: 'Please choose a future date and time (South Africa Standard Time).' });
      const briefingPrefs = configStore.getBriefingsConfig();
      const requestedPlatform = calendar.normalizeVideoPlatform(String(body.videoPlatform || '').trim(), '') || briefingPrefs.defaultPlatform;
      const booking = {
        id: id('booking'), leadId: lead.id, contactName: name, email, phone,
        organization: String(body.organization || lead.company).trim(), date, time,
        timezone: 'Africa/Johannesburg',
        durationMinutes: INTRO_MEETING_MINUTES, meetingType: 'Introductory video briefing',
        videoPlatform: calendar.VIDEO_PLATFORMS[requestedPlatform] ? requestedPlatform : briefingPrefs.defaultPlatform,
        meetingUrl: '',
        status: 'Requested', note: String(body.note || '').trim().slice(0, 1000), createdAt: new Date().toISOString()
      };
      db.bookings.unshift(booking);
      lead.stage = 'Briefing requested';
      lead.nextAction = 'Confirm requested briefing';
      lead.followUpAt = null; lead.followUpStep = 0;
      lead.updatedAt = new Date().toISOString();
      // Attribute the preferred-time request to the initial campaign message, even if a follow-up prompted it.
      const sourceMessage = db.messages.find(message => message.leadId === lead.id && message.kind === 'initial' && message.sentAt && ['Sent', 'Confirmed by staff'].includes(message.status));
      addEmailEvent(lead.id, 'booking', sourceMessage?.id || null);
      addActivity(`Briefing requested by ${booking.organization}`, 'booking', 'recipient');
      saveDb();
      return sendJson(res, 201, { ok: true, bookingId: booking.id, message: `Your ${INTRO_MEETING_MINUTES}-minute introductory video briefing request has been received. The Chelo team will confirm the time.` });
    }

    const proposalShare = pathname.match(/^\/api\/public\/proposal\/([^/]+)$/);
    if (proposalShare && method === 'GET') {
      const lead = db.leads.find(l => l.proposalToken === proposalShare[1] && l.proposalFile);
      if (!lead) return sendJson(res, 404, { error: 'Proposal link not found.' });
      return sendPdf(res, path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile)), `${lead.company}-Chelo-proposal.pdf`, 'inline');
    }

    if (method === 'POST' && pathname === '/api/leads') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      if (email && isSuppressedEmail(email) && !body.doNotContact) return sendJson(res, 409, { error: 'This address is on the do-not-contact suppression list.' });
      const dates = verificationDateFields(body);
      if (!dates.ok) return sendJson(res, 400, { error: dates.issues.join(' ') });
      const contactCheck = await inspectContactRecord({ ...body, email });
      if (contactCheck.status === 'invalid') return sendJson(res, 400, { error: contactCheck.reason || 'Email validation failed; the invalid contact was not saved.' });
      const lead = safeLead({ ...body, ...dates, email }, contactCheck);
      if (lead.doNotContact) rememberSuppressedEmail(lead.email);
      db.leads.unshift(lead);
      addActivity(`New prospect added: ${lead.company}${contactCheck.status === 'ready' ? '' : ' · contact details need clarification'}`, 'lead', actorName());
      saveDb();
      return sendJson(res, 201, lead);
    }
    if (method === 'POST' && pathname === '/api/leads/import') {
      return sendJson(res, 409, { error: 'Bulk imports are held in Discover for individual human review. Import candidates via /api/candidates/import, then promote them one at a time.' });
    }
    if (method === 'POST' && pathname === '/api/candidates/import') {
      const body = await readBody(req);
      const rows = Array.isArray(body.candidates) ? body.candidates.slice(0, 500) : [];
      let imported = 0, invalidDeleted = 0, duplicates = 0, suppressed = 0, needsClarification = 0, retryRequired = 0, missingOrganisation = 0, needsCorrection = 0;
      const existingRecords = [
        ...db.leads.map(item => ({ ...item, recordType: 'pipeline' })),
        ...db.candidates.map(item => ({ ...item, recordType: 'Discover' }))
      ];
      const seenEmails = new Set(existingRecords.map(item => normalizeEmail(item.email)).filter(Boolean));
      const seenCompanies = new Set(existingRecords.map(item => normCompany(item.company)).filter(Boolean));
      const emailMatches = new Map(existingRecords.filter(item => normalizeEmail(item.email)).map(item => [normalizeEmail(item.email), { company: item.company, recordType: item.recordType }]));
      const companyMatches = new Map(existingRecords.filter(item => normCompany(item.company)).map(item => [normCompany(item.company), { company: item.company, recordType: item.recordType }]));
      const rowResults = await mapWithConcurrency(rows, 10, async (row, index) => {
        const requestedRow = Number(row?.csvRowNumber);
        const rowNumber = Number.isSafeInteger(requestedRow) && requestedRow >= 2 && requestedRow <= 1000000 ? requestedRow : index + 2;
        if (!row || typeof row !== 'object' || Array.isArray(row)) return { row: rowNumber, status: 'needs-correction', code: 'invalid-row', reason: 'CSV row is not a valid contact record.' };
        const rawEmail = normalizeEmail(row.email);
        const companyKey = normCompany(row.company);
        if (rawEmail && isSuppressedEmail(rawEmail)) return { row: rowNumber, status: 'suppressed', reason: 'This address is on the do-not-contact suppression list; it was not retained.' };
        if (rawEmail && !validateEmailSyntax(rawEmail).ok) return { row: rowNumber, status: 'deleted-invalid', reason: 'Email address format is invalid.' };
        if (!companyKey) return { row: rowNumber, status: 'needs-correction', code: 'missing-organisation', reason: 'Organisation name is missing; correct the CSV row before importing it.' };
        const verificationDates = verificationDateFields(row);
        if (!verificationDates.ok) return { row: rowNumber, status: 'needs-correction', code: 'invalid-verification-date', reason: verificationDates.issues.join(' ') };
        const emailDuplicate = Boolean(rawEmail && seenEmails.has(rawEmail));
        const companyDuplicate = seenCompanies.has(companyKey);
        if (emailDuplicate || companyDuplicate) {
          const duplicateType = emailDuplicate ? 'email' : 'organisation';
          const duplicateOf = emailDuplicate ? (emailMatches.get(rawEmail) || {}) : (companyMatches.get(companyKey) || {});
          const displayMatch = duplicateOf.company ? ` ${duplicateOf.company}` : '';
          const sourceMatch = duplicateOf.recordType === 'CSV row' ? ` in CSV row ${duplicateOf.row}` : duplicateOf.recordType ? ` in ${duplicateOf.recordType}` : '';
          return { row: rowNumber, status: 'duplicate', duplicateOn: duplicateType, duplicateOf: { company: duplicateOf.company || '', recordType: duplicateOf.recordType || '', row: duplicateOf.row || null }, reason: `A matching ${duplicateType}${displayMatch}${sourceMatch} already exists in the database or this CSV.` };
        }
        if (rawEmail) { seenEmails.add(rawEmail); emailMatches.set(rawEmail, { company: String(row.company || '').trim(), recordType: 'CSV row', row: rowNumber }); }
        seenCompanies.add(companyKey); companyMatches.set(companyKey, { company: String(row.company || '').trim(), recordType: 'CSV row', row: rowNumber });
        const check = await inspectContactRecord({ ...row, email: rawEmail });
        if (check.status === 'invalid') return { row: rowNumber, status: 'deleted-invalid', reason: check.reason };
        const candidate = safeCandidate({ ...row, ...verificationDates, email: rawEmail }, check);
        return { row: rowNumber, status: check.status === 'ready' ? 'ready' : check.status, reason: check.issues?.join('; ') || '', candidate };
      });
      for (const result of rowResults) {
        if (result.status === 'ready' || result.status === 'needs-clarification' || result.status === 'retry-required') {
          db.candidates.unshift(result.candidate); imported++;
          if (result.status === 'needs-clarification') needsClarification++;
          if (result.status === 'retry-required') retryRequired++;
        } else if (result.status === 'deleted-invalid') invalidDeleted++;
        else if (result.status === 'suppressed') suppressed++;
        else if (result.status === 'duplicate') duplicates++;
        else if (result.status === 'needs-correction') {
          needsCorrection++;
          if (result.code === 'missing-organisation') missingOrganisation++;
        }
      }
      addActivity(`${imported} discovery candidates checked on intake; ${invalidDeleted} invalid rows discarded, ${needsClarification} need clarification, ${retryRequired} need a DNS retry, ${needsCorrection} need CSV correction`, 'lead', actorName());
      configStore.recordAudit({ actor: actorName(), action: 'candidate.intake.checked', entityType: 'candidate_import', summary: `${imported} imported; ${invalidDeleted} invalid discarded; ${duplicates} duplicates; ${suppressed} suppressed; ${needsClarification} need clarification; ${retryRequired} DNS retries; ${needsCorrection} CSV corrections` });
      saveDb();
      const issues = rowResults.filter(result => result.status !== 'ready').map(({ row, status, reason, code, duplicateOn, duplicateOf }) => ({ row, status, reason, ...(code ? { code } : {}), ...(duplicateOn ? { duplicateOn } : {}), ...(duplicateOf ? { duplicateOf } : {}) }));
      return sendJson(res, 201, { imported, invalidDeleted, duplicates, suppressed, needsClarification, retryRequired, missingOrganisation, needsCorrection, issues, candidates: db.candidates });
    }
    const candidateRoute = pathname.match(/^\/api\/candidates\/([^/]+)(?:\/(.*))?$/);
    if (candidateRoute) {
      const candidate = db.candidates.find(c => c.id === candidateRoute[1]);
      if (!candidate) return sendJson(res, 404, { error: 'Discovery candidate not found.' });
      const subroute = candidateRoute[2] || '';
      if (method === 'PATCH' && !subroute) {
        const body = await readBody(req);
        const proposed = { ...candidate };
        for (const key of ['company', 'contactName', 'title', 'email', 'phone', 'sector', 'sourceUrl', 'sourceName', 'project', 'notes', 'owner', 'relationshipContext', 'partnerPriorities']) {
          if (body[key] !== undefined) {
            const value = key === 'email' ? normalizeEmail(body[key]) : String(body[key] || '').trim();
            proposed[key] = key === 'sourceUrl' ? clampText(value, 2000) : key === 'sourceName' ? clampText(value, 300) : key === 'relationshipContext' ? clampText(value, 800) : key === 'partnerPriorities' ? clampText(value, 1200) : key === 'notes' ? clampText(value, 2000) : value;
          }
        }
        const candidateDates = verificationDateFields({ ...proposed, ...body });
        if (!candidateDates.ok) return sendJson(res, 400, { error: candidateDates.issues.join(' ') });
        proposed.contactLastVerifiedAt = candidateDates.contactLastVerifiedAt;
        proposed.sourceLastVerifiedAt = candidateDates.sourceLastVerifiedAt;
        const changedIdentity = ['contactName', 'title', 'email', 'phone'].some(key => String(proposed[key] || '').trim() !== String(candidate[key] || '').trim());
        const changedSource = ['sourceName', 'sourceUrl'].some(key => String(proposed[key] || '').trim() !== String(candidate[key] || '').trim());
        if (changedIdentity && proposed.contactLastVerifiedAt === normalizeDateOnly(candidate.contactLastVerifiedAt)) proposed.contactLastVerifiedAt = '';
        if (changedSource && proposed.sourceLastVerifiedAt === normalizeDateOnly(candidate.sourceLastVerifiedAt)) proposed.sourceLastVerifiedAt = '';
        if (!proposed.company) return sendJson(res, 400, { error: 'Organisation name is required.' });
        if (proposed.email && isSuppressedEmail(proposed.email)) {
          db.candidates = db.candidates.filter(item => item.id !== candidate.id);
          configStore.recordAudit({ actor: actorName(), action: 'candidate.suppressed.removed', entityType: 'candidate', entityId: candidate.id, summary: 'Candidate removed because its address matches the do-not-contact suppression list' });
          saveDb();
          return sendJson(res, 200, { deleted: true, suppressed: true, message: 'This address is suppressed; candidate contact details were removed.' });
        }
        const check = await inspectContactRecord(proposed);
        if (check.status === 'invalid') {
          db.candidates = db.candidates.filter(item => item.id !== candidate.id);
          configStore.recordAudit({ actor: actorName(), action: 'candidate.invalid.removed', entityType: 'candidate', entityId: candidate.id, summary: 'Candidate contact data removed after a definitive email validation failure' });
          saveDb();
          return sendJson(res, 200, { deleted: true, message: 'The email syntax/domain check failed definitively; the candidate contact record was removed.' });
        }
        Object.assign(candidate, proposed, { contactCheck: check, updatedAt: new Date().toISOString() });
        configStore.recordAudit({ actor: actorName(), action: 'candidate.contact.updated', entityType: 'candidate', entityId: candidate.id, summary: `Candidate contact details updated; intake status ${check.status}` });
        saveDb();
        return sendJson(res, 200, { candidate, message: check.status === 'ready' ? 'Email domain checked; mailbox is not individually verified. Candidate is ready for staff review.' : `Candidate needs attention: ${(check.issues || []).join(', ') || check.status}.` });
      }
      if (method === 'POST' && subroute === 'check') {
        if (candidate.promotedLeadId) return sendJson(res, 409, { error: 'This candidate has already been promoted.' });
        if (candidate.email && isSuppressedEmail(candidate.email)) {
          db.candidates = db.candidates.filter(item => item.id !== candidate.id);
          configStore.recordAudit({ actor: actorName(), action: 'candidate.suppressed.removed', entityType: 'candidate', entityId: candidate.id, summary: 'Candidate removed because its address matches the do-not-contact suppression list' });
          saveDb();
          return sendJson(res, 200, { deleted: true, suppressed: true, message: 'This address is suppressed; candidate contact details were removed.' });
        }
        const check = await inspectContactRecord(candidate);
        if (check.status === 'invalid') {
          db.candidates = db.candidates.filter(item => item.id !== candidate.id);
          configStore.recordAudit({ actor: actorName(), action: 'candidate.invalid.removed', entityType: 'candidate', entityId: candidate.id, summary: 'Candidate contact data removed after a definitive email validation failure' });
          saveDb();
          return sendJson(res, 200, { deleted: true, message: 'The email syntax/domain check failed definitively; the candidate contact record was removed.' });
        }
        candidate.contactCheck = check;
        candidate.checkedAt = check.checkedAt;
        saveDb();
        return sendJson(res, 200, { candidate, message: check.status === 'ready' ? 'Email domain check passed; individual mailbox is not verified.' : `Check status: ${check.status}. ${(check.issues || []).join(', ')}` });
      }
      if (method === 'POST' && subroute === 'promote') {
        if (candidate.promotedLeadId) {
          const existing = findLead(candidate.promotedLeadId);
          return sendJson(res, 200, { candidate, lead: existing || null, alreadyAdded: true });
        }
        const email = normalizeEmail(candidate.email);
        if (email && isSuppressedEmail(email)) {
          db.candidates = db.candidates.filter(item => item.id !== candidate.id);
          configStore.recordAudit({ actor: actorName(), action: 'candidate.suppressed.removed', entityType: 'candidate', entityId: candidate.id, summary: 'Candidate removed because its address matches the do-not-contact suppression list' });
          saveDb();
          return sendJson(res, 200, { deleted: true, suppressed: true, error: 'This address is suppressed; the candidate was removed and cannot be promoted.' });
        }
        const companyKey = normCompany(candidate.company);
        const duplicate = db.leads.find(l => (email && normalizeEmail(l.email) === email) || normCompany(l.company) === companyKey);
        if (duplicate) {
          candidate.status = 'Already in pipeline'; candidate.promotedLeadId = duplicate.id;
          saveDb();
          return sendJson(res, 200, { candidate, lead: duplicate, alreadyAdded: true });
        }
        const check = await inspectContactRecord(candidate);
        if (check.status === 'invalid') {
          db.candidates = db.candidates.filter(item => item.id !== candidate.id);
          configStore.recordAudit({ actor: actorName(), action: 'candidate.invalid.removed', entityType: 'candidate', entityId: candidate.id, summary: 'Candidate contact data removed after a definitive email validation failure during promotion check' });
          saveDb();
          return sendJson(res, 200, { deleted: true, error: 'The email syntax/domain check failed definitively. The candidate record was removed.' });
        }
        candidate.contactCheck = check;
        if (check.status !== 'ready') {
          saveDb();
          return sendJson(res, 409, { error: `Complete intake checks before promotion. ${(check.issues || []).join(', ') || check.status}`, contactCheck: check });
        }
        const lead = safeLead(candidate, check);
        db.leads.unshift(lead);
        candidate.status = 'Added to pipeline'; candidate.promotedLeadId = lead.id; candidate.promotedAt = new Date().toISOString();
        addActivity(`${candidate.company} added to the pipeline`, 'lead', actorName());
        saveDb();
        return sendJson(res, 201, { candidate, lead, alreadyAdded: false });
      }
    }

    const leadRoute = pathname.match(/^\/api\/leads\/([^/]+)(?:\/(.*))?$/);
    if (leadRoute) {
      const lead = findLead(leadRoute[1]);
      const action = leadRoute[2] || '';
      if (!lead) return sendJson(res, 404, { error: 'Prospect not found.' });
      if (method === 'GET' && action === 'research') {
        return sendJson(res, 200, { brief: lead.research || null, stale: lead.research ? research.isStale(lead.research) : false, searchConfigured: configStore.publicSettings().searchConfigured });
      }
      if (method === 'POST' && action === 'research') {
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const body = await readBody(req);
        const website = String(body.website || lead.website || lead.sourceUrl || '').trim();
        const searchConfig = configStore.getSearchConfig();
        const aiConfig = configStore.getAIConfig();
        const brief = await research.researchFunder(
          { company: lead.company, website, sector: lead.sector },
          { searchConfig, aiConfig, projects: db.projects.map(p => ({ id: p.id, name: p.name, sector: p.sector, province: p.province })) }
        );
        brief.requestedBy = actorName();
        lead.research = brief;
        lead.updatedAt = new Date().toISOString();
        configStore.recordAudit({ actor: actorName(), action: 'research.gathered', entityType: 'lead', entityId: lead.id, summary: `Funder brief gathered for ${lead.company} via ${brief.provider} (${brief.mode}); ${brief.sources.length} source(s) read, ${brief.findings.length} finding(s), ${brief.redactions.total} identifier(s) scrubbed before processing` });
        addActivity(`Funder research brief gathered for ${lead.company} (awaiting review)`, 'research', actorName());
        saveDb();
        return sendJson(res, 201, { ok: true, brief, message: `Brief ready for review: ${brief.findings.length} cited finding(s) from ${brief.sources.length} source(s). Nothing is used until you approve it.` });
      }
      if (method === 'POST' && action === 'research/review') {
        const brief = lead.research;
        if (!brief) return sendJson(res, 404, { error: 'Run funder research first.' });
        const body = await readBody(req);
        const pick = (ids, items) => (Array.isArray(ids) ? ids : []).map(String).filter(id => items.some(item => item.id === id));
        brief.approvedFindingIds = pick(body.approvedFindingIds, brief.findings);
        brief.approvedAlignmentIds = pick(body.approvedAlignmentIds, brief.alignmentPoints);
        brief.approvedContactIds = pick(body.approvedContactIds, brief.contacts);
        if (body.missionSummary !== undefined) brief.missionSummary = clampText(popia.scrubPiiForAi(String(body.missionSummary || '')).scrubbedText, 240);
        brief.reviewNotes = clampText(body.reviewNotes, 600);
        brief.status = body.reject === true ? 'rejected' : 'approved';
        brief.reviewedAt = new Date().toISOString();
        brief.reviewedBy = actorName();
        if (brief.status === 'approved' && body.applySuggestedProject === true && brief.suggestedProjectId && !lead.projectId) {
          const project = db.projects.find(p => p.id === brief.suggestedProjectId);
          if (project) updateLead(lead, { projectId: project.id }, actorName());
        }
        lead.updatedAt = new Date().toISOString();
        configStore.recordAudit({ actor: actorName(), action: brief.status === 'approved' ? 'research.approved' : 'research.rejected', entityType: 'lead', entityId: lead.id, summary: `Funder brief ${brief.status} for ${lead.company}: ${brief.approvedFindingIds.length} finding(s), ${brief.approvedAlignmentIds.length} alignment point(s), ${brief.approvedContactIds.length} public contact(s) approved` });
        addActivity(`Funder research brief ${brief.status} for ${lead.company}`, 'research', actorName());
        saveDb();
        return sendJson(res, 200, { ok: true, brief, lead: clientLead(lead) });
      }
      if (method === 'DELETE' && action === 'research') {
        if (!lead.research) return sendJson(res, 404, { error: 'No research brief to remove.' });
        lead.research = null;
        lead.updatedAt = new Date().toISOString();
        configStore.recordAudit({ actor: actorName(), action: 'research.cleared', entityType: 'lead', entityId: lead.id, summary: `Funder brief removed for ${lead.company}` });
        saveDb();
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'POST' && action === 'contact-check') {
        if (lead.doNotContact || isSuppressedEmail(lead.email)) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact suppression list.' });
        const result = await requireContactReady(lead);
        configStore.recordAudit({ actor: actorName(), action: 'contact.intake.checked', entityType: 'lead', entityId: lead.id, summary: `Contact intake status: ${result.contactCheck?.status || 'suppressed'}` });
        saveDb();
        return sendJson(res, 200, { ready: result.ok, contactCheck: result.contactCheck, message: result.error || 'Email domain check passed; individual mailbox is not verified.' });
      }
      if (method === 'POST' && action === 'outreach/generate') {
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const body = await readBody(req);
        updateLead(lead, { project: String(body.project || lead.project), amount: Number(body.amount ?? lead.amount ?? 0), contactName: String(body.contactName || lead.contactName) }, actorName());
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        const draftingInput = { ...body, userNotes: clampText(body.userNotes, 3000), rewriteNotes: clampText(body.rewriteNotes, 1000) };
        const emailResult = await generateOutreachEmail(lead, draftingInput, publicOrigin(req));
        lead.proposalData = {
          ...(lead.proposalData || {}), company: lead.company, contactName: lead.contactName,
          project: lead.project, amount: Number(lead.amount || 0), userNotes: draftingInput.userNotes,
          rewriteNotes: draftingInput.rewriteNotes
        };
        lead.emailDraft = { ...emailResult.draft, generationMode: emailResult.mode, updatedAt: new Date().toISOString() };
        lead.emailStatus = 'Draft';
        delete lead.approvedAt;
        lead.followUpDraft = null; lead.followUpEmailStatus = null; delete lead.followUpApprovedAt;
        lead.updatedAt = new Date().toISOString();
        addActivity(`Introductory video-briefing email drafted for ${lead.company}`, 'email', actorName());
        saveDb();
        return sendJson(res, 201, { ok: true, lead, emailDraft: lead.emailDraft, mode: emailResult.mode, emailMode: emailResult.mode, message: emailResult.message });
      }
      if (method === 'POST' && action === 'follow-up/draft') {
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        if (!lead.firstSentAt || !Number(lead.followUpStep || 0)) return sendJson(res, 409, { error: 'No follow-up is scheduled for this prospect.' });
        const body = await readBody(req);
        const origin = publicOrigin(req);
        const result = await generateFollowUpEmail(lead, body, origin);
        lead.followUpDraft = { ...result.draft, attachProposal: Boolean(body.attachProposal && lead.proposalFile), updatedAt: new Date().toISOString() };
        lead.followUpEmailStatus = 'Draft';
        delete lead.followUpApprovedAt;
        lead.updatedAt = new Date().toISOString();
        addActivity(`${result.mode === 'openai' ? 'AI' : 'Guided'} follow-up draft prepared for ${lead.company}`, 'email', actorName());
        saveDb();
        return sendJson(res, 200, { ok: true, draft: lead.followUpDraft, mode: result.mode, message: result.message, lead: clientLead(lead) });
      }
      if (method === 'POST' && action === 'proposal/draft') {
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        const body = await readBody(req);
        const verifiedMetrics = parseVerifiedMetrics(body.verifiedMetrics ?? lead.proposalData?.verifiedMetrics ?? [], { strict: true });
        const draftingInput = { ...body, verifiedMetrics };
        const result = await generateProposalDraft(lead, draftingInput);
        lead.proposalData = {
          ...(lead.proposalData || {}), company: clampText(body.company || lead.company, 150),
          contactName: clampText(body.contactName || lead.contactName, 150), project: clampText(body.project || lead.project, 250),
          amount: Number(body.amount ?? lead.amount ?? 0), userNotes: clampText(body.userNotes, 3000), verifiedMetrics,
          rewriteNotes: clampText(body.rewriteNotes, 1000), guidelines: CHELO_PROPOSAL_GUIDELINES,
          generationMode: result.mode, ...result.draft
        };
        lead.updatedAt = new Date().toISOString();
        addActivity(`${result.mode === 'openai' ? 'AI' : 'Guided'} proposal draft prepared for ${lead.company}`, 'proposal', actorName());
        saveDb();
        return sendJson(res, 200, { ok: true, draft: result.draft, mode: result.mode, message: result.message, proposalData: lead.proposalData });
      }
      if (method === 'PATCH' && !action) {
        const body = await readBody(req);
        if (lead.doNotContact && body.doNotContact === false) return sendJson(res, 409, { error: 'The do-not-contact suppression is retained to prevent re-import or accidental outreach.' });
        const draftFields = ['emailDraft', 'followUpDraft', 'emailStatus', 'followUpEmailStatus'].some(key => body[key] !== undefined);
        if (draftFields) {
          const contactGate = await requireContactReady(lead);
          if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        }
        const contactFields = ['company', 'contactName', 'title', 'email', 'phone', 'sourceName', 'sourceUrl'];
        const contactChanged = contactFields.some(key => body[key] !== undefined && String(body[key] || '').trim() !== String(lead[key] || '').trim());
        const identityChanged = ['company', 'contactName', 'title', 'email', 'phone'].some(key => body[key] !== undefined && String(body[key] || '').trim() !== String(lead[key] || '').trim());
        const sourceChanged = ['sourceName', 'sourceUrl'].some(key => body[key] !== undefined && String(body[key] || '').trim() !== String(lead[key] || '').trim());
        const dates = verificationDateFields({ ...lead, ...body });
        if (!dates.ok) return sendJson(res, 400, { error: dates.issues.join(' ') });
        let newContactCheck = null;
        if (contactChanged) {
          const proposed = { ...lead, ...body, email: normalizeEmail(body.email !== undefined ? body.email : lead.email) };
          if (proposed.email && isSuppressedEmail(proposed.email) && !proposed.doNotContact) return sendJson(res, 409, { error: 'This address is on the do-not-contact suppression list.' });
          newContactCheck = await inspectContactRecord(proposed);
          if (newContactCheck.status === 'invalid') return sendJson(res, 400, { error: newContactCheck.reason || 'Email validation failed; the updated contact was not saved.' });
        }
        const normalizedBody = { ...body, contactLastVerifiedAt: dates.contactLastVerifiedAt, sourceLastVerifiedAt: dates.sourceLastVerifiedAt };
        if (identityChanged && dates.contactLastVerifiedAt === normalizeDateOnly(lead.contactLastVerifiedAt)) normalizedBody.contactLastVerifiedAt = '';
        if (sourceChanged && dates.sourceLastVerifiedAt === normalizeDateOnly(lead.sourceLastVerifiedAt)) normalizedBody.sourceLastVerifiedAt = '';
        if (normalizedBody.email !== undefined) normalizedBody.email = normalizeEmail(normalizedBody.email);
        updateLead(lead, normalizedBody, actorName());
        if (newContactCheck) lead.contactCheck = newContactCheck;
        saveDb();
        return sendJson(res, 200, lead);
      }
      if (method === 'DELETE' && !action) {
        if (lead.doNotContact) rememberSuppressedEmail(lead.email);
        db.leads = db.leads.filter(l => l.id !== lead.id);
        db.bookings = db.bookings.filter(b => b.leadId !== lead.id);
        addActivity(`Prospect removed: ${lead.company}`, 'lead', actorName());
        saveDb();
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'POST' && action === 'proposal') {
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        const body = await readBody(req);
        const verifiedMetrics = parseVerifiedMetrics(body.verifiedMetrics, { strict: true });
        createProposal(lead, { ...body, verifiedMetrics }, actorName());
        saveDb();
        return sendJson(res, 201, { ok: true, filename: lead.proposalFile, downloadUrl: `/api/leads/${lead.id}/proposal/download`, shareUrl: `/api/public/proposal/${lead.proposalToken}`, lead });
      }
      if (method === 'GET' && action === 'proposal/download') {
        if (!lead.proposalFile) return sendJson(res, 404, { error: 'Generate a proposal PDF first.' });
        return sendPdf(res, path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile)), `Chelo-proposal-${lead.id}.pdf`, 'attachment');
      }
      if (method === 'GET' && action === 'proposal/preview') {
        if (!lead.proposalFile) return sendJson(res, 404, { error: 'Generate a proposal PDF first.' });
        return sendPdf(res, path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile)), `Chelo-proposal-${lead.id}.pdf`, 'inline');
      }
      if (method === 'GET' && action === 'email/eml') {
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck });
        const followUp = url.searchParams.get('kind') === 'follow-up';
        const draft = followUp ? lead.followUpDraft : lead.emailDraft;
        const approved = followUp
          ? lead.followUpEmailStatus === 'Approved' && Boolean(lead.followUpApprovedAt)
          : lead.emailStatus === 'Approved' && Boolean(lead.approvedAt);
        if (!approved || !draft) return sendJson(res, 409, { error: 'Approve the email before downloading the .eml handoff.' });
        const attachProposal = Boolean(followUp && draft?.attachProposal && lead.proposalFile);
        let pdfBuffer = null;
        if (attachProposal) {
          const pdfPath = path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile));
          if (!fs.existsSync(pdfPath)) return sendJson(res, 404, { error: 'The prepared proposal PDF could not be found.' });
          pdfBuffer = fs.readFileSync(pdfPath);
        }
        try {
          const openTrackingEnabled = configStore.publicSettings().openTrackingEnabled;
          let pixelUrl = '';
          if (openTrackingEnabled) {
            const candidateToken = draft.openToken || crypto.randomBytes(24).toString('hex');
            pixelUrl = openTrackingUrl(candidateToken);
            if (pixelUrl) { draft.openToken = candidateToken; saveDb(); }
          }
          const { eml, downloadName } = buildEmailEml(lead, draft, followUp, pixelUrl, pdfBuffer);
          const data = Buffer.from(eml, 'utf8');
          res.writeHead(200, { 'Content-Type': 'message/rfc822; charset=utf-8', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${downloadName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          configStore.recordAudit({ actor: actorName(), action: 'email.eml_prepared', entityType: 'lead', entityId: lead.id, summary: `${followUp ? 'Follow-up' : 'Initial'} email downloaded as .eml${attachProposal ? ' with prepared proposal PDF attached' : ' without attachments'}` });
          return res.end(data);
        } catch (err) { return sendJson(res, 400, { error: err.message }); }
      }
      if (method === 'POST' && action === 'approve-email') {
        const body = await readBody(req);
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        const followUp = body.kind === 'follow-up';
        const policy = configStore.getGovernanceConfig().approvalPolicy;
        const statusKey = followUp ? 'followUpEmailStatus' : 'emailStatus';
        const draftKey = followUp ? 'followUpDraft' : 'emailDraft';
        const approvedAtKey = followUp ? 'followUpApprovedAt' : 'approvedAt';
        const approvalKey = followUp ? 'followUpApproval' : 'emailApproval';
        const approverId = req.authSession.userId || req.authSession.username;
        const approverLabel = `${req.authSession.displayName || req.authSession.username} <${req.authSession.username}>`;
        const pdfPathFor = () => path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile));
        const pdfDigest = () => fs.existsSync(pdfPathFor()) ? crypto.createHash('sha256').update(fs.readFileSync(pdfPathFor())).digest('hex') : '';

        // Second signature in strict 4-eyes mode: content must be byte-identical to what the first approver reviewed.
        if (body.confirmSecond === true) {
          const pending = lead[approvalKey];
          const draft = lead[draftKey];
          if (!pending || lead[statusKey] !== 'Pending second approval' || !draft) return sendJson(res, 409, { error: 'No draft is awaiting a second approval.' });
          if (pending.firstApproverId === approverId) return sendJson(res, 403, { error: 'Four-eyes policy: a different staff member must provide the second approval.' });
          if (!roleAllows(req.authSession, ['admin', 'reviewer'])) return sendJson(res, 403, { error: 'Only Admin or Reviewer accounts may countersign outbound email.' });
          const attachProposal = Boolean(followUp && draft.attachProposal && lead.proposalFile);
          const payload = { to: lead.email, kind: followUp ? 'follow-up' : 'initial', subject: draft.subject, body: draft.body, attachProposal, pdfSha256: attachProposal ? pdfDigest() : '', project: lead.project, amount: lead.amount };
          if (!configStore.verifyApprovalDigest(pending.digest, payload)) {
            lead[statusKey] = 'Draft'; lead[approvalKey] = null; saveDb();
            return sendJson(res, 409, { error: 'Draft content changed since the first approval. The approval was voided; restart the review.' });
          }
          lead[approvalKey] = { ...pending, secondApproverId: approverId, secondApprover: approverLabel, secondApprovedAt: new Date().toISOString(), policy };
          lead[statusKey] = 'Approved';
          lead[approvedAtKey] = new Date().toISOString();
          lead.updatedAt = new Date().toISOString();
          addActivity(`${followUp ? 'Follow-up' : 'Outreach'} countersigned for ${lead.company}`, 'email', approverLabel);
          configStore.recordAudit({ actor: approverLabel, action: 'email.approved.second', entityType: 'lead', entityId: lead.id, summary: `Second (4-eyes) approval for ${followUp ? 'follow-up' : 'initial'} email to ${lead.company}; digest ${pending.digest.slice(0, 16)}…` });
          saveDb();
          return sendJson(res, 200, clientLead(lead));
        }

        if (!roleAllows(req.authSession, ['admin', 'reviewer', 'owner'])) return sendJson(res, 403, { error: 'Your role cannot approve outbound email.' });
        const attachProposal = Boolean(followUp && body.attachProposal && lead.proposalFile);
        if (attachProposal && !fs.existsSync(pdfPathFor())) return sendJson(res, 409, { error: 'The prepared proposal PDF could not be found.' });
        const message = {
          subject: String(body.subject || '').slice(0, 200),
          body: cleanApprovedEmailBody({ body: String(body.body || '').slice(0, 8000) }, attachProposal),
          ...(followUp ? { attachProposal } : {}),
          updatedAt: new Date().toISOString()
        };
        const digest = configStore.computeApprovalDigest({ to: lead.email, kind: followUp ? 'follow-up' : 'initial', subject: message.subject, body: message.body, attachProposal, pdfSha256: attachProposal ? pdfDigest() : '', project: lead.project, amount: lead.amount });
        lead[draftKey] = message;
        lead[approvalKey] = { digest, firstApproverId: approverId, firstApprover: approverLabel, firstApprovedAt: new Date().toISOString(), policy, secondApproverId: null, secondApprover: null, secondApprovedAt: null };
        if (policy === 'four-eyes') {
          lead[statusKey] = 'Pending second approval';
          delete lead[approvedAtKey];
          addActivity(`${followUp ? 'Follow-up' : 'Outreach'} awaiting countersignature for ${lead.company}`, 'email', approverLabel);
          configStore.recordAudit({ actor: approverLabel, action: 'email.approved.first', entityType: 'lead', entityId: lead.id, summary: `First approval for ${followUp ? 'follow-up' : 'initial'} email to ${lead.company}; awaiting second reviewer (digest ${digest.slice(0, 16)}…)` });
        } else {
          lead[statusKey] = 'Approved';
          lead[approvedAtKey] = new Date().toISOString();
          addActivity(`${followUp ? 'Follow-up' : 'Outreach'} approved for ${lead.company}`, 'email', approverLabel);
          configStore.recordAudit({ actor: approverLabel, action: 'email.approved', entityType: 'lead', entityId: lead.id, summary: `${followUp ? 'Follow-up' : 'Initial'} email approved for ${lead.company} (single approver policy; digest ${digest.slice(0, 16)}…)` });
        }
        lead.updatedAt = new Date().toISOString();
        saveDb();
        return sendJson(res, 200, clientLead(lead));
      }
      if (method === 'POST' && action === 'return-draft') {
        const body = await readBody(req);
        const followUp = body.kind === 'follow-up';
        const statusKey = followUp ? 'followUpEmailStatus' : 'emailStatus';
        if (!['Approved', 'Pending second approval'].includes(lead[statusKey])) return sendJson(res, 409, { error: 'Only approved or pending drafts can be returned for edits.' });
        lead[statusKey] = 'Draft';
        lead[followUp ? 'followUpApproval' : 'emailApproval'] = null;
        delete lead[followUp ? 'followUpApprovedAt' : 'approvedAt'];
        lead.updatedAt = new Date().toISOString();
        configStore.recordAudit({ actor: actorName(), action: 'email.returned', entityType: 'lead', entityId: lead.id, summary: `${followUp ? 'Follow-up' : 'Initial'} email returned to draft for ${lead.company}${body.reason ? `: ${String(body.reason).slice(0, 160)}` : ''}` });
        saveDb();
        return sendJson(res, 200, clientLead(lead));
      }
      if (method === 'POST' && action === 'send-email') {
        const body = await readBody(req);
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        const followUp = body.kind === 'follow-up';
        const draft = followUp ? lead.followUpDraft : lead.emailDraft;
        const approved = followUp ? lead.followUpEmailStatus === 'Approved' && Boolean(lead.followUpApprovedAt) : lead.emailStatus === 'Approved' && Boolean(lead.approvedAt);
        if (!draft || !approved) return sendJson(res, 409, { error: `Approve the ${followUp ? 'follow-up' : 'message'} before sending.` });
        const attachProposal = Boolean(followUp && draft?.attachProposal && lead.proposalFile);
        const pdfPath = attachProposal ? path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile)) : '';
        if (attachProposal && !fs.existsSync(pdfPath)) return sendJson(res, 409, { error: 'The prepared proposal PDF could not be found.' });
        const to = String(lead.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return sendJson(res, 400, { error: 'Add a valid recipient email before sending.' });
        const lockKey = `${lead.id}:${followUp ? 'follow-up' : 'initial'}`;
        if (sendingLocks.has(lockKey)) return sendJson(res, 409, { error: 'This email is already being sent.' });
        sendingLocks.add(lockKey);
        let transport;
        try {
          const configured = smtpTransporter(); transport = configured.transport;
          const openTokenCandidate = configStore.publicSettings().openTrackingEnabled ? crypto.randomBytes(24).toString('hex') : '';
          const pixelUrl = openTrackingUrl(openTokenCandidate);
          const openToken = pixelUrl ? openTokenCandidate : null;
          const emailBody = cleanApprovedEmailBody(draft, attachProposal);
          const subject = String(draft.subject || '').replace(/[\r\n]+/g, ' ').trim();
          const info = await transport.sendMail({
            from: { name: configured.smtp.fromName, address: configured.smtp.fromEmail },
            to, subject, text: emailBody, html: emailHtml(emailBody, pixelUrl),
            attachments: attachProposal ? [{ filename: 'Chelo-Partnership-Proposal.pdf', content: fs.readFileSync(pdfPath), contentType: 'application/pdf' }] : []
          });
          if (!info.accepted || !info.accepted.length) throw new Error('SMTP did not accept the recipient address.');
          const message = recordSentMessage(lead, followUp, 'SMTP', openToken, info.messageId || '', actorName());
          configStore.recordAudit({ actor: actorName(), action: 'email.smtp_sent', entityType: 'lead', entityId: lead.id, summary: `${followUp ? 'Follow-up' : 'Initial'} email accepted by SMTP${attachProposal ? ' with proposal PDF attachment' : ' without attachments'}` });
          return sendJson(res, 200, { ok: true, message: attachProposal ? 'SMTP accepted the email with the prepared proposal PDF attached.' : 'SMTP accepted the introductory email without attachments.', openTrackingIncluded: Boolean(openToken), lead: { id: lead.id, company: lead.company, emailStatus: lead.emailStatus, followUpEmailStatus: lead.followUpEmailStatus, followUpAt: lead.followUpAt }, message: { id: message.id, kind: message.kind, sentAt: message.sentAt, status: message.status } });
        } catch (err) {
          configStore.recordAudit({ actor: actorName(), action: 'email.smtp_failed', entityType: 'lead', entityId: lead.id, summary: 'SMTP send attempt failed; message was not recorded as sent' });
          return sendJson(res, 502, { error: `SMTP send failed: ${String(err.message || 'Connection error').slice(0, 260)}` });
        } finally {
          if (transport) transport.close();
          sendingLocks.delete(lockKey);
        }
      }
      if (method === 'POST' && action === 'mark-sent') {
        const body = await readBody(req);
        if (lead.doNotContact) return sendJson(res, 409, { error: 'This prospect is on the do-not-contact list.' });
        const contactGate = await requireContactReady(lead);
        if (!contactGate.ok) { saveDb(); return sendJson(res, 409, { error: contactGate.error, contactCheck: contactGate.contactCheck }); }
        const followUp = body.kind === 'follow-up';
        const draft = followUp ? lead.followUpDraft : lead.emailDraft;
        const approved = followUp ? lead.followUpEmailStatus === 'Approved' && Boolean(lead.followUpApprovedAt) : lead.emailStatus === 'Approved' && Boolean(lead.approvedAt);
        if (!draft || !approved) return sendJson(res, 409, { error: `Approve the ${followUp ? 'follow-up' : 'message'} before marking it as sent.` });
        const message = recordSentMessage(lead, followUp, 'email-client handoff', draft.openToken || null, '', actorName());
        return sendJson(res, 200, { ...lead, lastMessage: { id: message.id, kind: message.kind, sentAt: message.sentAt, status: message.status } });
      }
      if (method === 'POST' && action === 'mark-replied') {
        const body = await readBody(req);
        const now = new Date().toISOString();
        const messageId = db.messages.find(m => m.leadId === lead.id && m.kind === 'initial' && m.sentAt && ['Sent', 'Confirmed by staff'].includes(m.status))?.id || null;
        addEmailEvent(lead.id, 'reply', messageId);
        lead.replyAt = now; lead.followUpAt = null; lead.followUpStep = 0;
        lead.emailStatus = 'Replied (staff recorded)'; lead.nextAction = String(body.nextAction || 'Review reply and respond'); lead.updatedAt = now;
        addActivity(`Reply recorded for ${lead.company}`, 'email', actorName());
        saveDb();
        return sendJson(res, 200, lead);
      }
      if (method === 'POST' && action === 'opt-out') {
        lead.doNotContact = true;
        rememberSuppressedEmail(lead.email);
        lead.followUpAt = null; lead.followUpStep = 0;
        lead.emailStatus = 'Do not contact';
        lead.updatedAt = new Date().toISOString();
        addActivity(`${lead.company} added to suppression list`, 'privacy', actorName());
        saveDb();
        return sendJson(res, 200, lead);
      }
    }

    const bookingRoute = pathname.match(/^\/api\/bookings\/([^/]+)(?:\/(.*))?$/);
    if (bookingRoute && method === 'GET' && bookingRoute[2] === 'invite.ics') {
      const booking = db.bookings.find(b => b.id === bookingRoute[1]);
      if (!booking) return sendJson(res, 404, { error: 'Briefing request not found.' });
      const lead = findLead(booking.leadId);
      const smtp = configStore.getSmtpConfig();
      try {
        const ics = calendar.buildBriefingIcs(booking, { project: lead?.project, organizerEmail: smtp.fromEmail || 'partnerships@cheloapp.com', organizerName: smtp.fromName });
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8; method=PUBLISH', 'Content-Disposition': `attachment; filename="chelo-briefing-${booking.id}.ics"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(ics);
      } catch (err) { return sendJson(res, 400, { error: err.message }); }
    }
    if (bookingRoute && method === 'POST' && bookingRoute[2] === 'send-confirmation') {
      const booking = db.bookings.find(b => b.id === bookingRoute[1]);
      if (!booking) return sendJson(res, 404, { error: 'Briefing request not found.' });
      if (booking.status !== 'Confirmed') return sendJson(res, 409, { error: 'Confirm the briefing before sending the calendar invite.' });
      const result = await sendBriefingConfirmation(booking, actorName());
      saveDb();
      return sendJson(res, result.ok ? 200 : 502, { ...result, booking });
    }
    if (bookingRoute && method === 'PATCH' && !bookingRoute[2]) {
      const booking = db.bookings.find(b => b.id === bookingRoute[1]);
      if (!booking) return sendJson(res, 404, { error: 'Briefing request not found.' });
      const body = await readBody(req);
      const previousStatus = booking.status;
      if (['Requested', 'Confirmed', 'Declined', 'Completed'].includes(body.status)) booking.status = body.status;
      if (body.date || body.time) {
        const nextDate = body.date ? String(body.date) : booking.date;
        const nextTime = body.time ? String(body.time) : booking.time;
        if (!calendar.parseSastDateTime(nextDate, nextTime)) return sendJson(res, 400, { error: 'Enter a valid SAST date (YYYY-MM-DD) and time (HH:MM).' });
        if (nextDate !== booking.date || nextTime !== booking.time) booking.icsSequence = Number(booking.icsSequence || 0) + 1;
        booking.date = nextDate; booking.time = nextTime;
      }
      if (body.videoPlatform !== undefined) {
        if (!calendar.VIDEO_PLATFORMS[body.videoPlatform]) return sendJson(res, 400, { error: 'Choose Google Meet, Microsoft Teams or Zoom.' });
        booking.videoPlatform = body.videoPlatform;
      }
      if (body.meetingUrl !== undefined) {
        const check = calendar.validateMeetingUrl(body.meetingUrl);
        if (!check.ok) return sendJson(res, 400, { error: check.error });
        booking.meetingUrl = check.url;
        if (check.url) booking.videoPlatform = calendar.detectVideoPlatform(check.url, booking.videoPlatform || 'google_meet');
      }
      if (body.note !== undefined) booking.note = String(body.note).slice(0, 1000);
      booking.updatedAt = new Date().toISOString();
      const lead = findLead(booking.leadId);
      if (lead && booking.status === 'Confirmed') { lead.stage = 'Briefing booked'; lead.nextAction = 'Prepare briefing'; lead.followUpAt = null; lead.followUpStep = 0; lead.updatedAt = new Date().toISOString(); }
      if (lead && booking.status === 'Declined' && lead.stage === 'Briefing requested') { lead.stage = 'Interested'; lead.nextAction = 'Offer alternative briefing dates'; lead.updatedAt = new Date().toISOString(); }
      if (previousStatus !== booking.status) addActivity(`${booking.status} briefing for ${booking.organization}`, 'booking', actorName());
      let confirmation = null;
      if (booking.status === 'Confirmed' && (previousStatus !== 'Confirmed' || body.resendInvite === true) && configStore.getBriefingsConfig().autoSendCalendarInvite) {
        if (!booking.meetingUrl) {
          const prefs = configStore.getBriefingsConfig();
          const roomByPlatform = { google_meet: prefs.googleMeetUrl, microsoft_teams: prefs.microsoftTeamsUrl, zoom: prefs.zoomUrl };
          booking.meetingUrl = roomByPlatform[booking.videoPlatform] || '';
        }
        confirmation = await sendBriefingConfirmation(booking, actorName());
      }
      saveDb();
      return sendJson(res, 200, { ...booking, confirmation });
    }
    const partnerRoute = pathname.match(/^\/api\/partners\/([^/]+)$/);
    if (partnerRoute && method === 'PATCH') {
      const partner = db.partners.find(p => p.id === partnerRoute[1]);
      if (!partner) return sendJson(res, 404, { error: 'Partner not found.' });
      const body = await readBody(req);
      const partnerDates = verificationDateFields({ ...partner, ...body });
      if (!partnerDates.ok) return sendJson(res, 400, { error: partnerDates.issues.join(' ') });
      const partnerContactChanged = ['company', 'contactName', 'title', 'email', 'phone'].some(key => body[key] !== undefined && String(body[key] || '').trim() !== String(partner[key] || '').trim());
      const partnerSourceChanged = ['sourceName', 'sourceUrl'].some(key => body[key] !== undefined && String(body[key] || '').trim() !== String(partner[key] || '').trim());
      for (const k of ['company', 'contactName', 'title', 'email', 'phone', 'project', 'status', 'owner', 'notes', 'relationshipContext', 'partnerPriorities', 'sourceName', 'sourceUrl']) {
        if (body[k] === undefined) continue;
        const value = k === 'email' ? normalizeEmail(body[k]) : String(body[k] || '').trim();
        partner[k] = k === 'relationshipContext' ? clampText(value, 800) : k === 'partnerPriorities' ? clampText(value, 1200) : k === 'sourceName' ? clampText(value, 300) : k === 'sourceUrl' ? clampText(value, 2000) : value;
      }
      partner.contactLastVerifiedAt = partnerContactChanged && partnerDates.contactLastVerifiedAt === normalizeDateOnly(partner.contactLastVerifiedAt) ? '' : partnerDates.contactLastVerifiedAt;
      partner.sourceLastVerifiedAt = partnerSourceChanged && partnerDates.sourceLastVerifiedAt === normalizeDateOnly(partner.sourceLastVerifiedAt) ? '' : partnerDates.sourceLastVerifiedAt;
      if (body.amount !== undefined) partner.amount = Math.max(0, Number(body.amount || 0));
      const linkedLead = partner.leadId ? findLead(partner.leadId) : null;
      if (linkedLead) {
        for (const key of ['sourceName', 'sourceUrl', 'sourceLastVerifiedAt', 'contactLastVerifiedAt', 'relationshipContext', 'partnerPriorities']) linkedLead[key] = partner[key] || '';
        linkedLead.updatedAt = new Date().toISOString();
      }
      partner.updatedAt = new Date().toISOString();
      addActivity(`Partner profile updated: ${partner.company}`, 'partner', actorName());
      saveDb();
      return sendJson(res, 200, partner);
    }

    return sendJson(res, 404, { error: 'API route not found.' });
  } catch (error) {
    if (req.authSession && method === 'POST' && pathname === '/api/settings/test-ai') configStore.recordAudit({ actor: actorName(), action: 'settings.ai_test_failed', entityType: 'integration', summary: 'AI provider connection test failed; secret values omitted' });
    if (req.authSession && method === 'POST' && pathname === '/api/settings/test-smtp') configStore.recordAudit({ actor: actorName(), action: 'settings.smtp_test_failed', entityType: 'integration', summary: 'SMTP connection test failed; secret values omitted' });
    console.error('API error:', error.message);
    return sendJson(res, 400, { error: error.message || 'Something went wrong.' });
  }
}

function serveSharedProposal(res, token) {
  const lead = db.leads.find(l => l.proposalToken === token && l.proposalFile);
  if (!lead) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Proposal link not found.'); }
  return sendPdf(res, path.join(PROPOSAL_DIR, safeFilename(lead.proposalFile)), `Chelo-proposal.pdf`, 'inline');
}

const requestHandler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  const trackedOpen = url.pathname.match(/^\/track\/open\/([a-f0-9]{48})\.gif$/);
  if (trackedOpen && req.method === 'GET') {
    const token = trackedOpen[1];
    const message = db.messages.find(item => item.openToken === token && item.sentAt && ['Sent', 'Confirmed by staff'].includes(item.status));
    if (message && !db.emailEvents.some(event => event.type === 'open' && event.messageId === message.id)) {
      addEmailEvent(message.leadId, 'open', message.id, 'tracking-pixel');
      configStore.recordAudit({ actor: 'recipient', action: 'email.opened', entityType: 'message', entityId: message.id, summary: 'Estimated open recorded by tracking pixel; privacy tools may affect accuracy' });
      saveDbDeferred();
    }
    return sendTransparentPixel(res);
  }
  const trackedCta = url.pathname.match(/^\/track\/cta\/([^/]+)$/);
  if (trackedCta && req.method === 'GET') {
    const lead = db.leads.find(l => l.bookingToken === trackedCta[1]);
    if (!lead || lead.doNotContact) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Booking link unavailable.'); }
    const sourceMessage = db.messages.find(message => message.leadId === lead.id && message.sentAt && ['Sent', 'Confirmed by staff'].includes(message.status));
    addEmailEvent(lead.id, 'click_cta', sourceMessage?.id || null);
    configStore.recordAudit({ actor: 'recipient', action: 'email.cta_clicked', entityType: 'lead', entityId: lead.id, summary: 'Yes — choose preferred time CTA clicked' });
    saveDbDeferred();
    res.writeHead(302, { Location: `/book/${encodeURIComponent(lead.bookingToken)}`, 'Cache-Control': 'no-store' }); return res.end();
  }
  const trackedProposal = url.pathname.match(/^\/track\/proposal\/([^/]+)$/);
  if (trackedProposal && req.method === 'GET') {
    const lead = db.leads.find(l => l.bookingToken === trackedProposal[1] && l.proposalToken && l.proposalFile);
    if (!lead) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Proposal link unavailable.'); }
    addEmailEvent(lead.id, 'click_proposal');
    configStore.recordAudit({ actor: 'recipient', action: 'email.proposal_clicked', entityType: 'lead', entityId: lead.id, summary: 'Legacy proposal share link clicked' });
    saveDbDeferred();
    res.writeHead(302, { Location: `/proposal/${encodeURIComponent(lead.proposalToken)}`, 'Cache-Control': 'no-store' }); return res.end();
  }
  const share = url.pathname.match(/^\/proposal\/([a-f0-9]+)$/);
  if (share && req.method === 'GET') return serveSharedProposal(res, share[1]);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Method not allowed'); }
  return serveStatic(req, res, url.pathname);
};
const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Chelo Partnerships Workspace running at http://${HOST}:${PORT}`);
    console.log(`Data directory: ${DATA_DIR} (SQLite WAL: ${path.basename(store.sqlitePath)}). Demo prospects are fictional; verified projects are Chelo seed records.`);
  });
}

module.exports = { server, requestHandler, flushPendingWrites: () => { if (savePending) flushDb(); } };
