const BRAND_MARK = '<img class="brand-mark" src="/brand/chelo-mark.svg" alt="" width="32" height="32" decoding="async" />';
const API = async (url, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', 'X-Chelo-Desk': currentDesk(), ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.auth?.csrfToken && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = state.auth.csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, method, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) { const error = new Error(payload?.error || `Request failed (${response.status})`); error.status = response.status; error.code = payload?.code || ''; error.duplicates = payload?.duplicates || null; error.payload = payload; throw error; }
  return payload;
};

// ---- Desks (R1): one engine, four lenses. The chosen desk travels on every request as X-Chelo-Desk. ----
const DESK_KEY = 'chelo-desk';
function myDesks() { const list = Array.isArray(state?.auth?.desks) && state.auth.desks.length ? state.auth.desks : ['csi']; return list; }
function currentDesk() { try { const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(DESK_KEY)) || ''; const mine = myDesks(); return mine.includes(saved) ? saved : mine[0]; } catch { return 'csi'; } }
function isSupplierLead(lead) { return (lead?.kind || 'funder') === 'supplier'; }
function onSuppliers() { return currentDesk() === 'suppliers'; }
function onSupporters() { return currentDesk() === 'supporters'; }
function isIndividualLead(lead) { return lead?.kind === 'individual'; }
function isSchoolLead(lead) { return (lead?.kind || 'funder') === 'school'; }
function onSchools() { return currentDesk() === 'schools'; }
function isMediaLead(lead) { return (lead?.kind || 'funder') === 'media'; }
function onMarketing() { return currentDesk() === 'marketing'; }
function deskMeta(id = currentDesk()) { return (state?.auth?.deskCatalogue || []).find(d => d.id === id) || { id, label: id === 'csi' ? 'CSI' : id, title: `${id} desk`, targetLabel: 'Funders', targetSingular: 'funder', todoBlurb: '' }; }
function deskSwitch() {
  const mine = myDesks(); if (mine.length < 2) return '';
  const cur = currentDesk();
  return `<div class="desk-switch" role="tablist" aria-label="Desk">${mine.map(id => { const m = deskMeta(id); return `<button type="button" role="tab" class="desk-tab ${id === cur ? 'is-active' : ''}" data-action="desk-switch" data-desk="${esc(id)}" aria-selected="${id === cur}" title="${esc(m.title)}">${esc(m.label)}</button>`; }).join('')}</div>`;
}
/** v70: each desk shows only the sections it uses. Labels are the desk's own words (Calls, Jobs, Shows & outlets). */
const DESK_NAV = {
  csi: ['inbox', 'workbench', 'overview', 'projects', 'prospects', 'briefings', 'sent', 'partners', 'ops', 'settings'],
  marketing: ['inbox', 'workbench', 'prospects', 'media-kit', 'projects', 'sent', 'ops', 'settings'],
  schools: ['inbox', 'workbench', 'prospects', 'briefings', 'projects', 'sent', 'ops', 'settings'],
  suppliers: ['workbench', 'prospects', 'projects', 'sent', 'ops', 'settings'],
  supporters: ['inbox', 'workbench', 'prospects', 'projects', 'sent', 'ops', 'settings']
};
const DESK_WORDS = {
  csi: { briefings: 'Briefings', projects: 'Projects', addLabel: 'Add a funder', prospectsBlurb: 'Everyone we are talking to.' },
  marketing: { briefings: 'Interviews', projects: 'Projects', addLabel: 'Add show or outlet', prospectsBlurb: 'Every show, station, podcast and outlet we are pitching.' },
  schools: { briefings: 'Calls', projects: 'Projects', addLabel: 'Find a school', prospectsBlurb: 'Schools and district offices we are working with.' },
  suppliers: { briefings: 'Briefings', projects: 'Jobs', addLabel: 'Copy sign-up link', prospectsBlurb: 'Registered suppliers: vetting, documents, jobs and earnings.' },
  supporters: { briefings: 'Briefings', projects: 'Projects', addLabel: 'Add an NGO', prospectsBlurb: 'NGOs we are approaching and individuals who signed up to back projects.' }
};
function deskNav(id = currentDesk()) { return DESK_NAV[id] || DESK_NAV.csi; }
function deskWord(key, id = currentDesk()) { return (DESK_WORDS[id] || DESK_WORDS.csi)[key] || (DESK_WORDS.csi[key] || ''); }
function deskAllowsView(view, id = currentDesk()) { return ['review', 'media-kit'].includes(view) || deskNav(id).includes(view); }
/** The one top-right action per desk: funders/media add a lead; schools open the DBE browser; suppliers register themselves. */
function deskAddButton() {
  const desk = currentDesk(); const label = deskWord('addLabel');
  const icon = desk === 'schools' ? 'search' : desk === 'suppliers' ? 'copy' : 'plus';
  return `<button type="button" class="button button-primary" data-action="desk-add">${svgIcon(icon)} ${esc(label)}</button>`;
}
const state = {
  photos: { themes: null, loading: false, theme: {} },
  mfa: { status: null, loading: false, setup: null, recoveryCodes: null },
  mfaChallenge: null,
  sup: { link: null, loading: false, match: null },
  sch: { collapsed: (() => { try { return localStorage.getItem('chelo-sch-collapsed') === '1'; } catch { return false; } })(), status: null, province: '', district: '', circuit: '', contact: '', q: '', tree: null, treeKey: '', list: null, busy: false },
  palette: null,
  dlv: { data: null, loading: false, error: '', editing: null },
  dq: { data: null, loading: false, error: '', busy: false },
  rel: { summary: null, loading: false, error: '', busy: false, view: null, viewId: null, tab: 'timeline' },
  cat: { status: null, loading: false, busy: false, task: '', progress: '', storage: null },
  ops: { data: null, loading: false, error: '', area: 'all', tab: 'health' },
  wb: { selectedId: null, sort: 'fit', filter: 'your-turn', intake: 'add', discovery: { query: '', results: [], busy: false, error: '' }, busy: {}, pendingRan: false },
  data: { leads: [], candidates: [], partners: [], bookings: [], activities: [], messages: [], emailEvents: [], projects: [], provinces: [], videoPlatforms: [], staff: [], currentUser: null, stages: [], aiConfigured: false, aiModel: '', emailProviderConfigured: false, settings: {}, analytics: null, radar: null },
  auth: { authenticated: false, setupRequired: false, username: '', csrfToken: '' }, authError: '',
  view: 'workbench', query: '', stageFilter: 'All stages', candidateFilter: 'All candidates', modal: null,
  settingsSection: 'mailbox', myMailboxes: null, myMailboxesLoading: false, auditLogs: null, auditQuery: '', analyticsRange: 30, analyticsLoading: false,
  bookingInfo: null, bookingLoading: false, bookingSubmitted: false, bookingError: '',
  optOutInfo: null, optOutDone: false,
  importInput: null, importReport: null, csvImportPreview: null, currentDate: new Date(), mobileMoreOpen: false,
  projectFilter: 'All provinces', prospectsMode: 'table', copilot: null, copilotBusy: false, projectImportPreview: null, researchBusy: false, researchError: '', copilotTab: 'paste'
};
let auditSearchTimer = null;
let auditRequestId = 0;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const INTRO_MEETING_MINUTES = 20;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => `R ${Number(value || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
const shortMoney = value => {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `R ${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}m`;
  if (n >= 1000) return `R ${(n / 1000).toFixed(n % 1000 ? 0 : 0)}k`;
  return money(n);
};
const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'there';
const initials = name => String(name || 'C').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const stageClass = value => `pill-${String(value || 'new').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const isoDate = value => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return '';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
};
const timeLabel = value => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return '';
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
};
const dateOnly = value => {
  if (!value) return '';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
};
const verificationDateValue = value => /^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : '';
const CONTACT_REVIEW_DAYS = 180;
function verificationFreshness(value, label = 'Contact') {
  const date = verificationDateValue(value);
  if (!date) return { text: `${label} check not recorded`, className: 'freshness-unknown', days: null };
  const [year, month, day] = date.split('-').map(Number);
  const checked = new Date(year, month - 1, day, 12);
  if (Number.isNaN(checked.valueOf()) || checked.getFullYear() !== year || checked.getMonth() !== month - 1 || checked.getDate() !== day) return { text: `${label} check date invalid`, className: 'freshness-unknown', days: null };
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.floor((today - checked) / 86400000);
  if (days < 0) return { text: `${label} check date is in the future`, className: 'freshness-stale', days };
  if (days > CONTACT_REVIEW_DAYS) return { text: `${label} check ${days}d ago · review due`, className: 'freshness-stale', days };
  return { text: `${label} check ${days}d ago`, className: 'freshness-current', days };
}
const dateParts = value => {
  if (!value) return { day: '—', month: '—' };
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  return { day: String(d).padStart(2, '0'), month: date.toLocaleDateString('en-ZA', { month: 'short' }) };
};
const localDateValue = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const sortRecent = arr => [...arr].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
const getLead = id => state.data.leads.find(l => l.id === id);
const getBooking = id => state.data.bookings.find(b => b.id === id);
const getPartner = id => state.data.partners.find(p => p.id === id);

const CSV_IMPORT_FIELDS = [
  { key: 'company', label: 'Organisation', aliases: ['company', 'organisation', 'organization', 'organisation_name', 'organization_name', 'company_name', 'funding_organisation', 'name'] },
  { key: 'contactName', label: 'Contact name', aliases: ['contact', 'contact_name', 'poc', 'point_of_contact', 'contact_person', 'full_name'] },
  { key: 'email', label: 'Work email', aliases: ['email', 'work_email', 'email_address', 'contact_email'] },
  { key: 'title', label: 'Role / title', aliases: ['title', 'role', 'job_title', 'position'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone', 'mobile', 'phone_number'] },
  { key: 'sector', label: 'Sector', aliases: ['sector', 'industry'] },
  { key: 'sourceName', label: 'Source name', aliases: ['source_name', 'source', 'reference', 'source_title', 'evidence_source'] },
  { key: 'sourceUrl', label: 'Source URL', aliases: ['source_url', 'website', 'url', 'reference_url'] },
  { key: 'sourceLastVerifiedAt', label: 'Source last checked', aliases: ['source_last_verified_at', 'source_verified_at', 'source_checked_at', 'source_last_checked'] },
  { key: 'contactLastVerifiedAt', label: 'Contact last verified', aliases: ['contact_last_verified_at', 'contact_last_verified', 'contact_verified_at', 'last_contact_verified', 'last_verified_at', 'last_verified', 'verified_at'] },
  { key: 'relationshipContext', label: 'Relationship / warm intro', aliases: ['relationship_context', 'warm_intro', 'warm_introduction', 'introduction_path', 'intro_path', 'relationship_path', 'connection_path'] },
  { key: 'partnerPriorities', label: 'Partner priorities / timing', aliases: ['partner_priorities', 'giving_priorities', 'funding_priorities', 'priority_notes', 'priorities', 'grant_cycle', 'budget_timing'] },
  { key: 'project', label: 'Impact / project focus', aliases: ['project', 'impact_focus'] },
  { key: 'amount', label: 'Potential contribution', aliases: ['amount', 'potential_contribution', 'ask_value', 'contribution_amount', 'potential_ask'] },
  { key: 'fitScore', label: 'Staff fit score', aliases: ['fit_score', 'fit', 'match_score'] },
  { key: 'owner', label: 'Relationship owner', aliases: ['owner', 'relationship_owner', 'assigned_to'] },
  { key: 'notes', label: 'Research notes', aliases: ['notes', 'research_notes'] }
];
const csvHeaderKey = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '');
function autoMapCsvHeaders(headers) {
  const normalized = headers.map(csvHeaderKey);
  return Object.fromEntries(CSV_IMPORT_FIELDS.map(field => {
    const aliases = new Set(field.aliases.map(csvHeaderKey));
    return [field.key, normalized.findIndex(header => aliases.has(header))];
  }));
}
function csvNumber(raw, fallback) {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, value: fallback };
  const numeric = text.replace(/(?:ZAR|R|USD|\$|€|£)/gi, '').replace(/[\s,]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return { ok: false, value: fallback };
  const value = Number(numeric);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: fallback };
}
function csvDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, value: '' };
  const date = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (text.length > 10 && Number.isNaN(new Date(text).valueOf()))) return { ok: false, value: '' };
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? { ok: true, value: date } : { ok: false, value: '' };
}
function csvMappedCandidate(row, mapping) {
  const value = key => {
    const column = Number(mapping[key]);
    return Number.isInteger(column) && column >= 0 ? String(row.values[column] || '').trim() : '';
  };
  const company = value('company'), contactName = value('contactName'), email = value('email').toLowerCase();
  const amount = csvNumber(value('amount'), 0), fitScore = csvNumber(value('fitScore'), 70);
  const contactDate = csvDate(value('contactLastVerifiedAt')), sourceDate = csvDate(value('sourceLastVerifiedAt'));
  const candidate = {
    csvRowNumber: row.rowNumber, company, contactName, email, title: value('title'), phone: value('phone'), sector: value('sector'),
    sourceName: value('sourceName'), sourceUrl: value('sourceUrl'), sourceLastVerifiedAt: sourceDate.value, contactLastVerifiedAt: contactDate.value,
    relationshipContext: value('relationshipContext'), partnerPriorities: value('partnerPriorities'), project: value('project'),
    amount: amount.value, fitScore: fitScore.value, owner: value('owner') || 'Nandi', notes: value('notes')
  };
  const errors = [], warnings = [];
  if (!company) errors.push('Organisation is required; this row cannot be retained.');
  if (row.values.length > row.headerCount) errors.push(`${row.values.length - row.headerCount} value(s) have no matching header; review the CSV columns.`);
  if (email && !/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email)) errors.push('Email syntax is invalid; server intake will discard this address.');
  if (!amount.ok) errors.push('Potential contribution is not a valid non-negative number.');
  if (!fitScore.ok || fitScore.value < 0 || fitScore.value > 100) errors.push('Staff fit score must be a number from 0 to 100.');
  if (!contactDate.ok) errors.push('Contact last-verified date must use ISO format YYYY-MM-DD.');
  if (!sourceDate.ok) errors.push('Source last-checked date must use ISO format YYYY-MM-DD.');
  const missing = [];
  if (!contactName) missing.push('contact name');
  if (!email) missing.push('work email');
  if (!candidate.sourceName && !candidate.sourceUrl) missing.push('source name or URL');
  if (missing.length) warnings.push(`Can enter Discover for clarification, but cannot be promoted until completed: ${missing.join(', ')}.`);
  return { candidate, errors, warnings };
}
function csvCompanyKey(value) { return String(value || '').toLowerCase().replace(/\s·\s*demo$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function csvEmailKey(value) { return String(value || '').trim().toLowerCase(); }
function getCsvPreviewRows(preview = state.csvImportPreview) {
  if (!preview) return [];
  const seenEmails = new Map(), seenCompanies = new Map();
  return preview.rows.map(rawRow => {
    const mapped = csvMappedCandidate(rawRow, preview.mapping);
    const companyKey = csvCompanyKey(mapped.candidate.company), emailKey = csvEmailKey(mapped.candidate.email);
    let duplicate = null;
    const existingEmail = emailKey && [...state.data.leads, ...state.data.candidates].find(item => csvEmailKey(item.email) === emailKey);
    const existingCompany = companyKey && [...state.data.leads, ...state.data.candidates].find(item => csvCompanyKey(item.company) === companyKey);
    if (existingEmail) duplicate = { type: 'email', company: existingEmail.company, location: existingEmail.stage ? 'pipeline' : 'Discover' };
    else if (existingCompany) duplicate = { type: 'organisation', company: existingCompany.company, location: existingCompany.stage ? 'pipeline' : 'Discover' };
    else if (emailKey && seenEmails.has(emailKey)) duplicate = { type: 'email', company: seenEmails.get(emailKey).company, row: seenEmails.get(emailKey).row };
    else if (companyKey && seenCompanies.has(companyKey)) duplicate = { type: 'organisation', company: seenCompanies.get(companyKey).company, row: seenCompanies.get(companyKey).row };
    if (emailKey && !seenEmails.has(emailKey)) seenEmails.set(emailKey, { company: mapped.candidate.company, row: rawRow.rowNumber });
    if (companyKey && !seenCompanies.has(companyKey)) seenCompanies.set(companyKey, { company: mapped.candidate.company, row: rawRow.rowNumber });
    const selected = mapped.errors.length ? false : rawRow.include === undefined ? !duplicate : Boolean(rawRow.include);
    return { ...rawRow, ...mapped, duplicate, selected };
  });
}

// Chelo duotone icon system — 24px grid. Layers: .icon-tint (translucent body), .icon-line (crisp stroke),
// .icon-accent (small emphasis dot, drawn in currentColor). Classless paths inherit the stroke defaults of .icon-svg.
const A = (cx, cy, r = 1.6) => `<circle class="icon-accent" cx="${cx}" cy="${cy}" r="${r}"/>`;
const icons = {
  refresh: `<path class="icon-tint" d="M12 4.2a7.8 7.8 0 1 1-7.4 10.2h2.3A5.6 5.6 0 1 0 12 6.4z"/><path class="icon-line" d="M19.6 10.5A7.8 7.8 0 0 0 5.2 8.3M4.4 13.5a7.8 7.8 0 0 0 14.4 2.2"/><path class="icon-line" d="M19.8 4.8v5.7h-5.7M4.2 19.2v-5.7h5.7"/>${A(12, 12, 1.4)}`,
  copy: `<rect class="icon-tint" x="8.5" y="8.5" width="11.5" height="11.5" rx="2.6"/><rect class="icon-line" x="8.5" y="8.5" width="11.5" height="11.5" rx="2.6"/><path class="icon-line" d="M15.5 8.5V6.4A2.4 2.4 0 0 0 13.1 4H6.4A2.4 2.4 0 0 0 4 6.4v6.7a2.4 2.4 0 0 0 2.4 2.4h2.1"/>${A(17.2, 17.2, 1.3)}`,
  trash: `<path class="icon-tint" d="M6 7.5h12l-.9 11.2a2.2 2.2 0 0 1-2.2 2H9.1a2.2 2.2 0 0 1-2.2-2z"/><path class="icon-line" d="M4.5 7.5h15M9.5 7.5V5.6A1.6 1.6 0 0 1 11.1 4h1.8a1.6 1.6 0 0 1 1.6 1.6v1.9M6.4 7.5l.8 11.2a2.2 2.2 0 0 0 2.2 2h5.2a2.2 2.2 0 0 0 2.2-2l.8-11.2M10.2 11v6M13.8 11v6"/>${A(12, 4.2, 1.1)}`,
  back: `<path class="icon-tint" d="M10.2 5.6 4.4 12l5.8 6.4V5.6z"/><path class="icon-line" d="M19.5 12H5M10.6 6 4.6 12l6 6"/>${A(19.6, 12, 1.4)}`,
  xCircle: `<circle class="icon-tint" cx="12" cy="12" r="8.6"/><circle class="icon-line" cx="12" cy="12" r="8.6"/><path class="icon-line" d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4"/>${A(17.9, 6.1, 1.2)}`,
  ban: `<circle class="icon-tint" cx="12" cy="12" r="8.6"/><circle class="icon-line" cx="12" cy="12" r="8.6"/><path class="icon-line" d="M6 6l12 12"/>${A(18, 18.2, 1.3)}`,
  key: `<circle class="icon-tint" cx="8.4" cy="14.6" r="4.6"/><circle class="icon-line" cx="8.4" cy="14.6" r="4.6"/><path class="icon-line" d="m11.7 11.3 7.6-7.6M16.2 6.8l2.6 2.6M13.6 9.4l2.2 2.2"/>${A(8.4, 14.6, 1.4)}`,
  save: `<path class="icon-tint" d="M4 6.4A2.4 2.4 0 0 1 6.4 4h9.2L20 8.4v9.2a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 17.6z"/><path class="icon-line" d="M4 6.4A2.4 2.4 0 0 1 6.4 4h9.2L20 8.4v9.2a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 17.6zM8 4v4.6h7V4M8 20v-5.4h8V20"/>${A(16.8, 16.6, 1.3)}`,
  trophy: `<path class="icon-tint" d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z"/><path class="icon-line" d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0zM7.5 6H4.6a2.6 2.6 0 0 0 2.9 3.6M16.5 6h2.9a2.6 2.6 0 0 1-2.9 3.6M12 13.7V17M8.6 20h6.8M9.4 17h5.2"/>${A(12, 7.2, 1.4)}`,
  kanban: `<rect class="icon-tint" x="3" y="3.5" width="18" height="17" rx="3"/><rect class="icon-line" x="3" y="3.5" width="18" height="17" rx="3"/><path class="icon-line" d="M9 3.5v17M15 3.5v17"/><path class="icon-line" d="M5.4 7.2h1.2M5.4 10.6h1.2M11.4 7.2h1.2M17.4 7.2h1.2M17.4 10.6h1.2M17.4 14h1.2"/>${A(12, 11.4, 1.3)}`,
  filter: `<path class="icon-tint" d="M4 5h16l-6.2 7.4v5.4L10.2 20v-7.6z"/><path class="icon-line" d="M4 5h16l-6.2 7.4v5.4L10.2 20v-7.6z"/>${A(18.6, 5.2, 1.3)}`,
  listCheck: `<path class="icon-tint" d="M3.5 5.6h5v5h-5zM3.5 13.4h5v5h-5z"/><path class="icon-line" d="M11.5 7.5H20M11.5 16.4H20M3.5 5.6h5v5h-5zM3.5 13.4h5v5h-5z"/><path class="icon-line" d="m4.8 15.9 1.2 1.2 2.1-2.4"/>${A(19.6, 12, 1.2)}`,
  reply: `<path class="icon-tint" d="M9.6 5.4 3.8 10.6l5.8 5.2v-3.3c4.6 0 8 1.7 10.4 5.4-.6-5.2-3.7-9.4-10.4-9.9z"/><path class="icon-line" d="M9.6 5.4 3.8 10.6l5.8 5.2v-3.3c4.6 0 8 1.7 10.4 5.4-.6-5.2-3.7-9.4-10.4-9.9z"/>${A(18.6, 6.2, 1.2)}`,
  video: `<rect class="icon-tint" x="3" y="6.5" width="12.5" height="11" rx="2.6"/><rect class="icon-line" x="3" y="6.5" width="12.5" height="11" rx="2.6"/><path class="icon-line" d="m15.5 10.2 4.2-2.4v8.4l-4.2-2.4"/>${A(7.2, 10.6, 1.3)}`,
  minus: `<circle class="icon-tint" cx="12" cy="12" r="8.6"/><circle class="icon-line" cx="12" cy="12" r="8.6"/><path class="icon-line" d="M8 12h8"/>${A(17.9, 6.1, 1.2)}`,
  users: `<circle class="icon-tint" cx="9.2" cy="8.4" r="3.6"/><circle class="icon-line" cx="9.2" cy="8.4" r="3.6"/><path class="icon-line" d="M3 19.5a6.2 6.2 0 0 1 12.4 0M15.3 5.2a3.4 3.4 0 0 1 0 6.4M17.6 13.6A5.3 5.3 0 0 1 21 18.6"/>${A(17.8, 8.4, 1.3)}`,
  wand: `<path class="icon-tint" d="m4 18.6 10.2-10.2 1.4 1.4L5.4 20z"/><path class="icon-line" d="m4 18.6 10.2-10.2 1.4 1.4L5.4 20zM13 4.6v2.6M18.8 10.4h2.6M17.4 6l-1.8 1.8"/>${A(17.4, 6.4, 1.5)}`,
  overview: `<rect class="icon-tint" x="3" y="3" width="8.4" height="8.4" rx="2.6"/><rect class="icon-tint" x="3" y="13.6" width="8.4" height="7.4" rx="2.4"/><rect class="icon-tint" x="13.6" y="10.6" width="7.4" height="10.4" rx="2.6"/><rect class="icon-line" x="3" y="3" width="8.4" height="8.4" rx="2.6"/><rect class="icon-line" x="13.6" y="3" width="7.4" height="5.4" rx="2.2"/><rect class="icon-line" x="13.6" y="10.6" width="7.4" height="10.4" rx="2.6"/><rect class="icon-line" x="3" y="13.6" width="8.4" height="7.4" rx="2.4"/>${A(17.3, 5.7, 1.3)}`,
  discover: `<circle class="icon-tint" cx="11" cy="11" r="7"/><circle class="icon-line" cx="11" cy="11" r="7"/><path class="icon-line" d="m16.2 16.2 4.3 4.3"/><path class="icon-line" d="M7.6 10.4a3.6 3.6 0 0 1 2.9-2.9"/>${A(13.4, 8.6, 1.4)}`,
  globe: `<circle class="icon-tint" cx="12" cy="12" r="9"/><circle class="icon-line" cx="12" cy="12" r="9"/><path class="icon-line" d="M3.4 12h17.2M12 3a13.6 13.6 0 0 1 0 18M12 3a13.6 13.6 0 0 0 0 18"/>${A(17.4, 6.6, 1.4)}`,
  database: `<ellipse class="icon-tint" cx="12" cy="6.2" rx="7.5" ry="3"/><path class="icon-tint" d="M4.5 6.2v11.6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6.2c0 1.7-3.4 3-7.5 3s-7.5-1.3-7.5-3z"/><ellipse class="icon-line" cx="12" cy="6.2" rx="7.5" ry="3"/><path class="icon-line" d="M4.5 6.2v11.6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6.2M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>${A(12, 6.2, 1.2)}`,
  grid: `<rect class="icon-tint" x="3" y="3" width="8" height="8" rx="2.2"/><rect class="icon-tint" x="13" y="13" width="8" height="8" rx="2.2"/><rect class="icon-line" x="3" y="3" width="8" height="8" rx="2.2"/><rect class="icon-line" x="13" y="3" width="8" height="8" rx="2.2"/><rect class="icon-line" x="3" y="13" width="8" height="8" rx="2.2"/><rect class="icon-line" x="13" y="13" width="8" height="8" rx="2.2"/>${A(17, 7, 1.3)}`,
  prospects: `<circle class="icon-tint" cx="9.2" cy="8.2" r="3.6"/><path class="icon-tint" d="M2.8 20c.4-3.9 2.9-6 6.4-6s6 2.1 6.4 6Z"/><circle class="icon-line" cx="9.2" cy="8.2" r="3.6"/><path class="icon-line" d="M2.8 20c.4-3.9 2.9-6 6.4-6s6 2.1 6.4 6"/><path class="icon-line" d="M16.2 4.9a3.3 3.3 0 0 1 0 6.3M18.6 14.6c1.7.8 2.5 2.4 2.7 5"/>${A(17.4, 8.1, 1.3)}`,
  pipeline: `<rect class="icon-tint" x="3" y="4" width="5.2" height="16" rx="1.9"/><rect class="icon-tint" x="9.4" y="4" width="5.2" height="11" rx="1.9"/><rect class="icon-tint" x="15.8" y="4" width="5.2" height="7" rx="1.9"/><rect class="icon-line" x="3" y="4" width="5.2" height="16" rx="1.9"/><rect class="icon-line" x="9.4" y="4" width="5.2" height="11" rx="1.9"/><rect class="icon-line" x="15.8" y="4" width="5.2" height="7" rx="1.9"/>${A(18.4, 15.6, 1.5)}`,
  briefings: `<rect class="icon-tint" x="3.5" y="5" width="17" height="16" rx="3.4"/><rect class="icon-line" x="3.5" y="5" width="17" height="16" rx="3.4"/><path class="icon-line" d="M3.5 10h17M8 3v3.5M16 3v3.5"/><path class="icon-line" d="M7.5 14.5h3M7.5 17.5h6"/>${A(16.4, 15.8, 1.5)}`,
  calendar: `<rect class="icon-tint" x="3.5" y="5" width="17" height="16" rx="3"/><rect class="icon-line" x="3.5" y="5" width="17" height="16" rx="3"/><path class="icon-line" d="M3.5 10h17M8 3v3.5M16 3v3.5"/>${A(16, 16, 1.5)}`,
  mail: `<rect class="icon-tint" x="3" y="5" width="18" height="14" rx="3"/><rect class="icon-line" x="3" y="5" width="18" height="14" rx="3"/><path class="icon-line" d="m4.2 7.6 7.8 5.6 7.8-5.6"/>${A(18, 8, 1.3)}`,
  send: `<path class="icon-tint" d="m21 3-9.5 9.5L4 9.6 21 3Z"/><path class="icon-line" d="M21 3 3.8 9.4l7.7 3.1 3.1 7.7L21 3Z"/><path class="icon-line" d="M21 3 11.5 12.5"/>${A(6.2, 17.8, 1.4)}`,
  partners: `<circle class="icon-tint" cx="8.6" cy="8.4" r="3.4"/><circle class="icon-tint" cx="16.4" cy="9.6" r="2.7"/><circle class="icon-line" cx="8.6" cy="8.4" r="3.4"/><circle class="icon-line" cx="16.4" cy="9.6" r="2.7"/><path class="icon-line" d="M2.6 20c.3-3.6 2.7-5.8 6-5.8 2 0 3.6.8 4.6 2.1M13.4 19.6c.4-2.3 1.7-3.6 3.6-3.6 2 0 3.4 1.3 3.8 3.6"/>${A(12.6, 5.2, 1.3)}`,
  proposals: `<path class="icon-tint" d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8Z"/><path class="icon-line" d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8Z"/><path class="icon-line" d="M14 2v6h6M8 13h8M8 17h5"/>${A(16.2, 17.2, 1.4)}`,
  analytics: `<rect class="icon-tint" x="4.5" y="12" width="3.4" height="8" rx="1.5"/><rect class="icon-tint" x="10.3" y="7" width="3.4" height="13" rx="1.5"/><rect class="icon-tint" x="16.1" y="3.5" width="3.4" height="16.5" rx="1.5"/><rect class="icon-line" x="4.5" y="12" width="3.4" height="8" rx="1.5"/><rect class="icon-line" x="10.3" y="7" width="3.4" height="13" rx="1.5"/><rect class="icon-line" x="16.1" y="3.5" width="3.4" height="16.5" rx="1.5"/><path class="icon-line" d="M3 21h18"/>${A(17.8, 1.9, 1.3)}`,
  trend: `<path class="icon-tint" d="M4 18.5h16V9.4l-4.5 4.8-3.3-2.5L8 16.2Z"/><path class="icon-line" d="M4 18.5h3l3.3-5.2 3.2 2.4 5.5-7.8"/><path class="icon-line" d="M15.4 7.9H19v3.6"/>${A(19, 7.9, 1.5)}`,
  activity: `<path class="icon-tint" d="M3 12.5h4.2l2.6-6.5 4.4 12 2.8-5.5H21v4H3Z"/><path class="icon-line" d="M3 12h4.2l2.6-7 4.4 14 2.8-7H21"/>${A(14.2, 19, 1.4)}`,
  settings: `<circle class="icon-tint" cx="12" cy="12" r="7.6"/><path class="icon-line" d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path class="icon-line" d="M19.3 14.9a7.7 7.7 0 0 0 0-5.8l1.6-1.3-1.9-3.3-2 .7a7.7 7.7 0 0 0-5-2.9L11.7 1h-3.8l-.3 2.1a7.7 7.7 0 0 0-5 2.9l-2-.7-1.9 3.3 1.6 1.3a7.7 7.7 0 0 0 0 5.8L.7 16.2l1.9 3.3 2-.7a7.7 7.7 0 0 0 5 2.9l.3 2.1h3.8l.3-2.1a7.7 7.7 0 0 0 5-2.9l2 .7 1.9-3.3-1.6-1.3Z" transform="translate(2.1 .9) scale(.9)"/>${A(12, 12, 1.2)}`,
  search: `<circle class="icon-tint" cx="10.5" cy="10.5" r="6.4"/><circle class="icon-line" cx="10.5" cy="10.5" r="6.4"/><path class="icon-line" d="m15.3 15.3 5.2 5.2"/>${A(12.8, 8.2, 1.3)}`,
  plus: `<circle class="icon-tint" cx="12" cy="12" r="8.6"/><circle class="icon-line" cx="12" cy="12" r="8.6"/><path class="icon-line" d="M12 8v8M8 12h8"/>`,
  arrow: `<path class="icon-line" d="M5 12h14m-6.5-6.5L19 12l-6.5 6.5"/>${A(19, 12, 1.3)}`,
  download: `<path class="icon-tint" d="M7.5 10 12 14.5 16.5 10Z"/><path class="icon-line" d="M12 3.5v11m-4.5-4.5 4.5 4.5 4.5-4.5M4.5 20.5h15"/>${A(19.5, 20.5, 1.3)}`,
  upload: `<path class="icon-tint" d="M7.5 8 12 3.5 16.5 8Z"/><path class="icon-line" d="M12 14.5v-11m-4.5 4.5L12 3.5 16.5 8M4.5 20.5h15"/>${A(19.5, 20.5, 1.3)}`,
  link: `<path class="icon-tint" d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2Z"/><path class="icon-line" d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2"/>${A(12, 12, 1.2)}`,
  lock: `<rect class="icon-tint" x="4.5" y="10" width="15" height="11" rx="3"/><rect class="icon-line" x="4.5" y="10" width="15" height="11" rx="3"/><path class="icon-line" d="M8 10V7.2a4 4 0 0 1 8 0V10"/>${A(12, 15.6, 1.5)}`,
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 8a4.5 4.5 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  shield: `<path class="icon-tint" d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path class="icon-line" d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path class="icon-line" d="m9 12 2 2 4-4"/>${A(16.5, 6.4, 1.2)}`,
  logout: `<path class="icon-tint" d="M12 3h6a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 18 21h-6Z"/><path class="icon-line" d="M12 3h6a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 18 21h-6"/><path class="icon-line" d="m9.5 16.5 4.5-4.5-4.5-4.5M14 12H3"/>${A(14, 12, 1.3)}`,
  play: `<path class="icon-tint" d="M8.5 5.8v12.4L18.2 12z"/><path class="icon-line" d="M8.5 5.8v12.4L18.2 12z"/>${A(10.5, 9, 1.1)}`,
  trendingUp: `<path class="icon-tint" d="M3.5 17.5l6-6 4 4 7-7v9z"/><path class="icon-line" d="M3.5 17.5l6-6 4 4 7-7"/><path class="icon-line" d="M15.5 8.5h5v5"/>${A(9.5, 11.5, 1.1)}`,
  clock: `<circle class="icon-tint" cx="12" cy="12" r="9"/><circle class="icon-line" cx="12" cy="12" r="9"/><path class="icon-line" d="M12 7v5l3.2 2"/>${A(12, 12, 1.2)}`,
  building: `<rect class="icon-tint" x="4" y="3" width="16" height="18" rx="2.6"/><rect class="icon-line" x="4" y="3" width="16" height="18" rx="2.6"/><path class="icon-line" d="M9 7.5h2m3 0h2M9 11.5h2m3 0h2M9 15.5h2m3 0h2M10 21v-2.5h4V21"/>${A(16, 7.5, 1.1)}`,
  bell: `<path class="icon-tint" d="M18 9.2a6 6 0 0 0-12 0c0 6-2.4 7-2.4 8.3h16.8C20.4 16.2 18 15.2 18 9.2Z"/><path class="icon-line" d="M18 9.2a6 6 0 0 0-12 0c0 6-2.4 7-2.4 8.3h16.8C20.4 16.2 18 15.2 18 9.2Z"/><path class="icon-line" d="M10 20.5a2.2 2.2 0 0 0 4 0"/>${A(17.6, 5.2, 1.5)}`,
  edit: `<path class="icon-tint" d="M5 16.2 16 5.2l3 3L8 19.2l-4 .8Z"/><path class="icon-line" d="m16 4 4 4M4 20l4-.8L19 8.2a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/>${A(18, 6, 1.2)}`,
  check: `<path class="icon-line" d="m5 12.5 4.2 4.2L19 6.5"/>${A(19, 6.5, 1.3)}`,
  checkCircle: `<circle class="icon-tint" cx="12" cy="12" r="9"/><circle class="icon-line" cx="12" cy="12" r="9"/><path class="icon-line" d="m8 12.2 2.6 2.6L16 9.4"/>${A(16, 9.4, 1.2)}`,
  external: `<path class="icon-tint" d="M3 8a2.5 2.5 0 0 1 2.5-2.5H11v2.3H5.5V18.5h10.3V13H18v5.5A2.5 2.5 0 0 1 15.5 21h-10A2.5 2.5 0 0 1 3 18.5Z"/><path class="icon-line" d="M14 3h7v7m0-7-9.5 9.5"/><path class="icon-line" d="M18 13.5v5A2.5 2.5 0 0 1 15.5 21h-10A2.5 2.5 0 0 1 3 18.5v-10A2.5 2.5 0 0 1 5.5 6H11"/>${A(21, 3, 1.3)}`,
  paperclip: `<path class="icon-line" d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/>${A(21.4, 11.1, 1.2)}`,
  spark: `<path class="icon-tint" d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path class="icon-line" d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path class="icon-line" d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>${A(12, 10, 1.4)}`,
  menu: `<path class="icon-line" d="M4 6.5h16M4 12h16M4 17.5h16"/>${A(20, 12, 1.3)}`,
  close: `<path class="icon-line" d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>`,
  info: `<circle class="icon-tint" cx="12" cy="12" r="9"/><circle class="icon-line" cx="12" cy="12" r="9"/><path class="icon-line" d="M12 11v5.2"/>${A(12, 7.8, 1.3)}`,
  phone: `<path class="icon-tint" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z"/><path class="icon-line" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z"/>${A(17.2, 6.8, 1.3)}`,
  eye: `<path class="icon-tint" d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><path class="icon-line" d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle class="icon-line" cx="12" cy="12" r="2.8"/>${A(13.2, 10.8, 1.1)}`,
  target: `<circle class="icon-tint" cx="12" cy="12" r="8.5"/><circle class="icon-line" cx="12" cy="12" r="8.5"/><circle class="icon-line" cx="12" cy="12" r="4.2"/>${A(12, 12, 1.5)}`,
  dots: `<circle class="icon-tint" cx="5" cy="12" r="2.2"/><circle class="icon-tint" cx="19" cy="12" r="2.2"/><circle class="icon-line" cx="5" cy="12" r="2.2"/><circle class="icon-line" cx="12" cy="12" r="2.2"/><circle class="icon-line" cx="19" cy="12" r="2.2"/>${A(12, 12, 1.1)}`
};
function svgIcon(name, className = '') { const classes = ['icon-svg', className].filter(Boolean).join(' '); return `<svg class="${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || icons.spark}</svg>`; }

function stagePill(stage) { return `<span class="stage-pill ${stageClass(stage)}">${esc(stage)}</span>`; }
function statusPill(status) { return `<span class="status-pill ${status === 'Confirmed' ? 'status-confirmed' : status === 'Requested' ? 'status-requested' : status === 'Declined' ? 'status-declined' : ''}">${esc(status)}</span>`; }
function bookingLink(lead) { return `${location.origin}/track/cta/${encodeURIComponent(lead.bookingToken || '')}`; }
function bookingPageLink(lead) { return `${location.origin}/book/${encodeURIComponent(lead.bookingToken || '')}`; }
function optOutLink(lead) { return `${location.origin}/opt-out/${encodeURIComponent(lead.bookingToken || '')}`; }
function proposalLink(lead) { return lead?.proposalToken ? `${location.origin}/proposal/${encodeURIComponent(lead.proposalToken)}` : ''; }
function stripProposalLinks(body) {
  return String(body || '').split(/\r?\n/)
    .filter(line => !/\/track\/proposal\/|\/api\/public\/proposal\/|\/proposal\/[a-f0-9]{40,}/i.test(line))
    .filter(line => !/^(A tailored proposal is ready to review:|For context, here is the tailored proposal:|Review the tailored proposal:)\s*$/i.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function emailBodyForAttachmentMode(body, attachProposal = false) {
  const lines = stripProposalLinks(body).split(/\r?\n/).filter(line => attachProposal || !/(?:proposal|pdf).{0,60}(?:attach|enclos)|(?:attach|enclos).{0,60}(?:proposal|pdf)/i.test(line));
  let output = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (attachProposal && !/proposal.{0,40}attached|attached.{0,40}proposal/i.test(output)) output += '\n\nThe personalised Chelo proposal PDF is attached for context.';
  return output;
}
function followUpPdfSelected(lead) {
  return Boolean(lead?.proposalFile && (state.modal?.attachProposal ?? lead?.followUpDraft?.attachProposal));
}
function proposalDownload(lead) { return `/api/leads/${encodeURIComponent(lead.id)}/proposal/download`; }
function proposalPreview(lead) { return `/api/leads/${encodeURIComponent(lead.id)}/proposal/preview`; }
function attachedEmailDraft(lead, followUp) { return `/api/leads/${encodeURIComponent(lead.id)}/email/eml?kind=${followUp ? 'follow-up' : 'initial'}`; }
function safeUrl(url) {
  try { const parsed = new URL(url); if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href; } catch {}
  return '';
}

const TECHNICAL_VIEWS = []; // engine tabs inside Ops are gated per tab (see OPS_TABS / opsTabs)
const ROOT_ONLY_OPS_TABS = ['health', 'deliverability', 'data'];
function isRoot() { return Boolean(state.auth.isRoot || state.auth.demoAccess); }
function isPrimaryRoot() { return Boolean(state.auth.isPrimaryRoot || state.auth.demoAccess); }
function deskNavItems(builders) { return deskNav().filter(v => builders[v]).map(v => builders[v]()).join(''); }
function navItem(view, title, icon, count = null) {
  if (TECHNICAL_VIEWS.includes(view) && !isRoot()) return '';
  return `<button type="button" class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" aria-label="${esc(title)}" title="${esc(title)}">
    <span class="nav-icon">${svgIcon(icon)}</span><span class="nav-label">${esc(title)}</span>${count != null && count > 0 ? `<span class="nav-count">${count}</span>` : ''}
  </button>`;
}
function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); }
function settingsSectionLabel(section) { return ({ mailbox: 'My mailbox', integrations: 'Integrations', team: 'Team & governance', briefings: 'Briefings', audit: 'Audit trail', research: 'Research', general: 'General' })[section] || (section ? section.charAt(0).toUpperCase() + section.slice(1) : ''); }

// ---- Command palette (⌘K / Ctrl+K) ----
const VIEW_META = [
  ['inbox', 'Inbox — replies and approvals', 'reply'], ['workbench', 'To do — funders that need you', 'wand'], ['overview', 'Today', 'overview'], ['projects', 'Projects', 'grid'],
  ['prospects', 'Funders — everyone we are talking to', 'prospects'], ['briefings', 'Briefings — who agreed to talk', 'briefings'], ['sent', 'Sent', 'mail'], ['partners', 'Partners — who already funds us', 'partners'],
  ['ops', 'Health — is the engine OK (root only)', 'activity'], ['settings', 'Settings', 'settings']
];
function paletteItems(query) {
  const viewMeta = VIEW_META.map(([v, label, icon]) => v === 'ops' && !isRoot() ? [v, 'Results', 'analytics'] : [v, label, icon]);
  const q = (query || '').trim().toLowerCase();
  const match = text => !q || text.toLowerCase().includes(q);
  const groups = [];
  const nav = viewMeta.filter(([, title]) => match(title)).map(([view, title, icon]) => ({ id: 'view:' + view, group: 'Go to', icon, title, hint: 'View', run: () => setView(view) }));
  if (nav.length) groups.push(['Go to', nav]);
  const actions = [
    { id: 'act:new-lead', icon: 'plus', title: 'Add prospect', hint: 'Action', run: () => openModal('lead-form') },
    { id: 'act:import', icon: 'upload', title: 'Import candidates from CSV', hint: 'Action', run: () => { setView('discover'); setTimeout(() => $('#candidate-csv')?.click(), 50); } },
    { id: 'view:pipeline', icon: 'kanban', title: 'Prospects board (pipeline)', hint: 'View', run: () => setView('pipeline') },
    { id: 'view:analytics', icon: 'analytics', title: 'Analytics', hint: 'View', run: () => setView('analytics') },
    ...(isRoot() ? [{ id: 'view:deliverability', icon: 'shield', title: 'Deliverability & sending engine', hint: 'View', run: () => setView('deliverability') }, { id: 'view:data', icon: 'database', title: 'Data quality & merge reviews', hint: 'View', run: () => setView('data') }] : []),
    { id: 'act:copilot', icon: 'spark', title: 'Open POPIA copilot', hint: 'Action', run: () => openModal('copilot') },
    { id: 'act:briefings', icon: 'bell', title: 'Review briefing requests', hint: 'Action', run: () => setView('briefings') },
    { id: 'act:settings-team', icon: 'users', title: 'Team & approval policy', hint: 'Settings', run: () => { state.settingsSection = 'team'; setView('settings'); } },
    { id: 'act:settings-integrations', icon: 'link', title: 'Email & research integrations', hint: 'Settings', run: () => { state.settingsSection = 'integrations'; setView('settings'); } }
  ].filter(a => match(a.title));
  if (actions.length) groups.push(['Actions', actions]);
  if (q.length >= 2) {
    const leads = (state.data.leads || []).filter(l => match(`${l.company} ${l.contactName || ''} ${l.project || ''}`)).slice(0, 6)
      .map(l => ({ id: 'lead:' + l.id, icon: 'building', title: l.company, hint: l.stage || 'Prospect', run: () => openModal('lead-detail', l.id) }));
    if (leads.length) groups.push(['Prospects', leads]);
    const projects = (state.data.projects || []).filter(p => match(`${p.name} ${p.sector || ''} ${p.province || ''}`)).slice(0, 4)
      .map(p => ({ id: 'project:' + p.id, icon: 'grid', title: p.name, hint: p.province || 'Project', run: () => openModal('project-detail', p.id) }));
    if (projects.length) groups.push(['Projects', projects]);
    const partners = (state.data.partners || []).filter(p => match(p.company || '')).slice(0, 4)
      .map(p => ({ id: 'partner:' + p.id, icon: 'partners', title: p.company, hint: 'Partner', run: () => openModal('partner', p.id) }));
    if (partners.length) groups.push(['Partners', partners]);
  }
  return groups;
}
function renderPalette() {
  if (!state.palette) return '';
  const groups = paletteItems(state.palette.query);
  const flat = groups.flatMap(([, items]) => items);
  const active = Math.min(state.palette.index || 0, Math.max(flat.length - 1, 0));
  let i = 0;
  const list = groups.length ? groups.map(([name, items]) => `<div class="cmdk-group">${esc(name)}</div>${items.map(item => { const idx = i++; return `<button type="button" class="cmdk-item ${idx === active ? 'is-active' : ''}" data-cmdk="${esc(item.id)}" data-index="${idx}">${svgIcon(item.icon)}<span>${esc(item.title)}</span><small>${esc(item.hint || '')}</small></button>`; }).join('')}`).join('')
    : `<div class="cmdk-empty">No matches for “${esc(state.palette.query)}”</div>`;
  return `<div class="cmdk-backdrop" id="cmdk-backdrop" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="cmdk">
      <div class="cmdk-input">${svgIcon('search')}<input id="cmdk-input" type="text" autocomplete="off" spellcheck="false" placeholder="Jump to a view, prospect, project or action…" value="${esc(state.palette.query)}" /><kbd class="kbd">esc</kbd></div>
      <div class="cmdk-list" id="cmdk-list">${list}</div>
      <div class="cmdk-foot"><span><kbd class="kbd">↑↓</kbd>navigate</span><span><kbd class="kbd">↵</kbd>open</span><span><kbd class="kbd">esc</kbd>close</span></div>
    </div>
  </div>`;
}
function openPalette(query = '') { state.palette = { query, index: 0 }; renderPalette_mount(); }
function closePalette() { state.palette = null; renderPalette_mount(); }
function renderPalette_mount() {
  let root = document.getElementById('cmdk-root');
  if (!root) { root = document.createElement('div'); root.id = 'cmdk-root'; document.body.appendChild(root); }
  root.innerHTML = renderPalette();
  const input = document.getElementById('cmdk-input');
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}
function runPaletteItem(id) {
  const item = paletteItems(state.palette?.query).flatMap(([, items]) => items).find(i => i.id === id);
  closePalette();
  if (item) item.run();
}
document.addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && (event.key === 'k' || event.key === 'K')) { event.preventDefault(); if (!document.getElementById('app')) return; state.palette ? closePalette() : openPalette(); return; }
  if (!state.palette) return;
  const flat = paletteItems(state.palette.query).flatMap(([, items]) => items);
  if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); state.palette.index = flat.length ? (state.palette.index + 1) % flat.length : 0; renderPalette_mount(); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); state.palette.index = flat.length ? (state.palette.index - 1 + flat.length) % flat.length : 0; renderPalette_mount(); }
  else if (event.key === 'Enter') { event.preventDefault(); const item = flat[state.palette.index]; if (item) runPaletteItem(item.id); }
}, true);
document.addEventListener('input', event => {
  if (event.target && event.target.id === 'cmdk-input' && state.palette) { state.palette.query = event.target.value; state.palette.index = 0; const list = document.getElementById('cmdk-list'); if (list) { list.innerHTML = renderPalette().match(/<div class="cmdk-list" id="cmdk-list">([\s\S]*)<\/div>\s*<div class="cmdk-foot">/)[1]; } }
});
document.addEventListener('click', event => {
  if (!state.palette) return;
  const item = event.target.closest('[data-cmdk]');
  if (item) { event.preventDefault(); runPaletteItem(item.dataset.cmdk); return; }
  if (event.target.id === 'cmdk-backdrop') closePalette();
});
document.addEventListener('mouseover', event => {
  if (!state.palette) return;
  const item = event.target.closest('.cmdk-item');
  if (item && Number(item.dataset.index) !== state.palette.index) { state.palette.index = Number(item.dataset.index); document.querySelectorAll('.cmdk-item').forEach(el => el.classList.toggle('is-active', el === item)); }
});

function shellHeader() {
  const label = ({ workbench: 'To do', review: 'Read & send', inbox: 'Inbox', ops: state.auth.isRoot ? 'Health' : 'Results', deliverability: 'Deliverability', data: 'Data quality', overview: 'Today', discover: 'To do', projects: 'Projects', prospects: 'Funders', pipeline: 'Funders', briefings: 'Briefings', sent: 'Sent', partners: 'Partners', proposals: 'Funders', analytics: 'Results', settings: 'Settings' , projects: deskWord('projects'), briefings: deskWord('briefings'), prospects: deskMeta().targetLabel || 'Funders' })[state.view] || 'Today';
  const pending = state.data.bookings.filter(b => b.status === 'Requested').length;
  return `<header class="topbar">
    <div class="breadcrumb"><button type="button" class="icon-button mobile-menu" data-action="mobile-menu" aria-label="Toggle navigation">${svgIcon('menu')}</button><button type="button" class="crumb-root" data-view="overview">${svgIcon('overview')}Workspace</button><span class="crumb-sep">/</span><strong>${label}</strong>${state.settingsSection && state.view === 'settings' ? `<span class="crumb-sep">/</span><span>${esc(settingsSectionLabel(state.settingsSection))}</span>` : ''}</div>
    <div class="topbar-right">
      <label class="top-search">${svgIcon('search')}<input id="global-search" type="search" placeholder="Search or jump to…" value="${esc(state.query)}" aria-label="Search" /><kbd class="kbd" title="Command palette">${isMac() ? '⌘' : 'Ctrl'} K</kbd></label>
      <span class="top-separator"></span>
      ${deskAllowsView('briefings') ? `<button type="button" class="icon-button" aria-label="Briefing requests" title="Briefing requests" data-view="briefings">${svgIcon('bell')}${pending ? '<span class="notification-dot"></span>' : ''}</button>` : ''}
      ${state.auth.demoAccess ? '<span class="demo-access-badge">DEMO ADMIN</span>' : ''}<span class="avatar top-avatar top-avatar-wrap" title="${esc(state.auth.displayName || state.auth.username || 'Administrator')} · ${esc(roleLabel(state.auth.role))}">${initials(state.auth.displayName || state.auth.username || 'Administrator')}</span>
      ${state.auth.openAccessDemo ? '' : `<button type="button" class="icon-button sign-out-button" data-action="logout" aria-label="Sign out" title="Sign out">${svgIcon('logout')}</button>`}
    </div>
  </header>`;
}
function shellSidebar() {
  const pending = state.data.bookings.filter(b => b.status === 'Requested').length;
  return `<aside class="sidebar">
    <a class="brand" href="#" data-view="overview"><span class="brand-symbol">${BRAND_MARK}</span><span class="brand-copy"><span class="brand-name">Chelo</span><span class="brand-tag">Communication Center</span></span></a>
    ${deskSwitch()}
    <div class="nav-caption">${esc(myDesks().length > 1 ? deskMeta().title : 'Workspace')}</div>
    <nav class="nav-list" aria-label="Main navigation">
      ${deskNavItems({
        inbox: () => navItem('inbox', 'Inbox', 'reply', typeof window.inboxUnreadCount === 'function' ? window.inboxUnreadCount() : 0),
        workbench: () => navItem('workbench', 'To do', 'wand', state.data.leads.filter(l => simpleStatusOf(l) === 'your-turn' && wbStatusOf(l) !== 'new').length + state.data.candidates.filter(c => c.status === 'New candidate').length),
        overview: () => navItem('overview', 'Today', 'overview'),
        projects: () => navItem('projects', deskWord('projects'), 'grid', onSuppliers() ? state.data.projects.filter(p => p.tender && p.tender.status === 'open').length : state.data.projects.filter(p => p.funding?.fundingGap > 0).length),
        prospects: () => navItem('prospects', deskMeta().targetLabel || 'Funders', 'prospects'),
        'media-kit': () => `<button type="button" class="nav-item ${state.view === 'settings' && state.settingsSection === 'media-kit' ? 'active' : ''}" data-action="open-media-kit" title="Media kit"><span class="nav-icon">${svgIcon('fileText')}</span><span class="nav-label">Media kit</span></button>`,
        briefings: () => navItem('briefings', deskWord('briefings'), 'briefings', pending),
        sent: () => navItem('sent', 'Sent', 'mail'),
        partners: () => navItem('partners', 'Partners', 'partners')
      })}
      ${navItem('ops', isRoot() ? 'Health' : 'Results', 'activity', ((state.ops.data ? (state.ops.data.counts.critical + state.ops.data.counts.warn) : 0) + (state.data.mailboxes || []).filter(m => m.status === 'paused').length + (state.dq.data ? (state.dq.data.openMergeReviews || 0) : 0)) || null)}
      ${navItem('settings', 'Settings', 'settings')}
      <button type="button" class="nav-item mobile-more-button ${['projects','prospects','briefings','sent','partners','settings'].includes(state.view) ? 'active' : ''}" data-action="mobile-more" aria-label="More sections" aria-haspopup="dialog" aria-expanded="${state.mobileMoreOpen ? 'true' : 'false'}" title="More sections"><span class="nav-icon">${svgIcon('dots')}</span><span class="nav-label">More</span></button>
    </nav>
    <div class="sidebar-spacer"></div>
    <div class="sidebar-card"><span class="tiny-label">Outreach workflow</span><strong>Source · personalise · connect</strong><p>Review local and CSV candidates, keep source details, then build considered partnerships.</p><div class="sidebar-progress"><span></span></div></div>
    <div class="user-mini"><span class="avatar">${initials(state.auth.displayName || state.auth.username || 'Admin')}</span><span class="user-copy"><strong>${esc(state.auth.displayName || state.auth.username || 'Administrator')}</strong><small>${state.auth.demoAccess ? 'Demo administrator · full access' : `${esc(roleLabel(state.auth.role))} · ${state.auth.approvalPolicy === 'four-eyes' ? '4-eyes approvals' : 'Single approver'}`}</small></span></div>
  </aside>`;
}
function renderMobileMoreMenu() {
  if (!state.mobileMoreOpen) return '';
  const items = [
    ['projects', deskWord('projects'), 'grid'], ['prospects', deskMeta().targetLabel || 'Funders', 'prospects'], ['pipeline', 'Pipeline', 'pipeline'],
    ['briefings', deskWord('briefings'), 'briefings'], ['sent', 'Sent', 'mail'],
    ['partners', 'Partners', 'partners'],
    ['settings', 'Settings', 'settings']
  ].filter(([v]) => v === 'pipeline' ? deskAllowsView('prospects') && currentDesk() === 'csi' : deskAllowsView(v));
  return `<div class="mobile-more-backdrop" id="mobile-more-backdrop"><section class="mobile-more-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title"><div class="mobile-more-heading"><div><span class="eyebrow">Workspace</span><h2 id="mobile-more-title">More sections</h2></div><button type="button" class="close-button" data-action="mobile-more-close" aria-label="Close navigation">${svgIcon('close')}</button></div><div class="mobile-more-grid">${items.map(([view, label, icon]) => `<button type="button" class="mobile-more-link ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}><span class="mobile-more-icon">${svgIcon(icon)}</span><span>${label}</span>${state.view === view ? '<span class="mobile-more-current">Current</span>' : ''}</button>`).join('')}</div></section></div>`;
}
function renderApp() {
  if (typeof window.isPhone === 'function' && window.isPhone() && typeof window.renderMobileApp === 'function') return window.renderMobileApp();
  const app = $('#app');
  const demoWarning = state.auth.demoAccess ? `<div class="demo-admin-warning"><strong>${state.auth.openAccessDemo ? 'Open-access demo · full admin privileges.' : 'Demo admin · full access.'}</strong> Use only fictional sample data; do not enter real contacts, AI keys or SMTP credentials.</div>` : '';
  app.innerHTML = `<div class="app-shell">${shellSidebar()}<div class="main-shell">${shellHeader()}<main class="main-content">${demoWarning}${renderView()}</main></div>${renderMobileMoreMenu()}</div>`;
  $('#modal-root').innerHTML = renderModal();
}

function pageHead(eyebrow, title, subtitle, actions = '', variant = '') {
  // `eyebrow` is kept in the signature for callers/tests but is no longer rendered (decorative label).
  const variantClass = variant ? ` page-head-${variant}` : '';
  const sub = subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : '';
  return `<div class="page-head${variantClass}"><div><h1>${esc(title)}</h1>${sub}</div><div class="head-actions">${actions}</div></div>`;
}
function demoBanner() {
  if (state.auth.demoAccess) return '';
  const title = 'Demo workspace · sample data is fictional';
  const note = 'Lead research is source-tracked and human-reviewed. Approved emails can be sent through configured SMTP or handed off manually; preferred briefing times are confirmed by Chelo.';
  return `<div class="demo-banner"><div class="demo-banner-icon">${svgIcon('info')}</div><div><strong>${esc(title)}</strong><p>${esc(note)}</p></div><button class="dismiss" type="button" data-action="dismiss-demo" aria-label="Dismiss">${svgIcon('close')}</button></div>`;
}
function metricCard(label, value, foot, icon, change = '', warning = false) {
  const metricTones = { target: 'metric-icon-tone-cta', calendar: 'metric-icon-tone-booking', send: 'metric-icon-tone-action', trend: 'metric-icon-tone-pipeline' };
  const tone = metricTones[icon] || '';
  return `<div class="metric-card"><div class="metric-head"><span>${esc(label)}</span><span class="metric-icon ${tone}">${svgIcon(icon)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${change ? `<span class="metric-change ${warning ? 'warn' : ''}">${esc(change)}</span>` : ''}<span>${esc(foot)}</span></div></div>`;
}
function getActiveLeads() { return state.data.leads.filter(l => !['Won', 'Not proceeding'].includes(l.stage) && !l.doNotContact); }
function getPipelineValue() { return getActiveLeads().reduce((sum, l) => sum + Number(l.amount || 0), 0); }
function overviewView() {
  const radarPanel = radarView();
  const leads = state.data.leads;
  const active = getActiveLeads();
  const requests = state.data.bookings.filter(b => b.status === 'Requested');
  const upcoming = state.data.bookings.filter(b => ['Requested', 'Confirmed'].includes(b.status)).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 4);
  const followUps = leads.filter(l => l.followUpAt && !l.doNotContact).sort((a, b) => new Date(a.followUpAt) - new Date(b.followUpAt)).slice(0, 4);
  const stageHighlights = [
    ['Prospects', leads.filter(l => !['Won', 'Not proceeding'].includes(l.stage)).length, 'prospects'],
    ['In conversation', leads.filter(l => ['Contacted', 'Interested'].includes(l.stage)).length, 'pipeline'],
    ['Proposals out', leads.filter(l => l.stage === 'Proposal sent').length, 'proposals'],
    ['Briefings', state.data.bookings.filter(b => ['Requested', 'Confirmed'].includes(b.status)).length, 'briefings']
  ];
  const pipelineStages = ['Researched', 'Contacted', 'Interested', 'Proposal sent', 'Briefing requested', 'Briefing booked'];
  const max = Math.max(1, ...pipelineStages.map(s => leads.filter(l => l.stage === s).length));
  const recent = sortRecent(leads).slice(0, 5);
  const leadRows = recent.map(l => `<tr data-open-lead="${esc(l.id)}">
    <td><span class="company-name">${esc(l.company)}</span><span class="company-secondary">${esc(l.contactName || 'No contact added')} · ${esc(l.sector || 'Uncategorised')}</span></td>
    <td>${stagePill(l.stage)}</td><td class="amount-cell">${money(l.amount)}</td><td><span class="fit-score"><span class="fit-dot"></span>${Number(l.fitScore || 0)}% fit</span></td>
    <td><button class="table-action" type="button" data-action="open-lead" data-id="${esc(l.id)}">${svgIcon('eye')}View</button></td>
  </tr>`).join('');
  const bookingRows = upcoming.map(b => {
    const parts = dateParts(b.date);
  return `<div class="booking-item"><div class="date-tile"><strong>${parts.day}</strong><span>${esc(parts.month)}</span></div><div class="booking-copy"><strong>${esc(b.organization)}</strong><span>${esc(b.contactName)} · ${statusPill(b.status)}</span></div><div class="booking-time">${esc(b.time)}</div></div>`;
  }).join('');
  const followupRows = followUps.map(l => `<div class="shortcut-row"><div class="shortcut-icon">${svgIcon('mail')}</div><div class="shortcut-copy"><strong>${esc(l.company)}</strong><span>Follow-up ${Number(l.followUpStep || 1)} of 2 · ${isoDate(l.followUpAt)}</span></div><button type="button" class="panel-action" data-action="follow-up" data-id="${esc(l.id)}">${svgIcon('send')}Draft</button></div>`).join('');
  const today = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${pageHead('Today', 'Today', today, deskAddButton(), 'overview')}
    ${state.dismissDemo ? '' : demoBanner()}
    <section class="dashboard-grid">
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('clock')}Follow-up queue</h2></div><button class="panel-action" data-view="prospects">${svgIcon('prospects')}View prospects</button></div><div class="shortcut-list">${followupRows || `<div class="panel-empty"><strong>You're up to date</strong>No follow-up tasks are due yet.</div>`}</div></div>
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('calendar')}Upcoming briefings</h2></div><button class="panel-action" data-view="briefings">${svgIcon('settings')}Manage →</button></div><div class="booking-list">${bookingRows || `<div class="panel-empty"><strong>No briefings scheduled</strong>When a donor requests a time, it will appear here.</div>`}</div></div>
    </section>
    <section class="metric-grid">
      ${metricCard('Open prospects', String(active.length), 'in active pipeline', 'prospects', `${leads.length} total`, false)}
      ${metricCard('Potential pipeline', shortMoney(getPipelineValue()), 'estimated ask value', 'trend', 'ZAR', false)}
      ${metricCard('Briefing requests', String(requests.length), 'awaiting confirmation', 'calendar', requests.length ? 'Needs review' : 'All clear', Boolean(requests.length))}
      ${metricCard('Active partners', String(state.data.partners.filter(p => p.status !== 'Inactive').length), 'won relationships', 'partners', `${money(state.data.partners.reduce((s, p) => s + Number(p.amount || 0), 0))} total`, false)}
    </section>
    <section class="bottom-grid">
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('activity')}Pipeline pulse</h2></div><button class="panel-action" data-view="pipeline">${svgIcon('kanban')}Open board →</button></div>
        <div class="pipeline-summary">${stageHighlights.map(([name, count, target]) => `<div class="pipeline-stat"><span class="stage-name">${name}</span><strong>${count}</strong><div class="mini-bar"><span style="width:${Math.max(10, Math.min(100, (count / Math.max(1, leads.length)) * 100))}%"></span></div></div>`).join('')}</div>
        <div class="pipeline-list">${pipelineStages.map(s => { const count = leads.filter(l => l.stage === s).length; const val = leads.filter(l => l.stage === s).reduce((a, l) => a + Number(l.amount || 0), 0); return `<div class="pipeline-list-row"><span class="row-stage">${esc(s)}</span><div class="row-bar"><span style="width:${Math.max(2, Math.round((count / max) * 100))}%"></span></div><strong>${count} · ${shortMoney(val)}</strong></div>`; }).join('')}</div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('prospects')}Recently updated prospects</h2></div><button class="panel-action" data-view="prospects">${svgIcon('arrow')}See all →</button></div><div class="lead-table-wrap"><table class="table"><thead><tr><th>Organisation / contact</th><th>Stage</th><th>Potential ask</th><th>Fit</th><th></th></tr></thead><tbody>${leadRows || `<tr><td colspan="5" class="panel-empty">No prospects yet.</td></tr>`}</tbody></table></div></div>
    </section>${radarPanel}${signalsPanel()}`;
}

/** v70: the Suppliers list is an account register, not a pipeline. */
function supplierTable(leads) {
  const rows = leads.filter(isSupplierLead).map(l => {
    const sp = l.supplier || {}; const v = sp.vetting?.status || 'pending'; const a = l.account || {}; const d = a.documents || {};
    const vet = v === 'approved' ? '<span class="stage-pill pill-won">Approved</span>' : v === 'rejected' ? '<span class="stage-pill pill-not-proceeding">Rejected</span>' : '<span class="stage-pill pill-interested">Vetting</span>';
    const docs = d.items ? `${d.received}/${d.items.length}${d.insured ? ' · insured' : ' · <strong>no insurance</strong>'}${d.expired ? ` · ${d.expired} expired` : d.expiring ? ` · ${d.expiring} expiring` : ''}` : '—';
    return `<tr><td><strong>${esc(l.company)}</strong><span class="company-secondary">${esc(l.contactName || '')}${l.phone ? ` · ${esc(l.phone)}` : ''}</span></td><td>${esc((sp.trades || []).map(t => TRADE_LABELS[t] || t).join(', '))}<span class="company-secondary">${esc(sp.location?.town || (sp.provinces || []).join(', '))}${sp.location?.radiusKm ? ` · ${sp.location.radiusKm} km` : ''}</span></td><td>${vet}</td><td>${docs}</td><td>${a.done ?? 0} done · ${a.signed ?? 0} awarded<span class="company-secondary">R ${Math.round(a.awardedValue || 0).toLocaleString('en-ZA')}${a.places?.length ? ` · ${esc(a.places.slice(0, 2).join(', '))}` : ''}</span></td><td><button type="button" class="button button-ghost button-small" data-action="sup-open" data-id="${esc(l.id)}">Open</button></td></tr>`;
  }).join('');
  return `<div class="panel lead-table-panel"><div class="lead-table-wrap"><table class="table"><thead><tr><th>Supplier</th><th>Trades · based in</th><th>Vetting</th><th>Documents</th><th>Jobs</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="panel-empty"><strong>No suppliers yet.</strong> Share the sign-up link.</div></td></tr>'}</tbody></table></div></div>`;
}
function filteredLeads() {
  const query = state.query.trim().toLowerCase();
  return sortRecent(state.data.leads).filter(l => {
    const matchesQuery = !query || [l.company, l.contactName, l.email, l.sector, l.project, l.sourceName, l.relationshipContext, l.partnerPriorities].join(' ').toLowerCase().includes(query);
    const matchesStage = state.stageFilter === 'All stages' || l.stage === state.stageFilter;
    return matchesQuery && matchesStage;
  });
}
function leadTableRows(leads) {
  return leads.map(l => {
    const freshness = verificationFreshness(l.contactLastVerifiedAt, 'Staff contact');
    return `<tr data-open-lead="${esc(l.id)}">
      <td><span class="company-name">${esc(l.company)}</span><span class="company-secondary">${esc(l.contactName || 'Contact to identify')} · ${esc(l.title || l.sector || 'Prospective donor')}</span><span class="company-secondary freshness-inline ${freshness.className}">${esc(freshness.text)}</span></td>
      <td>${stagePill(l.stage)}</td><td>${esc(l.project || '—')}</td><td class="amount-cell">${money(l.amount)}</td><td><span class="fit-score"><span class="fit-dot"></span>${Number(l.fitScore || 0)}%</span></td>
      <td><button class="table-action" type="button" data-action="create-outreach" data-id="${esc(l.id)}">${svgIcon('mail')}Prepare</button><button class="table-action" type="button" data-action="open-lead" data-id="${esc(l.id)}">${svgIcon('eye')}Details</button></td>
    </tr>`;
  }).join('');
}
function prospectsView() {
  const leads = filteredLeads();
  const stages = ['All stages', ...(state.data.stages || [])];
  const mode = state.prospectsMode === 'board' ? 'board' : 'table';
  const toggle = `<div class="view-toggle" role="tablist" aria-label="Layout"><button type="button" role="tab" class="view-toggle-btn ${mode === 'table' ? 'is-active' : ''}" data-action="prospects-mode" data-mode="table" aria-selected="${mode === 'table'}">${svgIcon('listCheck')} Table</button><button type="button" role="tab" class="view-toggle-btn ${mode === 'board' ? 'is-active' : ''}" data-action="prospects-mode" data-mode="board" aria-selected="${mode === 'board'}">${svgIcon('kanban')} Board</button></div>`;
  const body = onSuppliers() ? supplierTable(leads) : mode === 'board' ? pipelineBoard() : `<div class="panel lead-table-panel"><div class="lead-table-wrap"><table class="table"><thead><tr><th>Organisation / point of contact</th><th>Pipeline stage</th><th>Impact focus</th><th>Potential ask</th><th>Fit</th><th>Actions</th></tr></thead><tbody>${leadTableRows(leads) || `<tr><td colspan="6"><div class="panel-empty"><strong>No prospects match.</strong><p>Adjust the filters or add an organisation in the Workbench.</p></div></td></tr>`}</tbody></table></div></div>`;
  return `${pageHead('Funders', deskMeta().targetLabel || 'Funders', deskWord('prospectsBlurb'), deskAddButton())}
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="lead-search" type="search" placeholder="Search organisation, contact, project…" value="${esc(state.query)}" /></label>${mode === 'table' ? `<select class="select-control" id="stage-filter">${stages.map(s => `<option value="${esc(s)}" ${state.stageFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}</div><div class="control-right">${toggle}</div></div>
    ${body}`;
}
function discoverPanel() {
  const q = state.query.trim().toLowerCase();
  const candidates = sortRecent(state.data.candidates).filter(c => (state.candidateFilter === 'All candidates' || c.status === state.candidateFilter) && (!q || [c.company, c.contactName, c.email, c.sector, c.project, c.sourceName, c.notes, c.relationshipContext, c.partnerPriorities].join(' ').toLowerCase().includes(q)));
  const pending = state.data.candidates.filter(c => c.status === 'New candidate').length;
  const added = state.data.candidates.filter(c => c.status === 'Added to pipeline').length;
  const cards = candidates.map(c => {
    const source = safeUrl(c.sourceUrl);
    const wasAdded = Boolean(c.promotedLeadId || c.status !== 'New candidate');
    const check = c.contactCheck || { status: 'unchecked', issues: [] };
    const contactFreshness = verificationFreshness(c.contactLastVerifiedAt, 'Staff contact');
    const sourceFreshness = verificationFreshness(c.sourceLastVerifiedAt, 'Source');
    const healthLabel = check.status === 'ready' ? 'Domain checked · mailbox not verified' : check.status === 'needs-clarification' ? `Needs clarification${check.issues?.length ? ` · ${check.issues.join(', ')}` : ''}` : check.status === 'retry-required' ? 'DNS check needs retry' : 'Contact check not run';
    const healthClass = check.status === 'ready' ? 'candidate-health-ready' : check.status === 'retry-required' ? 'candidate-health-retry' : 'candidate-health-pending';
    const intakeAction = `<button class="button button-primary button-small" data-action="promote-candidate" data-id="${esc(c.id)}" title="${check.status === 'ready' ? 'Check the address, research and draft' : 'No usable email yet — Chelo will look for their published mailbox first'}">${svgIcon('spark')}Add & run</button>${check.status === 'ready' ? '' : `<button class="button button-ghost button-small" data-action="candidate-review" data-id="${esc(c.id)}">${svgIcon('edit')}Add details</button>`}`;
    const pick = wasAdded ? '' : `<label class="candidate-pick"><input type="checkbox" data-pool-pick="${esc(c.id)}" ${state.wb.poolPicks?.includes(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.company)}" /></label>`;
    return `<article class="candidate-card ${wasAdded ? 'is-added' : ''}"><div class="candidate-card-main"><div class="candidate-org">${pick}<span class="candidate-avatar">${initials(c.company)}</span><div><h3>${esc(c.company)}</h3><span class="candidate-contact">${esc(c.contactName || 'Contact to verify')} · ${esc(c.title || c.sector || 'Prospective funder')}</span></div></div><div class="candidate-badges"><span class="fit-score"><span class="fit-dot"></span>${Number(c.fitScore || 0)}% fit</span>${wasAdded ? `<span class="status-pill status-confirmed">${esc(c.status)}</span>` : `<span class="status-pill status-requested">Review needed</span>`}</div><span class="candidate-health ${healthClass}">${esc(healthLabel)}</span><div class="verification-row"><span class="freshness-tag ${contactFreshness.className}">${esc(contactFreshness.text)}</span><span class="freshness-tag ${sourceFreshness.className}">${esc(sourceFreshness.text)}</span></div><p class="candidate-summary">${esc(c.notes || 'Review the source and confirm fit before adding this organisation.')}</p>${c.relationshipContext ? `<div class="candidate-context"><strong>Warm introduction:</strong> ${esc(c.relationshipContext)}</div>` : ''}${c.partnerPriorities ? `<div class="candidate-context"><strong>Partner priorities:</strong> ${esc(c.partnerPriorities)}</div>` : ''}<div class="candidate-meta"><span>${svgIcon('grid')}${esc(c.sector || 'Sector not set')}</span><span>${svgIcon('target')}${esc(c.project || 'Project not selected')}</span><span>${svgIcon('building')}${esc(c.sourceName || 'Source not supplied')}</span></div></div><div class="candidate-card-side"><div><small>Suggested ask · staff to confirm</small><strong>${money(c.amount)}</strong></div><div class="candidate-links">${source ? `<a class="text-link" href="${esc(source)}" target="_blank" rel="noopener noreferrer">View source ${svgIcon('external')}</a>` : `<span class="subtle">No source URL provided</span>`}${c.email ? `<a class="text-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</div>${wasAdded && c.promotedLeadId ? `<button class="button button-secondary button-small" data-action="open-lead" data-id="${esc(c.promotedLeadId)}">${svgIcon('eye')}Open pipeline record</button>` : wasAdded ? `<span class="subtle">Already in pipeline</span>` : `<div class="candidate-card-actions"><button class="button button-ghost button-small" data-action="candidate-review" data-id="${esc(c.id)}">${svgIcon('edit')}Edit details</button>${intakeAction}</div>`}</div></article>`;
  }).join('');
  const picks = (state.wb.poolPicks || []).filter(id => candidates.some(c => c.id === id && !c.promotedLeadId && c.status === 'New candidate'));
  const selectable = candidates.filter(c => !c.promotedLeadId && c.status === 'New candidate');
  return `<div class="wb-pool-head"><p class="subtle">Organisations from Chelo's own list and your CSV files. <strong>Add & run</strong> works exactly like adding one by hand: Chelo checks the email address (or looks for their published mailbox), researches them and writes the first draft. Tick several and run them together.</p><div class="head-actions"><button class="button button-primary button-small" data-action="pool-run-selected" ${picks.length && !state.wb.busy.pool ? '' : 'disabled'}>${svgIcon('spark')}${state.wb.busy.pool ? 'Adding…' : `Add & run selected${picks.length ? ` (${picks.length})` : ''}`}</button><button class="button button-ghost button-small" data-action="pool-select-all" ${selectable.length ? '' : 'disabled'}>${svgIcon('check')}${picks.length && picks.length === selectable.length ? 'Clear selection' : `Select all shown (${selectable.length})`}</button><button class="button button-secondary button-small" data-action="candidate-import">${svgIcon('download')} Import CSV</button><a class="button button-ghost button-small" href="/sample-leads.csv" download>${svgIcon('download')} CSV template</a></div></div>
    ${cataloguePanel()}
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="candidate-search" type="search" placeholder="Search candidates, contacts, projects…" value="${esc(state.query)}" /></label><select class="select-control" id="candidate-filter"><option value="All candidates" ${state.candidateFilter === 'All candidates' ? 'selected' : ''}>All candidates (${state.data.candidates.length})</option><option value="New candidate" ${state.candidateFilter === 'New candidate' ? 'selected' : ''}>Awaiting review (${pending})</option><option value="Added to pipeline" ${state.candidateFilter === 'Added to pipeline' ? 'selected' : ''}>Added (${added})</option></select></div></div>
    <div class="candidate-list">${cards || `<div class="empty-state"><div class="empty-state-icon">${svgIcon('globe')}</div><strong>No candidates found</strong><p>Import a CSV or add records to the local candidate database.</p></div>`}</div>
    <input type="file" id="candidate-csv" accept=".csv,text/csv" hidden />`;
}
function sentView() {
  const messages = state.data.messages || [];
  const events = state.data.emailEvents || [];
  const initial = messages.filter(m => m.kind === 'initial' && m.sentAt);
  const recipients = new Set(initial.map(m => m.leadId));
  const relevantEvents = events.filter(e => recipients.has(e.leadId));
  const uniqueRecipients = type => new Set(relevantEvents.filter(e => e.type === type).map(e => e.leadId)).size;
  const clicks = new Set(relevantEvents.filter(e => e.type === 'click_cta').map(e => e.leadId)).size;
  const replies = uniqueRecipients('reply');
  const bookings = uniqueRecipients('booking');
  const total = recipients.size;
  const smtpSent = messages.filter(m => m.provider === 'SMTP' && m.status === 'Sent').length;
  const manualHandoffs = messages.filter(m => m.provider === 'email-client handoff' && m.status === 'Confirmed by staff').length;
  const trackedInitial = initial.filter(m => m.openTracked).length;
  const initialMessageIds = new Set(initial.map(message => message.id));
  const openedMessages = new Set(relevantEvents.filter(e => e.type === 'open' && initialMessageIds.has(e.messageId)).map(e => e.messageId)).size;
  const openRate = trackedInitial ? `${Math.round(openedMessages / trackedInitial * 100)}%` : 'Unavailable';
  const pct = n => total ? `${Math.round(n / total * 100)}%` : '0%';
  const rows = [...recipients].map(id => ({ lead: getLead(id), first: initial.filter(m => m.leadId === id).sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))[0] })).filter(x => x.lead).sort((a, b) => new Date(b.first.sentAt) - new Date(a.first.sentAt));
  return `${pageHead('Sent', 'Sent', 'Every email that went out. Replies are in the Inbox.', `<button class="button button-secondary" data-view="prospects">${svgIcon('prospects')} Open prospects</button>`)}
    <div class="provider-notice"><span class="provider-notice-icon">${svgIcon('info')}</span><div><strong>${state.data.settings?.smtpConfigured ? 'SMTP sending is available after approval' : 'SMTP is not configured yet'}</strong><p>${smtpSent} messages were accepted by SMTP; ${manualHandoffs} were confirmed as manual handoffs. Open counts use an approximate tracking pixel when a public HTTPS URL is configured; image blockers, caching and privacy proxies affect accuracy. “Yes — choose…” clicks are first-party CTA hits, and replies remain manually recorded.</p></div></div>
    <section class="metric-grid sent-metrics">${metricCard('Recipients', String(total), 'initial outreach confirmed', 'mail')}${metricCard('SMTP accepted', String(smtpSent), `${manualHandoffs} manual handoffs`, 'send')}${metricCard('Estimated open rate', openRate, `${openedMessages} unique tracked opens`, 'eye')}${metricCard('Yes CTA click rate', pct(clicks), `${clicks} recipients clicked “Yes — choose…”`, 'target')}${metricCard('Response rate', pct(replies), `${replies} replies recorded`, 'checkCircle')}${metricCard('Briefing rate', pct(bookings), `${bookings} briefing requests`, 'calendar')}</section>
    <div class="panel sent-panel"><div class="panel-header"><div><h2>Outreach history</h2><p>One row per recipient, with follow-up status and engagement events.</p></div><span class="subtle">${rows.length} recipient${rows.length === 1 ? '' : 's'}</span></div>${rows.length ? `<div class="lead-table-wrap"><table class="table sent-table"><thead><tr><th>Recipient</th><th>First handoff</th><th>Emails</th><th>Clicks</th><th>Reply</th><th>Briefing</th><th>Next follow-up</th><th>Actions</th></tr></thead><tbody>${rows.map(({ lead, first }) => {
      const leadEvents = relevantEvents.filter(e => e.leadId === lead.id);
      const leadMessages = messages.filter(m => m.leadId === lead.id && m.sentAt);
      const followUpCount = leadMessages.filter(m => m.kind === 'follow-up').length;
      const initialCount = leadMessages.filter(m => m.kind === 'initial').length;
      const clicked = new Set(leadEvents.filter(e => ['click_cta', 'click_proposal'].includes(e.type)).map(e => e.type)).size;
      const replied = leadEvents.some(e => e.type === 'reply');
      const booked = leadEvents.some(e => e.type === 'booking');
      const follow = lead.followUpAt && !lead.doNotContact ? `${isoDate(lead.followUpAt)} · ${Number(lead.followUpStep || 1)} of 2` : lead.doNotContact ? 'Stopped · opt-out' : replied ? 'Stopped · reply' : booked ? 'Stopped · booking' : followUpCount >= 2 ? 'Complete · 2 of 2' : 'No follow-up due';
      return `<tr><td><span class="company-name">${esc(lead.company)}</span><span class="company-secondary">${esc(lead.contactName || lead.email || 'Contact')}</span></td><td>${isoDate(first.sentAt)}<span class="company-secondary">${esc(lead.emailStatus || 'Handoff confirmed')}</span></td><td>${leadMessages.length}<span class="company-secondary">${initialCount} initial · ${followUpCount} follow-up${followUpCount === 1 ? '' : 's'}</span></td><td>${clicked ? `<span class="event-count">${clicked}</span> link type${clicked === 1 ? '' : 's'}` : '—'}</td><td>${replied ? `<button type="button" class="table-action" data-action="ix-open-lead" data-lead="${esc(lead.id)}">${svgIcon('reply')} Open in Inbox</button>` : '—'}</td><td>${booked ? `<span class="event-positive">Requested</span>` : '—'}</td><td>${esc(follow)}</td><td class="sent-actions">${!replied && !lead.doNotContact ? `<button class="table-action" type="button" data-action="mark-replied" data-id="${esc(lead.id)}">${svgIcon('reply')}Mark reply</button>` : ''}<button class="table-action" type="button" data-action="open-lead" data-id="${esc(lead.id)}">${svgIcon('eye')}Details</button></td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty-state"><div class="empty-state-icon">${svgIcon('mail')}</div><strong>No outreach confirmed yet</strong><p>Prepare and approve the text-only introductory email, hand it off to your email client, then confirm the handoff to start follow-up tracking.</p><button class="button button-primary" data-view="discover">${svgIcon('discover')}Review in Workbench</button></div>`}</div>`;
}
function pipelineBoard() {
  const visibleStages = (state.data.stages || []).filter(s => s !== 'Not proceeding');
  const query = state.query.toLowerCase().trim();
  return `<div class="board-note"><span class="grip">⠿</span> Drag cards between stages. Marking a lead <strong>Won</strong> automatically creates a partner profile with its point of contact.</div>
    <div class="kanban-board" id="kanban-board">${visibleStages.map(stage => {
      const leads = state.data.leads.filter(l => l.stage === stage && (!query || [l.company, l.contactName, l.sector, l.project].join(' ').toLowerCase().includes(query)));
      return `<section class="kanban-column" data-drop-stage="${esc(stage)}"><div class="kanban-heading"><strong>${esc(stage)}</strong><span>${leads.length}</span></div><div class="kanban-list">${leads.length ? leads.map(l => `<article class="lead-card" draggable="true" data-drag-lead="${esc(l.id)}" data-open-lead="${esc(l.id)}"><div class="lead-card-top"><h3>${esc(l.company)}</h3><span class="score">${Number(l.fitScore || 0)}%</span></div><div class="lead-card-contact">${esc(l.contactName || 'Contact to identify')} · ${esc(l.sector || 'Uncategorised')}</div><div class="lead-card-foot"><span class="lead-card-amount">${shortMoney(l.amount)}</span><span class="lead-card-sector">${esc(l.project || '')}</span></div></article>`).join('') : `<div class="kanban-empty">Drop a prospect here</div>`}</div></section>`;
    }).join('')}</div>`;
}
function bookingsView() {
  const rows = [...state.data.bookings].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const requested = rows.filter(b => b.status === 'Requested').length;
  const confirmed = rows.filter(b => b.status === 'Confirmed').length;
  const cards = rows.map(b => {
    const lead = getLead(b.leadId);
    const parts = dateParts(b.date);
    return `<article class="briefing-card"><div class="briefing-main"><div class="briefing-head"><div><h3>${esc(b.organization)}</h3><span class="contact-small">${esc(b.contactName)} · ${esc(b.email)}</span></div>${statusPill(b.status)}</div><div class="briefing-details"><span>${svgIcon('phone')}${esc(b.phone || 'No phone added')}</span><span>${svgIcon('grid')}${esc(lead?.project || 'Education impact partnership')}</span><span>${svgIcon('clock')}${Number(b.durationMinutes || INTRO_MEETING_MINUTES)} min intro</span><span>${svgIcon('building')}${esc(lead?.owner || 'Chelo team')}</span><span>${svgIcon('external')}${esc(platformLabel(b.videoPlatform))}${b.meetingUrl ? ` · <a href="${esc(safeUrl(b.meetingUrl))}" target="_blank" rel="noopener noreferrer">join link</a>` : ' · link pending'}</span>${b.confirmationStatus ? `<span>${svgIcon('mail')}Invite: ${esc(b.confirmationStatus)}</span>` : ''}</div>${b.note ? `<div class="detail-note" style="margin-top:11px">${esc(b.note)}</div>` : ''}</div><div class="briefing-side"><div class="briefing-time"><strong>${parts.day} ${esc(parts.month)}</strong>${esc(b.time)} · SAST</div><div class="briefing-actions">${lead ? `<button class="button button-ghost button-small" data-action="open-lead" data-id="${esc(lead.id)}">${svgIcon('eye')}Prospect</button>` : ''}<button class="button button-ghost button-small" data-action="edit-booking" data-id="${esc(b.id)}">${svgIcon('edit')} Link & time</button>${b.status === 'Requested' ? `<button class="button button-primary button-small" data-action="confirm-booking" data-id="${esc(b.id)}">${svgIcon('checkCircle')}Confirm & send invite</button><button class="button button-ghost button-small" data-action="decline-booking" data-id="${esc(b.id)}">${svgIcon('xCircle')}Decline</button>` : b.status === 'Confirmed' ? `<a class="button button-ghost button-small" href="/api/bookings/${encodeURIComponent(b.id)}/invite.ics" download>${svgIcon('download')} .ics</a><button class="button button-secondary button-small" data-action="resend-invite" data-id="${esc(b.id)}">${svgIcon('send')} Resend invite</button><button class="button button-secondary button-small" data-action="complete-booking" data-id="${esc(b.id)}">${svgIcon('check')}Complete</button>` : ''}</div></div></article>`;
  }).join('');
  return `${pageHead('Briefings', deskWord('briefings'), onSchools() ? 'Principals who booked a call. Confirm a time, or suggest another.' : onMarketing() ? 'Producers and editors who asked for an interview or a call.' : 'Funders who said yes to a call. Confirm a time, or suggest another.', '')}
    <div class="booking-grid"><div><div class="metric-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:480px">${metricCard('Awaiting confirmation', String(requested), 'date/time requests', 'clock', requested ? 'Review now' : 'All clear', Boolean(requested))}${metricCard('Confirmed briefings', String(confirmed), 'on the calendar manually', 'calendar', 'Calendar sync later', false)}</div><div class="booking-cards">${cards || `<div class="empty-state"><div class="empty-state-icon">${svgIcon('calendar')}</div><strong>No briefing requests yet</strong><p>When a donor follows the booking link in an approved email, their preferred date and time will be added here.</p></div>`}</div></div>
    <aside class="briefing-aside"><div class="aside-card dark"><h3 class="h-icon">${svgIcon('bell')}Booking requests</h3><p>The prospect chooses a preferred slot and leaves a phone number. Your team confirms the actual meeting time.</p><span class="aside-number">${requested}</span><p>need a team response</p></div><div class="aside-card"><h3 class="h-icon">${svgIcon('calendar')}Calendar invites</h3><p>Confirming a request emails an RFC 5545 .ics invite (Africa/Johannesburg) with the Google Meet, Microsoft Teams or Zoom link. Set default room links under Settings → Briefings.</p></div><div class="aside-card"><h3 class="h-icon">${svgIcon('video')}Default platform</h3><p>${esc(platformLabel(state.data.settings?.defaultPlatform))}${state.data.settings?.smtpConfigured ? ' · SMTP ready' : ' · SMTP not configured: download .ics and send manually'}</p></div></aside></div>`;
}
function proposalsView() {
  const leads = sortRecent(state.data.leads.filter(l => !['Not proceeding'].includes(l.stage)));
  const deskDoc = { csi: 'Impact proposals', marketing: 'Press backgrounders', schools: 'School briefs', suppliers: 'Scopes of works' }[currentDesk()] || 'Documents';
  return `${pageHead(deskDoc, 'Documents', { csi: 'Review each proposal before you create the PDF.', marketing: 'A one-page backgrounder per outlet, built from the approved media kit.', schools: 'A plain-language brief per school: the need, what happens next, what the school does.', suppliers: 'The scope of works each supplier quotes against.' }[currentDesk()] || '', currentDesk() === 'csi' ? `<button class="button button-primary" data-action="new-lead">${svgIcon('plus')} Add prospect</button>` : deskAddButton())}
    ${currentDesk() === 'csi' ? `<div class="note-callout" style="margin-bottom:15px"><span class="note-callout-icon">${svgIcon('info')}</span><span><strong>Chelo-guided drafting:</strong> proposals use the verified-recipient, traceability and impact-reporting context plus your project notes. Confirm project scope, contribution and every factual claim before sharing.</span></div>` : ''}
    <div class="proposal-grid">${leads.map(l => `<article class="proposal-card"><div class="proposal-icon">${svgIcon('proposals')}</div><h3>${esc(l.company)}</h3><p>${esc(l.project || pdfLabels(l).doc)}${(l.kind || 'funder') === 'funder' ? ` · ${money(l.amount)} potential ask` : ` · ${esc(pdfLabels(l).doc)}`}</p><div class="proposal-card-foot"><span>${l.proposalFile ? `Updated ${isoDate(l.updatedAt)}` : 'No PDF generated yet'}</span><div style="display:flex;gap:5px">${l.proposalFile ? `<a class="button button-secondary button-small" href="${proposalDownload(l)}" download>${svgIcon('download')} PDF</a>` : ''}<button class="button ${l.proposalFile ? 'button-ghost' : 'button-primary'} button-small" type="button" data-action="create-proposal" data-id="${esc(l.id)}">${svgIcon('proposals')}${l.proposalFile ? 'Edit & regenerate' : 'Create PDF'}</button></div></div>${l.proposalFile ? `<div class="proposal-card-foot" style="margin-top:10px;padding-top:9px"><span>Share after briefing or on request</span><div><button class="table-action" data-action="copy-proposal-link" data-id="${esc(l.id)}">${svgIcon('copy')}Copy secure link</button><button class="table-action" data-action="email" data-id="${esc(l.id)}">${svgIcon('mail')}Draft email</button></div></div>` : ''}</article>`).join('')}</div>`;
}
function analyticsChart(analytics) {
  const rows = analytics?.series || [];
  if (!rows.length) return `<div class="chart-empty">Analytics activity will appear after a send, open or CTA click is recorded.</div>`;
  const width = 760, height = 220, left = 34, right = 16, top = 18, bottom = 30;
  const max = Math.max(1, ...rows.flatMap(row => [row.sent, row.opens, row.clicks, row.briefingRequests || 0]));
  const x = i => left + (rows.length <= 1 ? 0 : i * (width - left - right) / (rows.length - 1));
  const y = value => top + (height - top - bottom) * (1 - Number(value || 0) / max);
  const line = key => rows.map((row, i) => `${x(i).toFixed(1)},${y(row[key]).toFixed(1)}`).join(' ');
  const grid = [0, .5, 1].map(f => { const gy = top + f * (height - top - bottom); return `<line x1="${left}" x2="${width-right}" y1="${gy}" y2="${gy}" class="chart-gridline"/><text x="${left-9}" y="${gy+3}" text-anchor="end" class="chart-axis-label">${Math.round(max*(1-f))}</text>`; }).join('');
  const label = i => rows[i]?.date ? new Date(`${rows[i].date}T12:00:00`).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}) : '';
  return `<div class="analytics-chart-wrap"><svg class="analytics-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily email sends, estimated opens, Yes CTA clicks and preferred-time requests">${grid}<polyline points="${line('sent')}" class="chart-line chart-sent"/><polyline points="${line('opens')}" class="chart-line chart-open"/><polyline points="${line('clicks')}" class="chart-line chart-click"/><polyline points="${line('briefingRequests')}" class="chart-line chart-booking"/>${rows.map((row,i)=>`<circle cx="${x(i)}" cy="${y(row.sent)}" r="2.5" class="chart-dot chart-dot-sent"><title>${esc(row.date)} · ${row.sent} sent</title></circle>`).join('')}<text x="${left}" y="${height-7}" class="chart-axis-label">${label(0)}</text><text x="${width-right}" y="${height-7}" text-anchor="end" class="chart-axis-label">${label(rows.length-1)}</text></svg><div class="chart-legend"><span><i class="legend-sent"></i>Emails sent</span><span><i class="legend-open"></i>Estimated opens</span><span><i class="legend-click"></i>Yes CTA clicks</span><span><i class="legend-booking"></i>Preferred-time requests</span></div></div>`;
}
function analyticsView(embedded = false) {
  const analytics = state.data.analytics;
  const rangeOptions = [[7,'Last 7 days'],[30,'Last 30 days'],[90,'Last 90 days'],[365,'Last 12 months'],[0,'All time']];
  const range = `<select class="select-control" id="analytics-range" aria-label="Analytics date range">${rangeOptions.map(([value,label])=>`<option value="${value}" ${Number(state.analyticsRange)===value?'selected':''}>${label}</option>`).join('')}</select>`;
  const actions = `${range}<a class="button button-secondary" href="/api/analytics/export.csv?days=${Number(state.analyticsRange)||0}" download>${svgIcon('download')} Export CSV</a>`;
  const openFoot = analytics?.openRate == null ? 'No tracked opens yet' : `${analytics.openRate}% estimated open rate`;
  const learning = analytics?.learning;
  const learningRecommendations = (learning?.recommendations || []).map(item => `<div class="learning-signal"><span><strong>${esc(item.band)}</strong><small>${esc(item.dimension)} · ${item.sent} sends</small></span><b>${item.preferredTimeRequests}/${item.sent}<small>preferred-time requests</small></b></div>`).join('');
  const learningStatus = learning?.status === 'directional' ? 'Directional evidence available' : 'Collecting evidence';
  const learningSummary = learningRecommendations || (Number(learning?.initialSends || 0) >= 10
    ? 'No stable pattern with a sufficiently large comparison group yet. The standard executive template remains the default.'
    : `At least 10 initial sends overall and 5 in each compared pattern are needed before a direction is shown. Current eligible sample: ${Number(learning?.initialSends || 0)}.`);
  const aiLearningNote = state.data.aiConfigured
    ? 'When configured, future AI drafts receive only these aggregate patterns. Every draft remains staff-approved; project, contribution, verified facts and message context stay fixed.'
    : 'AI is not configured, so this demo uses a local guided template. No model adaptation is running until an approved AI provider is connected.';
  const trackingNote = state.data.settings?.openTrackingReady
    ? 'Opens are estimated from a 1×1 pixel. Image blocking, caching and privacy proxies can distort counts.'
    : 'Open tracking needs a public HTTPS app URL in Settings. Until configured, no open pixel is added to email drafts.';
  return `${embedded ? `<div class="page-controls"><div class="control-left"><h2 class="panel-title">Engagement</h2></div><div class="control-right">${actions}</div></div>` : pageHead('Engagement reporting', 'Analytics', '', actions)}
    <div class="privacy-callout"><span class="privacy-callout-icon">${svgIcon('eye')}</span><div><strong>Open counts are estimates, not proof a person read the email.</strong><p>${esc(trackingNote)} “Yes — choose…” clicks are first-party CTA hits; briefing requests are counted separately.</p></div></div>
    ${state.analyticsLoading ? `<div class="loading-line"><span></span></div>` : ''}
    <section class="metric-grid analytics-metrics">
      ${metricCard('Emails sent / handoffs', String(analytics?.sent ?? '—'), `${analytics?.smtpSent ?? 0} SMTP accepted · ${analytics?.manualHandoffs ?? 0} staff-confirmed`, 'send')}
      ${metricCard('SMTP accepted', String(analytics?.smtpSent ?? '—'), 'accepted by configured mail server', 'mail')}
      ${metricCard('Estimated unique opens', String(analytics?.uniqueOpens ?? '—'), openFoot, 'eye')}
      ${metricCard('“Yes — choose…” clicks', String(analytics?.yesClicks ?? '—'), `${analytics?.uniqueYesClickers ?? 0} unique recipient${analytics?.uniqueYesClickers === 1 ? '' : 's'}`, 'target')}
      ${metricCard('Briefing requests', String(analytics?.briefingRequests ?? '—'), 'preferred times submitted', 'calendar')}
    </section>
    <section class="panel learning-panel"><div class="learning-heading"><div class="learning-icon">${svgIcon('spark')}</div><div><span class="readiness-kicker">Draft improvement</span><h2>Performance-informed outreach</h2><p>Primary outcome: a preferred-time request submitted—not a click or estimated open. Signals use the last 365 days of recorded initial sends.</p></div><span class="learning-status ${learning?.status === 'directional' ? 'is-ready' : ''}">${esc(learningStatus)}</span></div><div class="learning-content"><div class="learning-counts"><strong>${Number(learning?.initialSends || 0)}</strong><span>initial sends analysed</span><strong>${Number(learning?.preferredTimeRequests || 0)}</strong><span>preferred-time requests</span></div><div class="learning-signals">${learningSummary}</div></div><p class="learning-disclaimer">${esc(learning?.note || 'Outcome learning is aggregate and observational, not causal.')} ${esc(aiLearningNote)}</p></section>
    <section class="analytics-layout"><div class="panel analytics-chart-panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('trend')}Engagement over time</h2><p class="panel-description">Daily sends, estimated opens, first-party CTA clicks and preferred-time requests · most recent 30 days shown</p></div><span class="chart-period">${esc(rangeOptions.find(([v])=>v===Number(state.analyticsRange))?.[1] || 'Last 30 days')}</span></div>${analyticsChart(analytics)}</div>
      <div class="panel analytics-side-panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('send')}Delivery breakdown</h2><p class="panel-description">Staff-confirmed handoffs are not SMTP receipts</p></div></div><div class="analytics-breakdown"><div><span><i class="legend-sent"></i>SMTP accepted</span><strong>${analytics?.smtpSent ?? 0}</strong></div><div><span><i class="legend-handoff"></i>Manual handoffs</span><strong>${analytics?.manualHandoffs ?? 0}</strong></div><div><span><i class="legend-open"></i>Tracked sends</span><strong>${analytics?.trackedSends ?? 0}</strong></div><div><span><i class="legend-click"></i>Replies recorded</span><strong>${analytics?.replies ?? 0}</strong></div></div><div class="analytics-tip"><strong>Reporting note</strong><p>SMTP acceptance means the server accepted the message for delivery; it does not confirm inbox placement. Manual handoffs are counted only after staff confirms sending.</p></div></div></section>`;
}
function auditView() {
  const query = String(state.auditQuery || '').trim().toLowerCase();
  const logs = (state.auditLogs || []).filter(entry => !query || [entry.actor,entry.action,entry.entityType,entry.entityId,entry.summary].join(' ').toLowerCase().includes(query));
  const rows = logs.map(entry => `<tr><td>${esc(new Date(entry.timestamp).toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'}))}</td><td>${esc(entry.actor)}</td><td><span class="audit-action">${esc(entry.action)}</span></td><td>${esc(entry.entityType)}${entry.entityId ? `<small>${esc(entry.entityId)}</small>` : ''}</td><td>${esc(entry.summary)}</td></tr>`).join('');
  return `<div class="panel audit-panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('shield')}Audit trail</h2><p class="panel-description">Application-level activity retained for up to 365 days. Secret values and message bodies are excluded.</p></div>${isRoot() ? `<a class="button button-secondary button-small" href="/api/audit/export.csv${state.auditQuery.trim() ? `?query=${encodeURIComponent(state.auditQuery.trim())}` : ''}" download>${svgIcon('download')} Export CSV</a>` : ''}</div><div class="audit-controls"><label class="input-search">${svgIcon('search')}<input id="audit-search" type="search" value="${esc(state.auditQuery)}" placeholder="Search actor, action or record…" /></label><span class="subtle">${logs.length} entries</span></div><div class="lead-table-wrap"><table class="table audit-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Summary</th></tr></thead><tbody>${rows || `<tr><td colspan="5"><div class="panel-empty">${state.auditLogs === null ? 'Loading audit trail…' : 'No matching audit entries.'}</div></td></tr>`}</tbody></table></div><div class="audit-footer">This application audit trail is append-oriented and access-controlled, but is not a tamper-proof or compliance-certified log. Back up and protect the server data directory.</div></div>`;
}
/** Saves the whole Settings form (any card). Used by Save buttons and by the Test buttons, which save what you typed first. */
async function saveSettingsForm(form) {
  const data = formDataObject(form);
  for (const key of ['smtpSecure', 'openTrackingEnabled', 'clearAiKey', 'clearSmtpPassword', 'autoSendCalendarInvite', 'clearImapPassword', 'clearSearchKey']) {
    if (form.elements[key]) data[key] = Boolean(form.elements[key].checked); else delete data[key];
  }
  await API('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
  // Never leave a secret sitting in the page after it has been stored.
  for (const name of ['aiApiKey', 'searchApiKey', 'smtpPassword', 'imapPassword']) if (form.elements[name]) form.elements[name].value = '';
}
function settingsView() {
  const settings = state.data.settings || {};
  if (!isRoot() && state.settingsSection === 'integrations') state.settingsSection = 'mailbox';
  const aiState = settings.aiConfigured ? `Configured · ${settings.aiKeySource === 'environment' ? 'server environment' : 'encrypted Settings'}` : 'Not configured';
  const smtpState = settings.smtpConfigured ? `Configured · ${settings.smtpHost}:${settings.smtpPort}` : 'Not configured';
  const content = state.settingsSection === 'audit' ? auditView() : `<div class="settings-status-grid"><div class="settings-status-card"><span class="metric-icon">${svgIcon('spark')}</span><div><strong>AI drafting</strong><small>${esc(aiState)}</small></div><span class="status-dot ${settings.aiConfigured ? 'is-on' : ''}"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('mail')}</span><div><strong>SMTP sending</strong><small>${esc(smtpState)}</small></div><span class="status-dot ${settings.smtpConfigured ? 'is-on' : ''}"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('eye')}</span><div><strong>Open measurement</strong><small>${settings.openTrackingReady ? 'Pixel ready · public HTTPS URL set' : settings.openTrackingEnabled ? 'Enabled · needs public HTTPS URL' : 'Disabled'}</small></div><span class="status-dot ${settings.openTrackingReady ? 'is-on' : ''}"></span></div></div>
    <form id="settings-form" data-form="settings" class="settings-form"><section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('spark')}</span><div><h2>AI provider</h2><p>Optional OpenAI-compatible endpoint for proposal and email copy. Use HTTPS except for loopback testing. Secrets stay on the server and are never returned to the browser.</p></div></div><div class="settings-fields"><div class="form-group"><label for="setting-ai-endpoint">Chat completions endpoint</label><input class="form-control" id="setting-ai-endpoint" name="aiEndpoint" type="url" value="${esc(settings.aiEndpoint || 'https://api.openai.com/v1/chat/completions')}" placeholder="https://api.openai.com/v1/chat/completions" /></div><div class="form-group"><label for="setting-ai-model">Model</label><input class="form-control" id="setting-ai-model" name="aiModel" value="${esc(settings.aiModel || 'gpt-4o-mini')}" /></div><div class="form-group full"><label for="setting-ai-key">API key <span class="optional">(leave blank to keep current)</span></label><input class="form-control" id="setting-ai-key" name="aiApiKey" type="password" autocomplete="new-password" placeholder="${settings.aiConfigured ? 'Key is stored; value is hidden' : 'Paste API key'}" /></div><label class="check-row"><input type="checkbox" name="clearAiKey" /> Remove saved AI key <small>Environment keys, if set, remain active.</small></label></div><div class="settings-card-actions"><button class="button button-primary" type="submit">${svgIcon('check')} Save</button><button class="button button-secondary" type="button" data-action="test-ai">${svgIcon('spark')} Save &amp; test AI</button><span class="subtle">${settings.aiConfigured ? `Key stored (${settings.aiKeySource === 'environment' ? 'server environment' : 'encrypted'}) · model ${esc(settings.aiModel || '')}` : 'No key saved yet'}</span></div></section>
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('globe')}</span><div><h2>Web research provider</h2><p>Powers the Research copilot's funder briefs. Only staff-initiated, organisation-level lookups run; fetched pages are PII-scrubbed before any AI call and every finding is cited for human review. Without a provider, research reads the funder's official website (Source URL) only.</p></div></div><div class="settings-fields"><div class="form-group"><label for="setting-search-provider">Provider</label><select class="form-control" id="setting-search-provider" name="searchProvider">${['none','tavily','serper','bing'].map(v => `<option value="${v}" ${(settings.searchProvider || 'none') === v ? 'selected' : ''}>${{ none: 'None (official website only)', tavily: 'Tavily', serper: 'Serper (Google)', bing: 'Bing Web Search' }[v]}</option>`).join('')}</select></div><div class="form-group"><label for="setting-search-key">Search API key <span class="optional">(leave blank to keep current)</span></label><input class="form-control" id="setting-search-key" name="searchApiKey" type="password" autocomplete="new-password" placeholder="${settings.searchConfigured ? 'Key is stored; value is hidden' : 'Paste search API key'}" /></div><label class="check-row"><input type="checkbox" name="clearSearchKey" /> Remove saved search key <small>SEARCH_PROVIDER / SEARCH_API_KEY environment values, if set, remain active.</small></label></div><div class="settings-card-actions"><button class="button button-primary" type="submit">${svgIcon('check')} Save</button><button class="button button-secondary" type="button" data-action="test-search">${svgIcon('globe')} Save &amp; test search</button><span class="subtle">${settings.searchConfigured ? `Configured · ${esc(settings.searchProvider)} · ${settings.searchKeySource === 'environment' ? 'server environment' : 'encrypted Settings'}` : 'Not configured'}</span></div></section>
      <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>Email sending</h2><p>Sending mailboxes, domain authentication (SPF/DKIM/DMARC), daily caps, ramps and the send queue now live under <strong>Deliverability</strong>. ${settings.smtpConfigured ? 'Your previous SMTP settings were migrated into the first mailbox.' : ''}</p></div></div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-view="deliverability">${svgIcon('shield')} Open Deliverability</button></div></section>
      ${googleSettingsCard(settings)}
      <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon gold">${svgIcon('eye')}</span><div><h2>Analytics & tracking</h2><p>First-party CTA hits are counted by Chelo. Open measurement uses a 1×1 tracking pixel and is approximate; image proxies, privacy features and blockers may distort it.</p></div></div><div class="settings-fields"><label class="check-row"><input type="checkbox" name="openTrackingEnabled" ${settings.openTrackingEnabled ? 'checked' : ''} /> Add open-tracking pixel to SMTP and .eml emails</label><div class="form-group full"><label for="setting-public-url">Public HTTPS app URL</label><input class="form-control" id="setting-public-url" name="publicBaseUrl" type="url" value="${esc(settings.publicBaseUrl || (location.protocol === 'https:' ? location.origin : ''))}" placeholder="https://partnerships.example.org" /><span class="form-hint">The recipient’s mail client must be able to reach this HTTPS address to load the pixel and CTA. Localhost and private preview URLs will not track opens for external recipients.</span></div></div><div class="settings-card-actions"><button class="button button-primary" type="submit">${svgIcon('check')} Save settings</button></div></section></form>`;
  const isAdmin = state.auth.role === 'admin' || state.auth.demoAccess;
  const sectionContent = state.settingsSection === 'mailbox' ? myMailboxView(settings, isAdmin) : state.settingsSection === 'governance' ? governanceView(isAdmin) : state.settingsSection === 'briefings' ? briefingsSettingsView(settings) : state.settingsSection === 'media-kit' ? mediaKitView(isAdmin) : content;
  const tabs = `<div class="settings-tabs" role="tablist"><button type="button" class="settings-tab ${state.settingsSection === 'mailbox' ? 'active' : ''}" data-settings-tab="mailbox">${svgIcon('mail')} My mailbox</button>${isRoot() ? `<button type="button" class="settings-tab ${state.settingsSection === 'integrations' ? 'active' : ''}" data-settings-tab="integrations">${svgIcon('settings')} Integrations</button>` : ''}<button type="button" class="settings-tab ${state.settingsSection === 'governance' ? 'active' : ''}" data-settings-tab="governance">${svgIcon('shield')} Team & governance</button><button type="button" class="settings-tab ${state.settingsSection === 'briefings' ? 'active' : ''}" data-settings-tab="briefings">${svgIcon('calendar')} Briefings & inbound</button>${myDesks().includes('marketing') ? `<button type="button" class="settings-tab ${state.settingsSection === 'media-kit' ? 'active' : ''}" data-settings-tab="media-kit">${svgIcon('globe')} Media kit</button>` : ''}<button type="button" class="settings-tab ${state.settingsSection === 'audit' ? 'active' : ''}" data-settings-tab="audit">${svgIcon('activity')} Audit trail</button></div>`;
  return `${pageHead('Settings', 'Settings', '', state.auth.openAccessDemo ? '' : `<button class="button button-secondary" data-action="logout">${svgIcon('logout')} Sign out</button>`)}${tabs}${sectionContent}`;
}

/** Settings → Google: the OAuth client that powers "Connect with Google" (no passwords for Workspace mailboxes). */
function googleSettingsCard(settings) {
  const g = state.googleStatus; // loaded lazily: redirect URL, scopes
  if (!g && !state.googleStatusLoading) { state.googleStatusLoading = true; API('/api/settings/google').then(r => { state.googleStatus = r; state.googleStatusLoading = false; renderApp(); }).catch(() => { state.googleStatusLoading = false; }); }
  const configured = g ? g.configured : settings.googleConfigured;
  return `<section class="panel settings-card" id="settings-google"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('key')}</span><div><h2>Google</h2><p>Lets staff add a company Gmail / Google Workspace mailbox with <strong>Connect with Google</strong> instead of a password. Chelo asks Google for two permissions only: send email as that mailbox, and read email (read-only) to notice replies and bounces. The company can revoke it any time from the Google account.</p></div></div>
    <div class="settings-fields">
      <div class="form-group"><label for="google-client-id">Client ID</label><input class="form-control" id="google-client-id" autocomplete="off" placeholder="${g?.state?.idStored || g?.state?.idFromEnv || configured ? `Saved · ${esc(g?.clientIdHint || settings.googleClientIdHint || '')} — paste to replace` : '123456789-abc.apps.googleusercontent.com'}" /></div>
      <div class="form-group"><label for="google-client-secret">Client secret</label><input class="form-control" id="google-client-secret" type="password" autocomplete="new-password" placeholder="${(g?.state?.secretStored && g?.state?.secretReadable) || g?.state?.secretFromEnv || configured ? 'Saved — paste to replace' : 'GOCSPX-…  (not saved yet)'}" /></div>
      <div class="form-group full"><label>Where to get them</label><ol class="settings-steps"><li>console.cloud.google.com, signed in with a company account → APIs &amp; Services → <strong>Credentials</strong> → Create credentials → <strong>OAuth client ID</strong> → Web application.</li><li>Authorised JavaScript origin: <code>${esc(g?.origin || location.origin)}</code></li><li>Authorised redirect URI: <code>${esc(g?.redirectUri || `${location.origin}/api/oauth/google/callback`)}</code></li><li>OAuth consent screen → User type <strong>Internal</strong>. APIs &amp; Services → Library → <strong>Gmail API</strong> → Enable.</li><li>Paste the Client ID and Client secret here → Save. Then Deliverability → Add mailbox → <strong>Connect with Google</strong>.</li></ol></div>
    </div>
    <div class="settings-card-actions"><button class="button button-primary" type="button" data-action="google-save">${svgIcon('check')} Save</button>${configured ? `<button class="button button-ghost" type="button" data-action="google-clear">${svgIcon('trash')} Remove</button>` : ''}<span class="subtle">${configured ? `Set up (${g?.source === 'environment' || settings.googleSource === 'environment' ? 'server environment' : 'encrypted'})` : esc(g?.missing || 'Not set up yet')}</span></div></section>`;
}
/** Settings → My mailbox: each staff member connects their own company Google mailbox and sees its state. */
function loadMyMailboxes(force) {
  if (state.myMailboxes && !force) return;
  if (state.myMailboxesLoading) return;
  state.myMailboxesLoading = true;
  API('/api/me/mailboxes').then(r => { state.myMailboxes = r; state.myMailboxesLoading = false; renderApp(); }).catch(err => { state.myMailboxesLoading = false; toast(err.message, true); });
}
function myMailboxView(settings, isAdmin) {
  loadMyMailboxes();
  const r = state.myMailboxes;
  const configured = Boolean(r?.googleConfigured || state.googleStatus?.configured || settings.googleConfigured); // all three come from the server; any fresh 'yes' wins over a cached 'no'
  const domain = r?.hostedDomain || state.googleStatus?.hostedDomain || '';
  const boxes = r?.mailboxes || [];
  const when = iso => iso ? new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not yet';
  const card = m => {
    const paused = m.status !== 'active';
    const needsReconnect = paused && /google|reconnect|revoked|token/i.test(m.pausedReason || '');
    return `<article class="panel settings-card my-mailbox ${paused ? 'is-paused' : ''}"><div class="settings-section-head"><span class="settings-section-icon ${paused ? 'gold' : 'blue'}">${svgIcon('mail')}</span><div><h2>${esc(m.fromEmail)}</h2><p>${paused ? `<strong>Paused.</strong> ${esc(m.pausedReason || '')}` : `Working. Sent ${m.today?.used ?? 0} of ${m.today?.cap ?? m.dailyCap} allowed today.`} Replies last checked: ${esc(when(m.imap?.lastSyncAt))}.${m.health?.status === 'fail' ? ' Domain checks are failing — tell an admin.' : ''}</p></div></div>
      <div class="settings-card-actions">${needsReconnect || paused ? `<button type="button" class="button button-primary" data-action="google-connect" data-mailbox="${esc(m.id)}">${svgIcon('key')} Reconnect Google</button>` : `<button type="button" class="button button-secondary" data-action="me-mailbox-sync" data-id="${esc(m.id)}">${svgIcon('refresh')} Check for replies now</button>`}<button type="button" class="button button-ghost" data-action="me-mailbox-remove" data-id="${esc(m.id)}">${svgIcon('trash')} Remove</button><span class="subtle">Emails you approve go out from this mailbox. Replies still arrive in Gmail as normal.</span></div></article>`;
  };
  const connect = configured
    ? `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('key')}</span><div><h2>${boxes.length ? 'Connect another mailbox' : 'Connect your mailbox'}</h2><p>Press the button, sign in to your ${esc(domain || 'company')} Google account and tick the two boxes. Chelo can then send the emails you approve from your address and notice when a funder replies. Nothing about your Gmail changes — you keep receiving and reading mail there as always.</p></div></div><div class="settings-card-actions"><button type="button" class="button button-primary" data-action="google-connect">${svgIcon('key')} Connect with Google</button>${domain ? `<span class="subtle">Only @${esc(domain)} accounts are accepted.</span>` : ''}</div></section>`
    : `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon gold">${svgIcon('key')}</span><div><h2>Google is not set up yet</h2><p>${isAdmin ? 'Add the Google Client ID and secret below once; after that every staff member can connect their own mailbox here.' : 'Ask an administrator to set up Google under Settings → My mailbox. After that you can connect your mailbox here with one click.'}</p></div></div></section>${isAdmin ? googleSettingsCard(settings) : ''}`;
  return `${boxes.map(card).join('')}${connect}${configured && isAdmin ? `<details class="dlv-advanced settings-card-details"><summary>Google client settings (administrators)</summary>${googleSettingsCard(settings)}</details>` : ''}`;
}
function authMfaView() {
  return `<main class="auth-screen"><section class="auth-card"><div class="auth-brand"><span class="brand-symbol">${BRAND_MARK}</span><span><strong>Chelo</strong><small>Communication Center</small></span></div><span class="auth-kicker">TWO-STEP SIGN-IN</span><h1>Enter your code</h1><p class="auth-intro">Open your authenticator app and type the 6-digit code for <strong>${esc(state.mfaChallenge.username)}</strong>. Lost your phone? Use one of your recovery codes.</p>${state.authError ? `<div class="form-error">${esc(state.authError)}</div>` : ''}<form class="auth-form" data-form="auth-mfa"><div class="form-group"><label for="auth-code">Code</label><input class="form-control" id="auth-code" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus placeholder="123 456 or XXXX-XXXX" /></div><button type="submit" class="button button-primary auth-submit">${svgIcon('lock')} Sign in</button></form><p class="auth-security-note"><button type="button" class="link-button" data-action="mfa-restart">Start again with email and password</button></p></section><div class="auth-orb auth-orb-one"></div><div class="auth-orb auth-orb-two"></div></main>`;
}
function authGateView() {
  if (state.mfaChallenge) return authMfaView();
  const setup = Boolean(state.auth.setupRequired);
  const title = setup ? 'Create your admin account' : 'Welcome back';
  const intro = setup ? 'Set up the first Chelo Communication Center administrator before connecting services.' : 'Sign in to your protected Chelo partnerships workspace.';
  const fields = setup ? `<div class="form-group"><label for="auth-password-confirm">Confirm password</label><input class="form-control" id="auth-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></div>` : '';
  const submit = setup ? 'Create admin account' : 'Sign in';
  return `<main class="auth-screen"><section class="auth-card"><div class="auth-brand"><span class="brand-symbol">${BRAND_MARK}</span><span><strong>Chelo</strong><small>Communication Center</small></span></div><span class="auth-kicker">SECURE WORKSPACE</span><h1>${title}</h1><p class="auth-intro">${intro}</p>${state.authError ? `<div class="form-error">${esc(state.authError)}</div>` : ''}<form class="auth-form" data-form="${setup ? 'auth-setup' : 'auth-login'}">${setup ? `<div class="form-group"><label for="auth-display">Your name</label><input class="form-control" id="auth-display" name="displayName" autocomplete="name" required placeholder="e.g. Nandi M." /></div>` : ''}<div class="form-group"><label for="auth-username">${setup ? 'Admin email' : 'Staff email'}</label><input class="form-control" id="auth-username" name="username" type="email" autocomplete="username" required placeholder="you@cheloapp.com" /></div><div class="form-group"><label for="auth-password">${setup ? 'Create password' : 'Password'}</label><input class="form-control" id="auth-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? '12' : '1'}" required placeholder="${setup ? 'At least 12 characters' : 'Enter your password'}" /></div>${fields}<button type="submit" class="button button-primary auth-submit">${svgIcon(setup ? 'lock' : 'arrow')} ${submit}</button></form>${!setup && state.auth.googleLogin ? `<div class="auth-demo-divider"><span>or</span></div><a class="button button-secondary auth-google-button" href="/api/auth/google/start">${svgIcon('key')} Sign in with Google</a><p class="auth-google-note">For ${esc(state.auth.googleDomain ? `@${state.auth.googleDomain}` : 'company')} Google accounts. One screen signs you in and connects your mailbox, so emails you approve go out from your own address.</p>` : ''}${state.auth.demoAccessAvailable ? `<div class="auth-demo-divider"><span>or explore</span></div><button type="button" class="button button-secondary auth-demo-button" data-action="demo-login">${svgIcon('eye')} Enter demo as admin</button><p class="auth-demo-warning">Full admin access to the demo workspace. Only use with fictional data and an isolated, disposable data directory.</p>` : ''}<p class="auth-security-note">${svgIcon('shield')} Credentials and provider secrets are processed server-side. Use a unique password and keep this workspace on a trusted network. <a href="/privacy" target="_blank" rel="noopener">Privacy notice</a>.</p>${setup ? `<p class="auth-first-run-warning">Complete first-run setup before exposing the app to other networks.</p>` : ''}</section><div class="auth-orb auth-orb-one"></div><div class="auth-orb auth-orb-two"></div></main>`;
}
function renderView() {
  switch (state.view) {
    case 'workbench': return workbenchView();
    case 'review': return reviewView();
    case 'inbox': return typeof window.inboxView === 'function' ? window.inboxView() : '';
    case 'ops': return opsView();
    case 'projects': return projectsView();
    case 'prospects': return prospectsView();
    case 'briefings': return bookingsView();
    case 'sent': return sentView();
    case 'partners': return relationshipsView();
    case 'settings': return settingsView();
    default: return overviewView();
  }
}

function renderModal() {
  if (!state.modal) return '';
  const { type, id } = state.modal;
  if (type === 'lead-form') return leadFormModal(getLead(id));
  if (type === 'candidate-review') return candidateReviewModal(state.data.candidates.find(c => c.id === id));
  if (type === 'csv-preview') return candidateCsvPreviewModal(state.csvImportPreview);
  if (type === 'import-report') return candidateImportReportModal(state.importReport);
  if (type === 'lead-detail') return leadDetailModal(getLead(id));
  if (type === 'proposal') return proposalModal(getLead(id));
  if (type === 'outreach') return outreachModal(getLead(id));
  if (type === 'email') return emailModal(getLead(id), Boolean(state.modal.followUp));
  if (type === 'partner') return partnerModal(getPartner(id));
  if (type === 'relationship') return relationshipModal();
  if (type === 'project-form') return projectFormModal(state.data.projects.find(p => p.id === id));
  if (type === 'project-detail') return projectDetailModal(state.data.projects.find(p => p.id === id));
  if (type === 'project-import') return projectImportModal(state.projectImportPreview);
  if (type === 'copilot') return copilotModal();
  if (type === 'research') return researchModal(getLead(id));
  if (type === 'staff-form') return staffFormModal(state.data.staff.find(u => u.id === id));
  if (type === 'lead-share') return leadShareModal(getLead(id));
  if (type === 'project-team') return projectTeamModal(state.data.projects.find(p => p.id === id));
  if (type === 'booking-edit') return bookingEditModal(getBooking(id));
  return '';
}
function modalFrame(title, subtitle, body, footer = '', centered = false, extraClass = '') {
  return `<div class="modal-backdrop" id="modal-backdrop"><section class="modal-panel ${centered ? 'modal-centered' : ''} ${esc(extraClass)}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><div><h2>${esc(title)}</h2><p>${esc(subtitle || '')}</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="Close">${svgIcon('close')}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</section></div>`;
}
function leadFormModal(lead) {
  const edit = Boolean(lead);
  const healthNotice = lead?.contactCheck && lead.contactCheck.status !== 'ready' ? `<div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>Complete the contact intake check</strong><br>${esc((lead.contactCheck.issues || [lead.contactCheck.reason]).filter(Boolean).join(' · ') || 'Review the contact name, email and source.')}</span></div>` : '';
  const body = `${healthNotice}<form id="lead-form" data-form="lead" data-id="${edit ? esc(lead.id) : ''}"><div class="form-grid">
    <div class="form-group full"><label for="company">Organisation name *</label><input class="form-control" id="company" name="company" required value="${esc(lead?.company || '')}" placeholder="e.g. a corporate or foundation" /></div>
    <div class="form-group"><label for="contactName">Point of contact</label><input class="form-control" id="contactName" name="contactName" value="${esc(lead?.contactName || '')}" placeholder="Full name" /></div>
    <div class="form-group"><label for="title">Role / title</label><input class="form-control" id="title" name="title" value="${esc(lead?.title || '')}" placeholder="e.g. CSI Manager" /></div>
    <div class="form-group"><label for="email">Work email</label><input class="form-control" id="email" name="email" type="email" value="${esc(lead?.email || '')}" placeholder="name@organisation.org" /></div>
    <div class="form-group"><label for="phone">Phone number</label><input class="form-control" id="phone" name="phone" value="${esc(lead?.phone || '')}" placeholder="+27 …" /></div>
    <div class="form-group"><label for="sector">Sector</label><input class="form-control" id="sector" name="sector" value="${esc(lead?.sector || '')}" placeholder="e.g. Financial services" /></div>
    <div class="form-group"><label for="financialYearEnd">Financial year-end (times the approach)</label><select class="form-control" id="financialYearEnd" name="financialYearEnd"><option value="">Unknown</option>${FYE_MONTHS.map((m, i) => `<option value="${i + 1}" ${Number(lead?.financialYearEnd) === i + 1 ? 'selected' : ''}>${m}${i + 1 === 3 ? ' (most common)' : i + 1 === 6 ? ' (common)' : i + 1 === 12 ? ' (common)' : ''}</option>`).join('')}</select></div>
    <div class="form-group"><label for="introducer">Introduced by (relationship memory)</label><input class="form-control" id="introducer" name="introducer" value="${esc(lead?.introducer || '')}" placeholder="e.g. Thabo Kekana" /></div>
    <div class="form-group"><label for="introducedVia">How the door opened</label><input class="form-control" id="introducedVia" name="introducedVia" value="${esc(lead?.introducedVia || '')}" placeholder="e.g. Trialogue conference, board member, alumni" /></div>
    <div class="form-group"><label for="foundationName">Linked foundation / trust</label><input class="form-control" id="foundationName" name="foundationName" value="${esc(lead?.foundationName || '')}" placeholder="e.g. Sasol Foundation" /></div>
    <div class="form-group"><label for="parentCompany">Parent company (if this is a foundation)</label><input class="form-control" id="parentCompany" name="parentCompany" value="${esc(lead?.parentCompany || '')}" /></div>
    <div class="form-group"><label for="lead-province">Head office / footprint province</label><input class="form-control" id="lead-province" name="province" value="${esc(lead?.province || '')}" placeholder="e.g. Gauteng or National" /></div>
    <div class="form-group"><label for="amount">Potential contribution (ZAR)</label><input class="form-control" id="amount" name="amount" type="number" min="0" step="1000" value="${Number(lead?.amount || 0) || ''}" placeholder="250000" /></div>
    <div class="form-group full"><label for="projectId">Verified project to back</label><select class="form-control" id="projectId" name="projectId">${projectOptions(lead?.projectId)}</select><span class="form-hint">Linked projects feed the funding-gap ledger. Choose “Other” to keep a free-text focus.</span></div>
    <div class="form-group full project-freeform ${lead?.projectId ? 'is-hidden' : ''}"><label for="project">Impact / project focus (free text)</label><input class="form-control" id="project" name="project" value="${esc(lead?.project || 'Education impact partnership')}" placeholder="What could this partner fund?" /></div>
    <div class="form-group"><label for="grantWindowOpenMonth">Grant window opens</label><select class="form-control" id="grantWindowOpenMonth" name="grantWindowOpenMonth">${monthOptions(lead?.grantWindowOpenMonth)}</select></div>
    <div class="form-group"><label for="grantWindowCloseMonth">Grant window closes</label><select class="form-control" id="grantWindowCloseMonth" name="grantWindowCloseMonth">${monthOptions(lead?.grantWindowCloseMonth)}</select></div>
    <div class="form-group"><label for="nextGrantDeadline">Next grant deadline</label><input class="form-control" id="nextGrantDeadline" name="nextGrantDeadline" type="date" value="${esc(verificationDateValue(lead?.nextGrantDeadline))}" /><span class="form-hint">Feeds the Grant-Cycle Radar on the Overview.</span></div>
    <div class="form-group copilot-launch"><label>Research copilot</label><button type="button" class="button button-secondary" data-action="open-copilot" data-target="lead-form">${svgIcon('spark')} Open research copilot</button><span class="form-hint">Web research (cited funder brief) or Paste-to-Extract; PII is scrubbed server-side before any AI call.</span></div>
    <div class="form-group"><label for="sourceName">Source name</label><input class="form-control" id="sourceName" name="sourceName" value="${esc(lead?.sourceName || '')}" placeholder="Annual report / grants page" /></div>
    <div class="form-group"><label for="sourceUrl">Source URL</label><input class="form-control" id="sourceUrl" name="sourceUrl" type="url" value="${esc(lead?.sourceUrl || '')}" placeholder="https://…" /></div>
    <div class="form-group"><label for="contactLastVerifiedAt">Contact last verified by staff</label><input class="form-control" id="contactLastVerifiedAt" name="contactLastVerifiedAt" type="date" value="${esc(verificationDateValue(lead?.contactLastVerifiedAt))}" /><span class="form-hint">Set only after confirming the person, role and details. DNS checks do not verify a mailbox.</span></div>
    <div class="form-group"><label for="sourceLastVerifiedAt">Source last checked</label><input class="form-control" id="sourceLastVerifiedAt" name="sourceLastVerifiedAt" type="date" value="${esc(verificationDateValue(lead?.sourceLastVerifiedAt))}" /></div>
    <div class="form-group"><label for="owner">Relationship owner</label><input class="form-control" id="owner" name="owner" value="${esc(lead?.owner || 'Nandi')}" /></div>
    <div class="form-group"><label for="stage">Pipeline stage</label><select class="form-control" id="stage" name="stage">${(state.data.stages || []).map(s => `<option ${s === (lead?.stage || 'New') ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="form-group full"><label for="relationshipContext">Relationship / warm-introduction context</label><textarea class="form-control" id="relationshipContext" name="relationshipContext" maxlength="800" placeholder="Who can introduce us, how they know this organisation, or the most appropriate first connection?">${esc(lead?.relationshipContext || '')}</textarea><span class="form-hint">Optional, staff-entered context. Keep it professional and avoid sensitive personal details.</span></div>
    <div class="form-group full"><label for="partnerPriorities">Partner priorities & timing</label><textarea class="form-control" id="partnerPriorities" name="partnerPriorities" maxlength="1200" placeholder="Known education/community priorities, budget or grant cycle, timing, employee volunteering or in-kind support.">${esc(lead?.partnerPriorities || '')}</textarea><span class="form-hint">Record observed or staff-confirmed priorities; this is not an AI fit decision.</span></div>
    <div class="form-group full"><label for="notes">Research notes</label><textarea class="form-control" id="notes" name="notes" placeholder="Why is this a good fit? Record relevant public information and context.">${esc(lead?.notes || '')}</textarea><span class="form-hint">Before drafting, Chelo requires a contact name, work email and a source name or URL. Contact and source dates are staff reminders, separate from DNS intake checks.</span></div>
  </div></form>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${edit ? 'Update prospect details' : 'Adds a source-backed prospect to your pipeline'}</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="lead-form" class="button button-primary">${svgIcon('save')}${edit ? 'Save changes' : 'Add prospect'}</button></div>`;
  return modalFrame(edit ? 'Edit prospect' : 'Add a prospect', 'Capture the organisation, a point of contact, the impact fit and the public source.', body, footer);
}
function candidateReviewModal(candidate) {
  if (!candidate) return '';
  const check = candidate.contactCheck || {};
  const issues = (check.issues || []).join(' · ');
  const body = `<form id="candidate-review-form" data-form="candidate-review" data-id="${esc(candidate.id)}"><div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>${check.status === 'retry-required' ? 'Temporary check issue' : 'Clarify contact details'}</strong><br>${esc(issues || 'Complete the source and contact fields. Saving runs the email-domain check again.')}</span></div><div class="form-grid">
    <div class="form-group full"><label for="cr-company">Organisation name *</label><input class="form-control" id="cr-company" name="company" required value="${esc(candidate.company || '')}" /></div>
    <div class="form-group"><label for="cr-contact">Contact name *</label><input class="form-control" id="cr-contact" name="contactName" value="${esc(candidate.contactName || '')}" placeholder="Full name" /></div>
    <div class="form-group"><label for="cr-title">Role / title</label><input class="form-control" id="cr-title" name="title" value="${esc(candidate.title || '')}" placeholder="e.g. CSI Manager" /></div>
    <div class="form-group full"><label for="cr-email">Work email</label><input class="form-control" id="cr-email" name="email" type="email" value="${esc(candidate.email || '')}" placeholder="name@organisation.org" /><span class="form-hint">Chelo checks syntax and domain/MX only. It does not test the individual mailbox or send a message.</span></div>
    <div class="form-group"><label for="cr-source-name">Source name</label><input class="form-control" id="cr-source-name" name="sourceName" value="${esc(candidate.sourceName || '')}" placeholder="Public report or programme page" /></div>
    <div class="form-group"><label for="cr-source-url">Source URL</label><input class="form-control" id="cr-source-url" name="sourceUrl" type="url" value="${esc(candidate.sourceUrl || '')}" placeholder="https://…" /></div>
    <div class="form-group"><label for="cr-contact-verified">Contact last verified by staff</label><input class="form-control" id="cr-contact-verified" name="contactLastVerifiedAt" type="date" value="${esc(verificationDateValue(candidate.contactLastVerifiedAt))}" /><span class="form-hint">Not inferred from DNS/MX. Set after confirming the person and details.</span></div>
    <div class="form-group"><label for="cr-source-verified">Source last checked</label><input class="form-control" id="cr-source-verified" name="sourceLastVerifiedAt" type="date" value="${esc(verificationDateValue(candidate.sourceLastVerifiedAt))}" /></div>
    <div class="form-group"><label for="cr-sector">Sector</label><input class="form-control" id="cr-sector" name="sector" value="${esc(candidate.sector || '')}" /></div>
    <div class="form-group full"><label for="cr-relationship">Relationship / warm-introduction context</label><textarea class="form-control" id="cr-relationship" name="relationshipContext" maxlength="800" placeholder="Who may introduce us or what existing relationship should guide the first contact?">${esc(candidate.relationshipContext || '')}</textarea></div>
    <div class="form-group full"><label for="cr-priorities">Partner priorities & timing</label><textarea class="form-control" id="cr-priorities" name="partnerPriorities" maxlength="1200" placeholder="Education/community priorities, grant cycle, budget timing, employee engagement or in-kind opportunities.">${esc(candidate.partnerPriorities || '')}</textarea></div>
    <div class="form-group full"><label for="cr-notes">Research notes</label><textarea class="form-control" id="cr-notes" name="notes" maxlength="2000">${esc(candidate.notes || '')}</textarea></div>
  </div></form>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">A passing domain is not mailbox verification.</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="candidate-review-form" class="button button-primary">${svgIcon('save')}Save and check again</button></div>`;
  return modalFrame('Review candidate contact', candidate.company, body, footer, true);
}
function candidateImportReportModal(report) {
  if (!report) return '';
  const stats = [
    ['Added to Discover', report.imported || 0], ['Discarded invalid email/domain', report.invalidDeleted || 0],
    ['Duplicates skipped', report.duplicates || 0], ['Opt-outs suppressed', report.suppressed || 0],
    ['Need clarification', report.needsClarification || 0], ['DNS retry required', report.retryRequired || 0],
    ['Need CSV correction', report.needsCorrection || 0], ['Missing organisation', report.missingOrganisation || 0]
  ];
  const rows = (report.issues || []).map(item => `<li><strong>Row ${Number(item.row)} · ${esc(item.status)}</strong><span>${esc(item.reason)}</span></li>`).join('');
  const body = `<p class="panel-description">Intake checks run before a candidate can enter the pipeline. Invalid syntax or a definitively non-mail domain is not retained. A domain check cannot confirm a personal mailbox.</p><div class="import-report-stats">${stats.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${Number(value)}</strong></div>`).join('')}</div>${rows ? `<h3 class="h-icon">${svgIcon('info')}Rows needing attention</h3><ul class="import-report-issues">${rows}</ul>` : `<div class="note-callout"><span class="note-callout-icon">${svgIcon('checkCircle')}</span><span>All imported rows passed the contact-intake checks. Staff review is still required before promotion.</span></div>`}`;
  const footer = `<div class="modal-footer-left"><span class="subtle">No email was sent.</span></div><div class="modal-footer-right"><button type="button" class="button button-primary" data-action="close-modal">${svgIcon('close')}Done</button></div>`;
  return modalFrame('CSV intake results', 'Check data before drafting or promotion.', body, footer, true);
}
function candidateCsvPreviewModal(preview) {
  if (!preview) return '';
  const rows = getCsvPreviewRows(preview);
  const selectedCount = rows.filter(row => row.selected).length;
  const duplicateCount = rows.filter(row => row.duplicate).length;
  const correctionCount = rows.filter(row => row.errors.length).length;
  const mapping = CSV_IMPORT_FIELDS.map(field => {
    const current = Number(preview.mapping[field.key] ?? -1);
    const options = [`<option value="-1" ${current < 0 ? 'selected' : ''}>Do not map</option>`, ...preview.headers.map((header, index) => `<option value="${index}" ${current === index ? 'selected' : ''}>${esc(header)} · column ${index + 1}</option>`)].join('');
    return `<label class="csv-map-field"><span>${esc(field.label)}</span><select class="form-control" data-csv-map="${esc(field.key)}">${options}</select></label>`;
  }).join('');
  const parserIssues = preview.parserErrors.map(item => `<li class="${item.fatal ? 'csv-fatal' : ''}"><strong>Line ${Number(item.line)}</strong> ${esc(item.message)}</li>`).join('');
  const rowMarkup = rows.map(row => {
    const review = row.errors.length ? `<span class="csv-row-status csv-row-error">Needs correction</span>` : row.duplicate ? `<span class="csv-row-status csv-row-duplicate">Possible duplicate</span>` : row.warnings.length ? `<span class="csv-row-status csv-row-warning">Clarification may be needed</span>` : `<span class="csv-row-status csv-row-ok">Ready for server check</span>`;
    const messages = [...row.errors, ...(row.duplicate ? [`Possible exact ${row.duplicate.type} match: ${row.duplicate.company}${row.duplicate.row ? ` · CSV row ${row.duplicate.row}` : ` · ${row.duplicate.location}`}.`] : []), ...row.warnings];
    const contact = [row.candidate.contactName, row.candidate.title, row.candidate.sector].filter(Boolean).join(' · ') || '—';
    const source = [row.candidate.sourceName, row.candidate.sourceUrl].filter(Boolean).join(' · ') || '—';
    const mappedRaw = key => { const column = Number(preview.mapping[key]); return Number.isInteger(column) && column >= 0 ? String(row.values[column] || '').trim() : ''; };
    const verification = `Contact: ${mappedRaw('contactLastVerifiedAt') || 'not recorded'} · Source: ${mappedRaw('sourceLastVerifiedAt') || 'not recorded'}`;
    const context = [row.candidate.relationshipContext, row.candidate.partnerPriorities].filter(Boolean).join(' · ') || '—';
    const amountText = mappedRaw('amount') ? (row.errors.some(error => error.startsWith('Potential contribution')) ? `Invalid amount: ${mappedRaw('amount')}` : money(row.candidate.amount)) : 'Amount not set';
    const fitText = mappedRaw('fitScore') ? `${mappedRaw('fitScore')}% staff fit` : 'Staff fit not set';
    const ask = [row.candidate.project || 'Project not selected', amountText, fitText, mappedRaw('owner') ? `Owner: ${mappedRaw('owner')}` : 'Owner unassigned'].join(' · ');
    return `<tr class="${row.errors.length ? 'csv-preview-error' : row.duplicate ? 'csv-preview-duplicate' : ''}"><td><input type="checkbox" class="csv-row-toggle" data-csv-row="${Number(row.rowNumber)}" ${row.selected ? 'checked' : ''} ${row.errors.length ? 'disabled' : ''} aria-label="Include CSV row ${Number(row.rowNumber)}" /></td><td>${Number(row.rowNumber)}</td><td><strong>${esc(row.candidate.company || 'Organisation missing')}</strong></td><td>${esc(contact)}<small>${esc(row.candidate.email || 'Email missing')}${row.candidate.phone ? `<br>${esc(row.candidate.phone)}` : ''}</small></td><td>${esc(source)}</td><td>${esc(verification)}</td><td>${esc(context)}</td><td>${esc(ask)}</td><td>${esc(row.candidate.notes || '—')}</td><td>${review}<small>${messages.map(esc).join('<br>') || 'No preview issues detected.'}</small></td></tr>`;
  }).join('');
  const fatal = preview.parserErrors.some(error => error.fatal);
  const body = `<div class="csv-preview-intro"><div><strong>${esc(preview.filename)}</strong><span>${rows.length} of ${Number(preview.totalRows)} rows shown · ${preview.headers.length} columns detected${preview.omittedRows ? ` · ${preview.omittedRows} rows not loaded` : ''}</span></div><div class="csv-preview-counts"><span>${selectedCount} selected</span><span>${duplicateCount} possible duplicates</span><span>${correctionCount} need correction</span></div></div>
    <div class="note-callout csv-preview-note"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>Review before intake.</strong> Duplicate suggestions use exact email or organisation matches; the server remains authoritative. Domain/MX checks run only after you confirm import. Missing contact/source details may be held in Discover for clarification, but cannot be promoted or drafted.</span></div>
    ${preview.omittedRows ? `<div class="form-error">Only the first 500 contact rows are shown. Split the CSV to review and import the remaining ${preview.omittedRows} rows.</div>` : ''}
    ${parserIssues ? `<ul class="csv-parser-issues">${parserIssues}</ul>` : ''}
    <div class="csv-map-header"><div><h3 class="h-icon">${svgIcon('grid')}Map your columns</h3><p>Auto-mapped by common header names. Adjust the fields before importing.</p></div><div class="csv-map-actions"><button type="button" class="button button-ghost button-small" data-action="csv-select-clean">${svgIcon('listCheck')}Select clean rows</button><button type="button" class="button button-ghost button-small" data-action="csv-clear-selection">${svgIcon('minus')}Clear selection</button></div></div>
    <div class="csv-mapping-grid">${mapping}</div>
    <div class="csv-table-wrap"><table class="table csv-preview-table"><thead><tr><th>Use</th><th>CSV row</th><th>Organisation</th><th>Contact</th><th>Public source</th><th>Last verified</th><th>Relationship / priorities</th><th>Project & ask</th><th>Research notes</th><th>Review flags</th></tr></thead><tbody>${rowMarkup}</tbody></table></div>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${selectedCount} selected · no email is sent</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="csv-preview-cancel">${svgIcon('close')}Cancel</button><button type="button" class="button button-primary" data-action="csv-import-confirm" ${fatal || !selectedCount ? 'disabled' : ''}>${svgIcon('upload')}Import ${selectedCount} selected to Discover</button></div>`;
  return modalFrame('Preview CSV intake', 'Map, inspect and choose rows before contact checks run.', body, footer, true, 'csv-import-modal');
}

function leadDetailModal(lead) {
  if (!lead) return '';
  const activities = (state.data.activities || []).filter(a => a.text.toLowerCase().includes(lead.company.toLowerCase())).slice(0, 5);
  const source = safeUrl(lead.sourceUrl);
  const contactFreshness = verificationFreshness(lead.contactLastVerifiedAt, 'Staff contact');
  const sourceFreshness = verificationFreshness(lead.sourceLastVerifiedAt, 'Source');
  const stageOptions = (state.data.stages || []).map(s => `<option ${s === lead.stage ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const actions = `<button class="button button-primary button-small" data-action="create-outreach" data-id="${esc(lead.id)}" ${lead.doNotContact ? 'disabled title="On do-not-contact list"' : ''}>${svgIcon('spark')} Prepare intro email</button><button class="button button-secondary button-small" data-action="email" data-id="${esc(lead.id)}" ${lead.doNotContact ? 'disabled title="On do-not-contact list"' : ''}>${svgIcon('mail')} Email only</button><button class="button button-secondary button-small" data-action="create-proposal" data-id="${esc(lead.id)}" ${lead.doNotContact ? 'disabled title="On do-not-contact list"' : ''}>${svgIcon('proposals')} ${(lead.kind || 'funder') === 'funder' ? 'Proposal PDF only' : `${esc(pdfLabels(lead).doc)} PDF`}</button><button class="button button-secondary button-small" data-action="edit-lead" data-id="${esc(lead.id)}">${svgIcon('edit')} Edit</button>${lead.doNotContact ? `<span class="status-pill status-requested" title="Hashed suppression remains after contact details are deleted">Opt-out suppression active</span>` : `<button class="button button-ghost button-small" data-action="opt-out" data-id="${esc(lead.id)}">${svgIcon('ban')}Do not contact</button>`}`;
  const health = lead.contactCheck || { status: 'unchecked', issues: [] };
  const healthText = health.status === 'ready' ? 'Email domain checked; individual mailbox not verified.' : health.status === 'retry-required' ? 'Temporary DNS issue; retry before drafting.' : health.status === 'needs-clarification' ? `Needs clarification: ${(health.issues || []).join(', ')}` : health.status === 'invalid' ? `Email check failed: ${health.reason || 'update the address'}` : 'Contact check runs before drafting.';
  const healthClass = health.status === 'ready' ? 'candidate-health-ready' : health.status === 'retry-required' || health.status === 'invalid' ? 'candidate-health-retry' : 'candidate-health-pending';
  const body = `<div class="detail-profile"><div class="detail-avatar">${initials(lead.company)}</div><div><h2>${esc(lead.company)}</h2><p>${esc(lead.sector || 'Prospective donor')} · ${esc(lead.contactName || 'Contact to identify')}</p></div></div>
    <div class="detail-actions">${actions}</div><span class="candidate-health ${healthClass}">${esc(healthText)}</span>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('pipeline')}Pipeline status</span> <span>${stagePill(lead.stage)}</span></div><div class="form-group"><select class="form-control" id="lead-stage-select" data-lead-stage="${esc(lead.id)}">${stageOptions}</select></div></div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('phone')}Point of contact</span></div><div class="detail-grid"><div class="detail-item"><small>Name / role</small><strong>${esc(lead.contactName || 'Not added')} · ${esc(lead.title || '—')}</strong></div><div class="detail-item"><small>Email</small><a href="mailto:${encodeURIComponent(lead.email || '')}">${esc(lead.email || 'Not added')}</a></div><div class="detail-item"><small>Phone</small><strong>${esc(lead.phone || 'Not added')}</strong></div><div class="detail-item"><small>Relationship owner</small><strong>${esc(lead.owner || 'Unassigned')}</strong></div><div class="detail-item"><small>Contact verified by staff</small><strong class="${contactFreshness.className}">${esc(contactFreshness.text)}${lead.contactLastVerifiedAt ? ` · ${esc(dateOnly(lead.contactLastVerifiedAt))}` : ''}</strong></div></div></div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('target')}Opportunity</span></div><div class="detail-grid"><div class="detail-item"><small>Potential contribution</small><strong>${money(lead.amount)}</strong></div><div class="detail-item"><small>Fit score</small><strong>${Number(lead.fitScore || 0)}% match</strong></div><div class="detail-item"><small>Verified project</small><strong>${esc(lead.project || 'Not specified')}</strong>${lead.projectId ? `<button type="button" class="table-action" data-action="open-project" data-id="${esc(lead.projectId)}">${svgIcon('grid')}View funding gap</button>` : ''}</div><div class="detail-item"><small>Grant cycle</small><strong>${esc(grantCycleLabel(lead))}</strong></div><div class="detail-item"><small>Next action</small><strong>${esc(lead.nextAction || 'Review')}</strong></div></div></div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('link')}Research provenance</span></div><div class="detail-item"><small>Recorded public source</small>${source ? `<a class="source-link" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(lead.sourceName || source)} ${svgIcon('external')}</a>` : `<strong>${esc(lead.sourceName || 'No source recorded')}</strong>`}<small class="${sourceFreshness.className}">${esc(sourceFreshness.text)}${lead.sourceLastVerifiedAt ? ` · ${esc(dateOnly(lead.sourceLastVerifiedAt))}` : ''}</small></div></div>
    ${researchDetailSection(lead)}
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('partners')}Relationship and partner priorities</span></div><div class="detail-grid"><div class="detail-item"><small>Warm-introduction / relationship context</small><div class="detail-note">${esc(lead.relationshipContext || 'No introduction path recorded yet.')}</div></div><div class="detail-item"><small>Partner priorities and timing</small><div class="detail-note">${esc(lead.partnerPriorities || 'No priorities or timing recorded yet.')}</div></div></div></div>
    ${lead.notes ? `<div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('edit')}Research notes</span></div><div class="detail-note">${esc(lead.notes)}</div></div>` : ''}
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('mail')}Outreach status</span></div><div class="detail-grid"><div class="detail-item"><small>Email</small><strong>${esc(lead.emailStatus || 'Not started')}</strong></div><div class="detail-item"><small>Follow-up</small><strong>${lead.followUpAt ? isoDate(lead.followUpAt) : 'Not scheduled'}</strong></div></div>${lead.proposalFile ? `<div class="attachment-row"><div class="attachment-info"><span class="pdf-icon">PDF</span><span>Chelo partnership proposal<small>Generated ${isoDate(lead.updatedAt)}</small></span></div><a class="button button-secondary button-small" href="${proposalDownload(lead)}" download>${svgIcon('download')}Download</a></div>` : ''}</div>
    <div class="detail-section rel-strip"><div class="detail-section-title"><span class="section-title-text">${svgIcon('partners')}Relationship memory</span><button type="button" class="button button-ghost button-small" data-action="rel-open" data-id="${esc(lead.id)}">${svgIcon('activity')}Timeline, people & pledges</button></div><div class="rel-strip-grid"><div><small>Introduced by</small><strong>${esc(lead.introducer || '—')}</strong>${lead.introducedVia ? `<span class="subtle">${esc(lead.introducedVia)}</span>` : ''}</div><div><small>Foundation link</small><strong>${esc(lead.foundationName || lead.parentCompany || '—')}</strong></div><div><small>Owner</small><strong>${esc(lead.owner || 'Unassigned')}</strong></div><div><small>Next action</small><strong>${esc(lead.nextAction || '—')}</strong></div>${lead.orgCheck ? `<div><small>Organisation check</small><strong>${orgPill(lead.orgCheck)}</strong><span class="subtle">${esc(lead.orgCheck.domain || '')}${lead.orgCheck.reason ? ` · ${esc(lead.orgCheck.reason)}` : ''}</span></div>` : ''}${lead.discovered ? `<div><small>Discovered via</small><strong>SA CSI catalogue</strong><span class="subtle">${esc(relDate(lead.discovered.importedAt))}</span></div>` : ''}</div></div>
    ${activities.length ? `<div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('activity')}Recent activity</span></div>${activities.map(a => `<div class="shortcut-row"><div class="shortcut-icon">${svgIcon(a.type === 'booking' ? 'calendar' : a.type === 'proposal' ? 'proposals' : 'check')}</div><div class="shortcut-copy"><strong>${esc(a.text)}</strong><span>${isoDate(a.createdAt)}</span></div></div>`).join('')}</div>` : ''}`;
  const footer = `<div class="modal-footer-left"><span class="subtle">Created ${isoDate(lead.createdAt)}</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Close</button>${lead.stage !== 'Won' ? `<button type="button" class="button button-primary" data-action="mark-won" data-id="${esc(lead.id)}">${svgIcon('trophy')}Mark as won</button>` : `<button class="button button-lime" data-view="partners">${svgIcon('partners')}View partner</button>`}</div>`;
  return modalFrame('Prospect details', 'Review context and take the next step.', body, footer);
}
const PDF_LABELS = {
  funder: { doc: 'Partnership proposal', modalTitle: 'Personalise the proposal', intro: c => `Create a guided, donor-specific proposal for ${c}.`, button: 'Generate proposal PDF', opening: 'Partnership summary', impact: 'The opportunity', rationale: 'Why Chelo', nextStep: 'Recommended next step', notes: 'Chelo project and campaign notes', amount: 'Staff-selected contribution (ZAR)', project: 'Staff-selected project / impact focus', draft: 'Generate guided draft', card: 'proposal' },
  media: { doc: 'Press backgrounder', modalTitle: 'Press backgrounder', intro: c => `A one-page backgrounder ${c} can file the story from: what Chelo is, why now, facts, spokesperson and assets. Built from the approved media kit; edit any paragraph.`, button: 'Generate backgrounder PDF', opening: 'The story (what Chelo is, in two sentences)', impact: 'Why now (the hook for this outlet)', rationale: 'Extra facts for this story (optional)', nextStep: 'What we offer (interview, site visit, pictures)', notes: 'Notes for this outlet (not printed)', amount: '', project: 'Project or story focus', draft: 'Fill from media kit', card: 'backgrounder' },
  school: { doc: 'Project brief for the school', modalTitle: 'Brief for the principal', intro: c => `A plain-language page for ${c}: the need as Chelo understood it, what happens next, and what the school does. No funder language; no money passes through the school.`, button: 'Generate school brief PDF', opening: 'What Chelo does (plain words)', impact: 'The need as we understood it', rationale: 'What happens next', nextStep: 'What the school does', notes: 'Notes from the call (not printed)', amount: 'Estimate from the call (ZAR)', project: 'Need / project name', draft: 'Fill from the call notes', card: 'school brief' },
  supplier: { doc: 'Scope of works · quote request', modalTitle: 'Scope of works', intro: c => `The quote request ${c} receives: site, scope, how to quote and how payment works. Pre-filled from the open quote request on the linked project.`, button: 'Generate scope of works PDF', opening: 'Site and context', impact: 'Scope of works', rationale: 'How to quote', nextStep: 'How payment and sign-off work', notes: 'Internal notes (not printed)', amount: 'Budget guide (ZAR, optional)', project: 'Project', draft: 'Fill from the quote request', card: 'scope of works' }
};
function pdfLabels(lead) { return PDF_LABELS[lead?.kind || 'funder'] || PDF_LABELS.funder; }
function proposalModal(lead) {
  if (!lead) return '';
  const saved = lead.proposalData || {};
  const PL = pdfLabels(lead); const funderDoc = (lead.kind || 'funder') === 'funder';
  const aiConfigured = Boolean(state.data.aiConfigured) && funderDoc;
  const aiNote = aiConfigured
    ? `AI drafting is connected${state.data.aiModel ? ` (${esc(state.data.aiModel)})` : ''}. It can use aggregate preferred-time outcomes as a directional hint for future wording; it cannot change the staff-selected ask or verified facts.`
    : 'AI is not connected in this preview. The guided local draft demonstrates the workflow; configure OPENAI_API_KEY on the server for model-generated drafts and rewrites.';
  const body = `<form id="proposal-form" data-form="proposal" data-id="${esc(lead.id)}"><input type="hidden" name="generationMode" id="p-generation-mode" value="${esc(saved.generationMode || 'manual')}" />
    ${funderDoc ? `<div class="ai-guidance-card"><div class="ai-guidance-icon">${svgIcon('spark')}</div><div><strong>${aiConfigured ? 'AI-guided proposal writing' : 'Guided proposal preview'}</strong><p>${aiNote}</p><small>Guardrails: verified recipients · traceable funding · impact reporting · no invented metrics or unconfirmed outcomes.</small></div></div>
    ${researchBriefCard(lead, 'proposal')}` : `<div class="ai-guidance-card"><div class="ai-guidance-icon">${svgIcon('file')}</div><div><strong>${esc(PL.doc)}</strong><p>${esc(PL.intro(lead.company))}</p><small>Same Chelo look as the funder proposal; different words for a different reader. Press “${esc(PL.draft)}” to pre-fill, then edit.</small></div></div>`}
    <div class="form-grid">
    <div class="form-group full"><label for="p-company">Prepared for</label><input class="form-control" id="p-company" name="company" value="${esc(saved.company || lead.company)}" required readonly /></div>
    <div class="form-group"><label for="p-contact">Attention</label><input class="form-control" id="p-contact" name="contactName" value="${esc(saved.contactName || lead.contactName || '')}" readonly /></div>
    ${PL.amount ? `<div class="form-group"><label for="p-amount">${esc(PL.amount)}</label><input class="form-control" id="p-amount" name="amount" type="number" min="0" step="1000" value="${Number(saved.amount ?? lead.amount ?? 0) || ''}" ${funderDoc ? 'readonly' : ''} /></div>` : ''}
    <div class="form-group full"><label for="p-project">${esc(PL.project)}</label><input class="form-control" id="p-project" name="project" value="${esc(saved.project || lead.project || '')}" ${funderDoc ? 'required readonly' : ''} />${funderDoc ? '<span class="form-hint">To change the ask, return to Prepare outreach. This editor changes proposal wording only.</span>' : ''}</div>
    <div class="form-group full"><label for="p-user-notes">${esc(PL.notes)}</label><textarea class="form-control" id="p-user-notes" name="userNotes" maxlength="3000" placeholder="Add verified project facts, community need, intended use of funds, milestones, reporting needs and anything the proposal should reflect.">${esc(saved.userNotes || '')}</textarea><span class="form-hint">Use confirmed information only; avoid sensitive personal details. Notes guide the draft and are not printed verbatim in the PDF.</span></div>
    ${funderDoc ? `<div class="form-group full"><label for="p-verified-metrics">Verified metric comparisons <span class="optional">(optional, up to 3)</span></label><textarea class="form-control metric-entry" id="p-verified-metrics" name="verifiedMetrics" rows="3" placeholder="Attendance rate | 72 | 85 | % | 2024 to 2025 | School attendance summary, p. 4">${esc(verifiedMetricsText(saved.verifiedMetrics))}</textarea><span class="form-hint">One comparison per line: Metric | baseline | latest | unit | period | source. Cite a source you have checked. Leave blank if there is no verified comparable data; the PDF will not invent values.</span></div>` : ''}
    <div class="form-group full"><label for="p-opening">${esc(PL.opening)}</label><textarea class="form-control" id="p-opening" name="opening" maxlength="${funderDoc ? 180 : 900}" placeholder="Generate a guided draft or write this section.">${esc(saved.opening || '')}</textarea></div>
    <div class="form-group full"><label for="p-impact">${esc(PL.impact)}</label><textarea class="form-control" id="p-impact" name="impact" maxlength="${funderDoc ? 260 : 900}" placeholder="What need will this partnership help address?">${esc(saved.impact || '')}</textarea></div>
    <div class="form-group full"><label for="p-rationale">${esc(PL.rationale)}</label><textarea class="form-control" id="p-rationale" name="rationale" maxlength="${funderDoc ? 300 : 900}">${esc(saved.rationale || '')}</textarea></div>
    <div class="form-group full"><label for="p-next">${esc(PL.nextStep)}</label><textarea class="form-control" id="p-next" name="nextStep" maxlength="${funderDoc ? 200 : 900}">${esc(saved.nextStep || '')}</textarea></div>
    <div class="form-group full"><label for="p-rewrite-notes">Rewrite request <span class="optional">(optional)</span></label><textarea class="form-control" id="p-rewrite-notes" name="rewriteNotes" maxlength="1000" placeholder="e.g. Make it more concise, lead with school solar, and keep the ask tentative.">${esc(saved.rewriteNotes || '')}</textarea></div>
    <div class="form-group full ai-action-row"><button type="button" class="button button-secondary button-small" data-action="proposal-draft" data-id="${esc(lead.id)}">${svgIcon('spark')} ${aiConfigured ? 'Generate AI draft' : esc(PL.draft)}</button>${funderDoc ? `<button type="button" class="button button-secondary button-small" data-action="proposal-rewrite" data-id="${esc(lead.id)}">${svgIcon('wand')}${aiConfigured ? 'Request rewrite' : 'Preview rewrite'}</button>` : ''}<span id="proposal-draft-status" class="subtle">${esc(saved.generationMode === 'openai' ? 'Last draft generated with AI.' : saved.generationMode === 'guided-preview' ? 'Last draft was a local guided preview.' : 'Draft copy is editable before PDF generation.')}</span></div>
    </div></form>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${lead.proposalFile ? 'Regenerating replaces the previous PDF.' : 'Review content before creating the PDF.'}</span></div><div class="modal-footer-right"><button class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="proposal-form" class="button button-primary">${svgIcon('proposals')} ${esc(PL.button)}</button></div>`;
  return modalFrame(PL.modalTitle, funderDoc ? `Create a guided, donor-specific proposal for ${lead.company}.` : PL.intro(lead.company), body, footer, true);
}
function outreachModal(lead) {
  if (!lead) return '';
  const saved = lead.proposalData || {};
  const aiConfigured = Boolean(state.data.aiConfigured);
  const aiNote = aiConfigured
    ? `Connected model: ${esc(state.data.aiModel || 'configured AI')}. It may use aggregate preferred-time results to refine wording; staff keep the selected project, contribution and verified facts fixed.`
    : 'No AI provider is configured. The guided local preview demonstrates the email workflow; it is not model-generated.';
  const body = `<div class="ai-guidance-card"><div class="ai-guidance-icon">${svgIcon('spark')}</div><div><strong>Prepare the first-touch invitation</strong><p>${aiNote}</p><small>This email’s only ask is a 20-minute introductory video chat. No proposal PDF or proposal link is included.</small></div></div>
    ${researchBriefCard(lead, 'outreach')}
    <form id="outreach-form" data-form="outreach" data-id="${esc(lead.id)}"><div class="form-grid">
      <div class="form-group full"><label for="o-project">Staff-selected project / impact focus *</label><input class="form-control" id="o-project" name="project" value="${esc(saved.project || lead.project || '')}" required placeholder="The specific project you want to discuss" /></div>
      <div class="form-group"><label for="o-amount">Staff-selected contribution amount (ZAR) *</label><input class="form-control" id="o-amount" name="amount" type="number" min="0" step="1000" value="${Number(saved.amount ?? lead.amount ?? 0) || ''}" required placeholder="250000" /></div>
      <div class="form-group"><label for="o-contact">Point of contact</label><input class="form-control" name="contactName" id="o-contact" value="${esc(lead.contactName || '')}" /></div>
      <div class="form-group full"><label for="o-notes">Verified project notes</label><textarea class="form-control" id="o-notes" name="userNotes" maxlength="3000" placeholder="Add only confirmed context that will make the invitation relevant.">${esc(saved.userNotes || lead.notes || '')}</textarea><span class="form-hint">Use confirmed facts only. Do not include sensitive personal information or unverified outcomes.</span></div>
      <div class="form-group full"><label for="o-rewrite">Drafting instructions <span class="optional">(optional)</span></label><textarea class="form-control" id="o-rewrite" name="rewriteNotes" maxlength="1000" placeholder="e.g. Keep the invitation especially concise and lead with the verified local connection.">${esc(saved.rewriteNotes || '')}</textarea></div>
    </div></form>
    <div class="workflow-steps"><span>1 · Confirm the staff-selected context</span><span>2 · Draft the intro email</span><span>3 · Preview and approve</span></div>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">No PDF is needed for this first touch. No email is sent automatically.</span></div><div class="modal-footer-right"><button class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="outreach-form" class="button button-primary">${svgIcon('spark')} Generate intro email</button></div>`;
  return modalFrame('Prepare introductory outreach', `Invite ${lead.company} to a 20-minute video briefing.`, body, footer, true);
}
function makeEmailDraft(lead, followUp) {
  const book = bookingLink(lead);
  const optOut = optOutLink(lead);
  const name = String(lead.contactName || '').trim().split(/\s+/)[0];
  const greeting = name ? `Dear ${name},` : 'Hello,';
  const company = String(lead.company || '').replace(/\s·\sDemo$/, '');
  const project = lead.project || 'an education impact project';
  const amount = Number(lead.amount || 0) ? `, with a staff-proposed contribution of ${money(lead.amount)}` : '';
  let subject, body;
  if (followUp) {
    const step = Number(lead.followUpStep || 1);
    subject = step === 2 ? `Final note: ${company.split(/\s+/).slice(0, 2).join(' ')}` : `Following up: ${project}`;
    body = `${greeting}

${step === 2 ? 'A final note in case this is relevant to your team.' : `I’m following up on my note about a possible Chelo partnership focused on ${project}.`}

Which education or community-impact priorities are most important to your team this year?

Yes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${book}
Chelo will review your preferred time and confirm it personally. No preparation or commitment is required.

If the timing is not right, no problem.

Kind regards,
Chelo Partnerships Team

Don't want more emails from Chelo? Opt out: ${optOut}`;
  } else {
    subject = makeClientOutreachSubject(company, project);
    body = `${greeting}

I’m reaching out because ${company}’s work in ${lead.sector || 'community investment'} may align with Chelo’s focus on verified schools, NGOs and community projects, with traceable funding and progress reporting.

One possible focus is ${project}${amount}. Scope and feasibility would be validated with the project partner before any commitment. A short video conversation would let us hear your priorities, share how Chelo works, and explore whether a next step makes sense.

Which education or community-impact priorities are most important to your team this year?

Yes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${book}
Chelo will review your preferred time and confirm it personally. No preparation or commitment is required.

Kind regards,
Chelo Partnerships Team

Don't want more emails from Chelo? Opt out: ${optOut}`;
  }
  return { subject, body };
}
function makeClientOutreachSubject(company, project) {
  const prefix = (value, maxChars, maxWords) => {
    let output = '';
    for (const word of String(value || '').replace(/\s*&\s*/g, ' ').split(/\s+/).filter(Boolean).slice(0, maxWords)) {
      const next = output ? `${output} ${word}` : word;
      if (next.length > maxChars && output) break;
      output = next;
    }
    return output || 'Education partnership';
  };
  const projectLabel = prefix(String(project || 'education partnership').split(/[|;.!?]/)[0], 27, 2);
  const companyLabel = prefix(String(company || '').replace(/\s·\sDemo$/, ''), 22, 2);
  const candidates = [`${projectLabel} partnership: ${companyLabel}`, `Chelo partnership: ${projectLabel} · ${companyLabel}`, `${projectLabel} for ${companyLabel}`, `Chelo + ${companyLabel}: ${projectLabel}`];
  return candidates.find(value => value.length >= 36 && value.length <= 50) || candidates.sort((a,b)=>Math.abs(a.length-43)-Math.abs(b.length-43))[0].slice(0,58).trim();
}
function emailReadinessScore(lead, subject, rawBody, followUp = false, attachProposalRequested = false) {
  const attachProposal = Boolean(followUp && lead?.proposalFile && attachProposalRequested);
  const rawText = String(rawBody || '');
  const body = emailBodyForAttachmentMode(rawText, attachProposal);
  const plain = body.replace(/https?:\/\/\S+/g, ' ');
  const paragraphs = body.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  const words = (plain.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
  const subjectText = String(subject || '').trim();
  const subjectLength = [...subjectText].length;
  const company = String(lead?.company || '').replace(/\s·\sDemo$/, '').toLowerCase();
  const project = String(lead?.proposalData?.project || lead?.project || '').toLowerCase();
  const sector = String(lead?.sector || '').toLowerCase();
  const intro = paragraphs.slice(1, 2).join(' ').toLowerCase();
  const amount = Number(lead?.proposalData?.amount ?? lead?.amount ?? 0);
  const amountText = amount ? money(amount).toLowerCase() : '';
  const priorityQuestion = 'Which education or community-impact priorities are most important to your team this year?';
  const questionMarks = (body.replace(/\n\s*Don't want more emails from Chelo\? Opt out:.*$/i, '').match(/\?/g) || []).length;
  const metrics = Array.isArray(lead?.proposalData?.verifiedMetrics) ? lead.proposalData.verifiedMetrics : [];
  const sections = lead?.proposalData || {};
  const currencyValues = plain.match(/\bR\s*[\d,]+(?:\.\d{1,2})?\b/gi) || [];
  const amountConsistent = !amount || (followUp
    ? currencyValues.every(value => Number(value.replace(/[^\d.]/g, '')) === amount)
    : plain.toLowerCase().includes(amountText));

  let subjectScore = 0;
  if (subjectLength >= 36 && subjectLength <= 50) subjectScore += 8;
  else if (subjectLength <= 60) subjectScore += 5;
  else if (subjectLength) subjectScore += 2;
  const subjectRelevant = [company, project].filter(Boolean).some(value => {
    const key = value.split(/\s+/).slice(0, 2).join(' ');
    return key.length > 3 && subjectText.toLowerCase().includes(key);
  });
  if (subjectRelevant) subjectScore += 5;
  if (!/\b(quick question|urgent|guaranteed|act now|limited time)\b/i.test(subjectText)) subjectScore += 2;

  let introScore = 0;
  if (company && intro.includes(company)) introScore += 5;
  if (sector && intro.includes(sector)) introScore += 5;
  if (/chelo/.test(intro) && /(verified|traceable|accountab|progress|report)/.test(intro)) introScore += 5;
  if (/(may align|could align|explore|possible|relevant)/.test(intro)) introScore += 5;

  let bodyScore = words >= 95 && words <= 155 ? 8 : words >= 70 && words <= 180 ? 5 : words ? 2 : 0;
  if (project && plain.toLowerCase().includes(project)) bodyScore += 4;
  if (amountConsistent) bodyScore += 4;
  if (paragraphs.length >= 4 && paragraphs.length <= 8) bodyScore += 4;

  const questionScore = body.includes(priorityQuestion) && questionMarks === 1 ? 10 : body.includes(priorityQuestion) ? 6 : 0;
  let ctaScore = 0;
  if (/yes\s*[—-]\s*choose a time/i.test(body)) ctaScore += 4;
  if (/preferred time/i.test(body)) ctaScore += 2;
  if (/20[- ]minute/i.test(body)) ctaScore += 3;
  if (/video/i.test(body)) ctaScore += 2;
  if (/chelo.{0,100}confirm/i.test(body)) ctaScore += 2;
  if (/\/track\/cta\/|\/book\//i.test(body)) ctaScore += 2;
  let outroScore = 0;
  const attachmentClaim = /(?:proposal|pdf).{0,60}(?:attach|enclos)|(?:attach|enclos).{0,60}(?:proposal|pdf)/i.test(rawText);
  const proposalUrl = /https?:\/\/[^\s]*(?:proposal|track\/proposal)/i.test(rawText);
  if (attachProposal ? /proposal.{0,40}attached|attached.{0,40}proposal/i.test(body) : !attachmentClaim && !proposalUrl) outroScore += 3;
  if (/no preparation/i.test(body)) outroScore += 2;
  if (/no commitment/i.test(body)) outroScore += 2;
  let closingScore = 0;
  if (/opt.?out/i.test(body)) closingScore += 2;
  if (/kind regards|regards,|sincerely,/i.test(body)) closingScore += 1;
  const verifiedMetricSourceScore = metrics.length === 0 || metrics.every(metric => String(metric.source || '').trim()) ? 1 : 0;
  const attachmentRows = attachProposal ? [
    ['Prepared PDF attached', lead?.proposalFile ? 2 : 0, 2],
    ['PDF summary', String(sections.opening || '').trim() ? 2 : 0, 2],
    ['PDF opportunity', String(sections.impact || '').trim() ? 2 : 0, 2],
    ['PDF rationale', String(sections.rationale || '').trim() ? 2 : 0, 2],
    ['PDF next step', String(sections.nextStep || '').trim() ? 1 : 0, 1],
    ['Metric source', verifiedMetricSourceScore, 1]
  ] : [['First touch has no PDF/link', !attachmentClaim && !proposalUrl ? 10 : 0, 10]];
  const rows = [
    ['Subject', subjectScore, 15], ['Introduction', introScore, 20], ['Body & fixed ask', bodyScore, 20],
    ['Priority question', questionScore, 10], ['20-minute video CTA', ctaScore, 15],
    ['No-pressure close', outroScore, 7], ['Closing & opt-out', closingScore, 3],
    ...attachmentRows
  ];
  return { total: rows.reduce((sum, row) => sum + row[1], 0), rows };
}
function emailReadinessCard(lead, subject, body, followUp, attachProposal = false) {
  const result = emailReadinessScore(lead, subject, body, followUp, attachProposal);
  return `<section class="email-readiness-card" aria-live="polite" aria-label="Outreach readiness checklist"><div class="email-readiness-head"><div><span class="readiness-kicker">Quality checklist</span><strong><span id="email-score-total">${result.total}</span><small> / 100</small></strong></div><p>Checks the subject, opening, staff-selected ask, single priorities question, 20-minute video CTA and close. The first-touch is intentionally PDF-free; this is not a predicted reply or booking probability.</p></div><div class="email-readiness-track" role="progressbar" aria-label="Checklist completeness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${result.total}"><span id="email-score-progress" style="width:${result.total}%"></span></div><div class="email-readiness-grid" id="email-readiness-grid">${result.rows.map(([label, score, max]) => `<span class="readiness-chip ${score >= max * .7 ? 'is-ready' : ''}"><strong>${esc(label)}</strong><small>${score}/${max}</small></span>`).join('')}</div><small class="readiness-footnote">A 36–50 character subject is only a starting heuristic. Section checks assess completeness, not truth. Performance is evaluated against preferred-time requests, not estimated opens.</small></section>`;
}
function updateEmailReadiness() {
  if (state.modal?.type !== 'email') return;
  const lead = getLead(state.modal.id);
  if (!lead) return;
  const result = emailReadinessScore(lead, $('#email-subject')?.value || '', $('#email-body')?.value || '', Boolean(state.modal.followUp), Boolean(state.modal?.followUp && ($('#email-attach-proposal')?.checked || state.modal.attachProposal)));
  const total = $('#email-score-total'); if (total) total.textContent = String(result.total);
  const progress = $('#email-score-progress'); if (progress) progress.style.width = `${result.total}%`;
  const bar = $('.email-readiness-track'); if (bar) bar.setAttribute('aria-valuenow', String(result.total));
  const grid = $('#email-readiness-grid');
  if (grid) grid.innerHTML = result.rows.map(([label, score, max]) => `<span class="readiness-chip ${score >= max * .7 ? 'is-ready' : ''}"><strong>${esc(label)}</strong><small>${score}/${max}</small></span>`).join('');
}
function emailModal(lead, followUp) {
  if (!lead) return '';
  const saved = followUp ? lead.followUpDraft : lead.emailDraft;
  const attachProposal = Boolean(followUp && followUpPdfSelected({ ...lead, followUpDraft: saved }));
  const draftSource = state.modal?.editedDraft || (saved ? { ...saved } : makeEmailDraft(lead, followUp));
  const draft = { ...draftSource, body: emailBodyForAttachmentMode(draftSource.body, attachProposal) };
  const approved = followUp ? lead.followUpEmailStatus === 'Approved' && Boolean(lead.followUpApprovedAt) : lead.emailStatus === 'Approved' && Boolean(lead.approvedAt);
  const pendingSecond = (followUp ? lead.followUpEmailStatus : lead.emailStatus) === 'Pending second approval';
  const approval = followUp ? lead.followUpApproval : lead.emailApproval;
  const fourEyes = state.auth.approvalPolicy === 'four-eyes';
  const iAmFirstApprover = approval && (approval.firstApproverId === (state.auth.userId || state.auth.username));
  const noEmail = !lead.email;
  const smtpReady = Boolean(state.data.settings?.smtpConfigured);
  const aiConfigured = Boolean(state.data.aiConfigured);
  const pixelNote = state.data.settings?.openTrackingEnabled ? (state.data.settings?.openTrackingReady ? 'SMTP and .eml can include best-effort open tracking; mailto does not. Opens may be blocked or affected by privacy proxies.' : 'Open pixels are not included until a public HTTPS URL is set in Settings.') : 'Open measurement is disabled.';
  const sequenceNote = attachProposal
    ? 'This follow-up will include the prepared proposal PDF as a real attachment.'
    : followUp
      ? (lead.proposalFile ? 'This follow-up stays text-only unless you explicitly select the prepared PDF below.' : 'This follow-up is text-only; prepare a proposal after the briefing or if the recipient requests one.')
      : 'This first-touch invitation is intentionally text-only—no PDF and no proposal link. Share a proposal after the call or if requested.';
  const proposalTitle = lead.proposalFile ? 'Proposal PDF prepared for later' : followUp ? 'No proposal PDF prepared' : 'No proposal PDF needed for the intro';
  const proposalNote = attachProposal ? 'This real PDF will be attached to the approved follow-up.' : lead.proposalFile ? (followUp ? 'It stays separate unless you select the attachment checkbox above.' : 'It will not be attached to this introductory email.') : (followUp ? 'Keep this reminder text-only unless a proposal is prepared after the briefing or requested.' : 'Prepare one after the conversation or if the recipient requests it.');
  const proposalCard = attachProposal
    ? `<div class="attachment-row"><div class="attachment-info"><span class="pdf-icon">PDF</span><span>Prepared proposal will be attached to this follow-up<small>The .eml and SMTP handoff include the real PDF attachment.</small></span></div><a class="button button-ghost button-small" href="${proposalPreview(lead)}" target="_blank" rel="noopener noreferrer">${svgIcon('eye')}Preview</a><a class="button button-secondary button-small" href="${proposalDownload(lead)}" download>${svgIcon('download')} Download</a><button class="button button-secondary button-small" type="button" data-action="create-proposal" data-id="${esc(lead.id)}">${svgIcon('proposals')}Edit PDF</button></div>`
    : `<div class="attachment-row"><div class="attachment-info"><span class="pdf-icon">PDF</span><span>${proposalTitle}<small>${proposalNote}</small></span></div>${lead.proposalFile ? `<a class="button button-ghost button-small" href="${proposalPreview(lead)}" target="_blank" rel="noopener noreferrer">${svgIcon('eye')}Preview</a><a class="button button-secondary button-small" href="${proposalDownload(lead)}" download>${svgIcon('download')} Download</a><button class="button button-secondary button-small" type="button" data-action="create-proposal" data-id="${esc(lead.id)}">${svgIcon('proposals')}Edit PDF</button>` : `<button class="button button-secondary button-small" type="button" data-action="create-proposal" data-id="${esc(lead.id)}">${svgIcon('proposals')}Prepare for later</button>`}</div>`;
  const body = `<div class="note-callout" style="margin-bottom:13px"><span class="note-callout-icon">${svgIcon('info')}</span><span><strong>Preview → approve → hand off.</strong> ${sequenceNote} ${smtpReady ? 'Approved email can be sent through configured SMTP; acceptance is not proof of inbox delivery.' : 'Use the .eml handoff or mailto fallback; mailto cannot attach files.'} ${esc(pixelNote)} Confirm manual handoffs in Chelo to start the 5- and 10-business-day follow-ups.</span></div>
    ${followUp ? `<div class="followup-draft-controls"><button type="button" class="button button-secondary button-small" data-action="generate-follow-up" data-id="${esc(lead.id)}">${svgIcon('spark')} ${aiConfigured ? 'Generate performance-informed follow-up' : 'Refresh guided follow-up'}</button><small>${aiConfigured ? 'Uses aggregate preferred-time request patterns when the sample is sufficient. Draft only—staff approval is still required.' : 'Local guided preview only. Configure an AI provider to use aggregate outcome patterns.'}</small></div>` : ''}
    <div class="form-grid single"><div class="form-group"><label>To</label><input class="form-control" value="${esc(lead.email || 'Add a work email before outreach')}" readonly /></div><div class="form-group"><label for="email-subject">Subject</label><input class="form-control" id="email-subject" maxlength="200" value="${esc(saved?.subject || draft.subject)}" /></div><div class="form-group"><label for="email-body">${followUp ? 'Follow-up message' : 'Introductory email · edit before approving'}</label><textarea class="form-control" id="email-body" style="min-height:215px" maxlength="8000">${esc(draft.body)}</textarea></div></div>
    ${followUp && lead.proposalFile ? `<label class="check-row email-attachment-choice"><input id="email-attach-proposal" type="checkbox" ${attachProposal ? 'checked' : ''} ${approved ? 'disabled' : ''} /> Attach the prepared PDF to this follow-up <small>${approved ? 'This email is approved; save it as a draft before changing the attachment choice.' : 'Leave unchecked for a text-only reminder. Only attach a current proposal after the briefing or if the recipient requested it.'}</small></label>` : ''}
    ${emailReadinessCard(lead, saved?.subject || draft.subject, draft.body, followUp, attachProposal)}
    <div class="email-cta-preview"><span>PRIMARY EMAIL CTA</span><a href="${esc(bookingPageLink(lead))}" target="_blank" rel="noopener noreferrer">Yes — choose a time ${svgIcon('arrow')}</a><small>Opens the booking form for a ${INTRO_MEETING_MINUTES}-minute introductory video chat. Contact details are prefilled; Chelo manually confirms a requested time.</small></div>
    ${proposalCard}
    ${approval ? `<div class="approval-trail"><span class="approval-trail-title">${svgIcon('shield')} Who approved${fourEyes ? ' · two people must approve' : ''}</span><span>1st · ${esc(approval.firstApprover || '—')} · ${approval.firstApprovedAt ? isoDate(approval.firstApprovedAt) : ''}</span>${approval.secondApprover ? `<span>2nd · ${esc(approval.secondApprover)} · ${isoDate(approval.secondApprovedAt)}</span>` : pendingSecond ? `<span class="approval-pending">Awaiting countersignature by a different Admin or Reviewer</span>` : ''}<small>Digest ${esc(String(approval.digest || '').slice(0, 20))}… · content is locked; any edit voids approval.</small></div>` : ''}
    ${lead.doNotContact ? `<div class="form-error">This contact is on the do-not-contact list. Outreach is disabled.</div>` : ''}${noEmail ? `<div class="form-error">Add the contact’s email address before approving this message.</div>` : ''}`;
  let rightButtons = '';
  if (pendingSecond) {
    const canCountersign = ['admin', 'reviewer'].includes(state.auth.role) && !iAmFirstApprover;
    rightButtons = `<button type="button" class="button button-secondary" data-action="email-return" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('back')}Return to draft</button><button type="button" class="button button-primary" data-action="email-countersign" data-id="${esc(lead.id)}" data-follow-up="${followUp}" ${canCountersign ? '' : 'disabled'} title="${canCountersign ? 'Countersign this exact content' : iAmFirstApprover ? 'A different staff member must countersign' : 'Admin or Reviewer role required'}">${svgIcon('check')} Countersign (2nd approval)</button>`;
  } else if (approved) {
    const emlLabel = attachProposal ? 'Download .eml + PDF attached' : 'Download .eml (no attachment)';
    rightButtons = `<button type="button" class="button button-secondary" data-action="email-save-draft" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('save')}Save edits</button>${smtpReady ? `<button type="button" class="button button-primary" data-action="send-smtp" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('send')} Send via SMTP</button>` : ''}<a class="button ${smtpReady ? 'button-secondary' : 'button-primary'}" href="${attachedEmailDraft(lead, followUp)}" download>${svgIcon(attachProposal ? 'paperclip' : 'download')} ${emlLabel}</a><button type="button" class="button button-secondary" data-action="email-open" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('external')} Open mailto fallback</button><button type="button" class="button button-lime" data-action="mark-sent" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('check')} Mark sent</button>`;
  } else {
    rightButtons = `<button type="button" class="button button-secondary" data-action="email-save-draft" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('save')}Save draft</button><button type="button" class="button button-primary" data-action="email-approve" data-id="${esc(lead.id)}" data-follow-up="${followUp}" ${noEmail || lead.doNotContact ? 'disabled' : ''}>${svgIcon('check')} Approve email</button>`;
  }
  const footer = `<div class="modal-footer-left"><span class="subtle">${approved ? `Approved${approval?.secondApprover ? ' · two signatures' : ''}` : pendingSecond ? '1 of 2 approvals recorded' : fourEyes ? 'Two staff approvals required before handoff' : 'Approval required before handoff'}</span>${approved ? `<button type="button" class="button button-ghost button-small" data-action="email-return" data-id="${esc(lead.id)}" data-follow-up="${followUp}">${svgIcon('back')}Return to draft</button>` : ''}</div><div class="modal-footer-right">${rightButtons}</div>`;
  const followLabel = `Follow-up ${Number(lead.followUpStep || 1)} of 2`;
  return modalFrame(followUp ? `Review ${followLabel.toLowerCase()}` : 'Personalise outreach', `${followUp ? followLabel : 'First-touch intro'} · ${lead.company}`, body, footer, true);
}
function partnerModal(partner) {
  if (!partner) return '';
  const body = `<form id="partner-form" data-form="partner" data-id="${esc(partner.id)}"><div class="form-grid"><div class="form-group full"><label for="partner-company">Partner organisation</label><input class="form-control" id="partner-company" name="company" value="${esc(partner.company)}" required /></div><div class="form-group"><label for="partner-contact">Point of contact</label><input class="form-control" id="partner-contact" name="contactName" value="${esc(partner.contactName || '')}" /></div><div class="form-group"><label for="partner-title">Role / title</label><input class="form-control" id="partner-title" name="title" value="${esc(partner.title || '')}" /></div><div class="form-group"><label for="partner-email">Email</label><input class="form-control" id="partner-email" name="email" type="email" value="${esc(partner.email || '')}" /></div><div class="form-group"><label for="partner-phone">Phone</label><input class="form-control" id="partner-phone" name="phone" value="${esc(partner.phone || '')}" /></div><div class="form-group"><label for="partner-contact-verified">Contact last verified by staff</label><input class="form-control" id="partner-contact-verified" name="contactLastVerifiedAt" type="date" value="${esc(verificationDateValue(partner.contactLastVerifiedAt))}" /><span class="form-hint">Separate from any email-domain check.</span></div><div class="form-group"><label for="partner-source-verified">Source last checked</label><input class="form-control" id="partner-source-verified" name="sourceLastVerifiedAt" type="date" value="${esc(verificationDateValue(partner.sourceLastVerifiedAt))}" /></div><div class="form-group"><label for="partner-amount">Contribution value (ZAR)</label><input class="form-control" id="partner-amount" name="amount" type="number" min="0" step="1000" value="${Number(partner.amount || 0)}" /></div><div class="form-group"><label for="partner-status">Relationship status</label><select class="form-control" id="partner-status" name="status"><option ${partner.status === 'Active' ? 'selected' : ''}>Active</option><option ${partner.status === 'Stewardship' ? 'selected' : ''}>Stewardship</option><option ${partner.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></div><div class="form-group full"><label for="partner-project">Project focus</label><input class="form-control" id="partner-project" name="project" value="${esc(partner.project || '')}" /></div><div class="form-group"><label for="partner-owner">Relationship owner</label><input class="form-control" id="partner-owner" name="owner" value="${esc(partner.owner || '')}" /></div><div class="form-group"><label for="partner-introducer">Introduced by</label><input class="form-control" id="partner-introducer" name="introducer" value="${esc(partner.introducer || '')}" /></div><div class="form-group"><label for="partner-introduced-via">How the door opened</label><input class="form-control" id="partner-introduced-via" name="introducedVia" value="${esc(partner.introducedVia || '')}" /></div><div class="form-group"><label for="partner-foundation">Linked foundation / trust</label><input class="form-control" id="partner-foundation" name="foundationName" value="${esc(partner.foundationName || '')}" /></div><div class="form-group"><label for="partner-parent">Parent company</label><input class="form-control" id="partner-parent" name="parentCompany" value="${esc(partner.parentCompany || '')}" /></div><div class="form-group"><label for="partner-fye">Financial year-end</label><select class="form-control" id="partner-fye" name="financialYearEnd"><option value="">Unknown</option>${FYE_MONTHS.map((m, i) => `<option value="${i + 1}" ${Number(partner.financialYearEnd) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div class="form-group"><label for="partner-renewal">Renewal date (overrides FYE-based renewal)</label><input class="form-control" id="partner-renewal" name="renewalAt" type="date" value="${esc(partner.renewalAt || '')}" /></div><div class="form-group"><label for="partner-source-name">Key public source</label><input class="form-control" id="partner-source-name" name="sourceName" value="${esc(partner.sourceName || '')}" /></div><div class="form-group full"><label for="partner-source-url">Source URL</label><input class="form-control" id="partner-source-url" name="sourceUrl" type="url" value="${esc(partner.sourceUrl || '')}" /></div><div class="form-group full"><label for="partner-relationship">Relationship / warm-introduction context</label><textarea class="form-control" id="partner-relationship" name="relationshipContext" maxlength="800">${esc(partner.relationshipContext || '')}</textarea></div><div class="form-group full"><label for="partner-priorities">Partner priorities & timing</label><textarea class="form-control" id="partner-priorities" name="partnerPriorities" maxlength="1200" placeholder="Education/community priorities, budget cycle, upcoming decisions, employee engagement or in-kind support.">${esc(partner.partnerPriorities || '')}</textarea></div><div class="form-group full"><label for="partner-notes">Stewardship notes</label><textarea class="form-control" id="partner-notes" name="notes">${esc(partner.notes || '')}</textarea></div></div></form>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">Partner record · ${isoDate(partner.partnerSince)}</span></div><div class="modal-footer-right"><button class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button class="button button-primary" type="submit" form="partner-form">${svgIcon('save')}Save partner</button></div>`;
  return modalFrame('Edit partner profile', 'Keep the point of contact, priorities and stewardship context current.', body, footer, true);
}

function toast(message, error = false) {
  const root = $('#toast-root');
  const el = document.createElement('div'); el.className = `toast ${error ? 'error' : ''}`; el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function renderAuthGate() { $('#app').innerHTML = authGateView(); $('#modal-root').innerHTML = ''; }
// Hosts without a background worker (Vercel) rely on the app nudging the engine: send what is due, read inboxes every 10 min.
let lastNudge = 0;
function nudgeEngine(force = false) {
  if (!state.auth?.authenticated && !state.data) return;
  if (!force && Date.now() - lastNudge < 60e3) return;
  lastNudge = Date.now();
  API('/api/engine/nudge', { method: 'POST', body: '{}' }).then(r => { if (r && ((r.ran || 0) > 0 || (r.inboxes && r.inboxes.matched > 0))) refresh().catch(() => {}); }).catch(() => {});
}
if (typeof setInterval === 'function') setInterval(() => { if (document.visibilityState === 'visible') nudgeEngine(); }, 5 * 60e3);
if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nudgeEngine(); });
async function refresh() {
  try { state.data = await API('/api/init'); if (typeof setTimeout === 'function') setTimeout(() => nudgeEngine(), 1500); renderApp(); if (typeof window.inboxLoad === 'function' && state.ix?.data) window.inboxLoad({ silent: true }); if (state.view === 'review' && state.review && !state.review.loading) openSendPreview(state.review.id, Number(state.review.step || 0)); }
  catch (error) {
    if (error.status === 401) { state.auth = await API('/api/auth/status').catch(() => ({ authenticated: false, setupRequired: false })); renderAuthGate(); return; }
    throw error;
  }
}
async function loadAnalytics(days = state.analyticsRange) {
  state.analyticsLoading = true;
  try { state.data.analytics = await API(`/api/analytics?days=${encodeURIComponent(days)}`); }
  catch (error) { toast(error.message || 'Could not load analytics.', true); }
  finally { state.analyticsLoading = false; if (state.view === 'ops') renderApp(); }
}
async function loadAudit() {
  const requestId = ++auditRequestId;
  const query = state.auditQuery.trim();
  const preserveFocus = document.activeElement?.id === 'audit-search';
  const caret = preserveFocus ? document.activeElement.selectionStart : null;
  try { const result = await API(`/api/audit?limit=1000&query=${encodeURIComponent(query)}`); if (requestId !== auditRequestId) return; state.auditLogs = result.entries || []; }
  catch (error) { if (requestId !== auditRequestId) return; state.auditLogs = []; toast(error.message || 'Could not load the audit trail.', true); }
  if (state.view === 'settings' && state.settingsSection === 'audit') {
    renderApp();
    if (preserveFocus) { const input = $('#audit-search'); input?.focus(); if (input && caret != null) input.setSelectionRange(caret, caret); }
  }
}
function openModal(type, id = null, extras = {}) { state.modal = { type, id, ...extras }; renderApp(); }
function closeModal() { if (state.modal?.type === 'csv-preview') state.csvImportPreview = null; state.modal = null; renderApp(); }
// Retired sections redirect to their merged home (bookmarks and phone deep links keep working).
const VIEW_ALIASES = {
  discover: () => { state.wb.intake = 'pool'; return 'workbench'; },
  pipeline: () => { state.prospectsMode = 'board'; return 'prospects'; },
  analytics: () => { state.ops.tab = 'analytics'; return 'ops'; },
  deliverability: () => { state.ops.tab = 'deliverability'; return 'ops'; },
  data: () => { state.ops.tab = 'data'; return 'ops'; },
  partners: () => 'partners',
  proposals: () => 'prospects' // proposals now live on each funder's page (PDF always travels with the email)
};
function resolveView(view) { return VIEW_ALIASES[view] ? VIEW_ALIASES[view]() : view; }
function setView(view) {
  view = resolveView(view);
  if (!deskAllowsView(view)) view = 'workbench'; // v70: a desk only opens its own sections
  if (view === 'ops' && !isRoot() && ROOT_ONLY_OPS_TABS.includes(state.ops.tab || 'health')) state.ops.tab = 'analytics';
  state.view = view; state.modal = null; state.mobileMoreOpen = false;
  if (!['workbench', 'discover', 'prospects', 'pipeline', 'partners', 'sent', 'projects'].includes(view)) state.query = '';
  if (view === 'workbench') wbRunPending();
  if (view === 'overview') loadRadar();
  if (view === 'partners') loadRelationships(true);
  if (view === 'workbench' && state.wb.intake === 'pool') loadCatalogue();
  if (view === 'ops') { if (isRoot()) loadOps(true); if (state.ops.tab === 'analytics') loadAnalytics(state.analyticsRange); if (state.ops.tab === 'deliverability') loadDeliverability(); if (state.ops.tab === 'data') loadDataQuality(); }
  renderApp(); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'settings' && state.settingsSection === 'audit') loadAudit();
}
function formDataObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function verifiedMetricsText(metrics) {
  return (Array.isArray(metrics) ? metrics : []).map(metric => [metric.label, metric.baselineValue, metric.currentValue, metric.unit, metric.period, metric.source].join(' | ')).join('\n');
}
function getEmailFields() { return { subject: $('#email-subject')?.value?.trim() || '', body: $('#email-body')?.value || '' }; }
function getProposalFields() {
  const form = $('#proposal-form');
  if (!form) return null;
  const data = formDataObject(form);
  data.amount = Number(data.amount || 0);
  data.currentDraft = { opening: data.opening, impact: data.impact, rationale: data.rationale, nextStep: data.nextStep };
  return data;
}
function fillProposalDraft(result) {
  for (const key of ['opening', 'impact', 'rationale', 'nextStep']) {
    const field = $(`#p-${key === 'opening' ? 'opening' : key === 'nextStep' ? 'next' : key}`);
    if (field && result.draft?.[key]) field.value = result.draft[key];
  }
  const mode = $('#p-generation-mode'); if (mode) mode.value = result.mode || 'manual';
  const status = $('#proposal-draft-status'); if (status) status.textContent = result.message || 'Draft refreshed. Review and edit before generating the PDF.';
}

async function dispatchAction(button) {
  const action = button.dataset.action;
  if (String(action || '').startsWith('m-') && typeof window.mobileAction === 'function') { if (await window.mobileAction(action, button)) return; }
  if (String(button.dataset.action || '').startsWith('ix-') && typeof window.inboxAction === 'function') { if (await window.inboxAction(button.dataset.action, button)) return; }
  if (/^(wb-|seq-)/.test(String(action || '')) || action === 'triage-apply') { if (await wbAction(action, button)) return; }
  if (String(button.dataset.action || '').startsWith('dlv-')) { if (await dlvAction(button.dataset.action, button)) return; }
  if (String(button.dataset.action || '').startsWith('dq-')) { if (await dqAction(button.dataset.action, button)) return; }
  if (String(button.dataset.action || '').startsWith('rel-')) { if (await relAction(button.dataset.action, button)) return; }
  if (String(button.dataset.action || '').startsWith('cat-')) { if (await catAction(button.dataset.action, button)) return; }
  if (button.dataset.action === 'ops-refresh') { await loadOps(true); return; }
  if (button.dataset.action === 'ops-area') { state.ops.area = button.dataset.area; renderApp(); return; }
  const id = button.dataset.id;
  try {
    if (action === 'close-modal') return closeModal();
    if (action === 'csv-preview-cancel') { state.csvImportPreview = null; return closeModal(); }
    if (action === 'csv-import-confirm') return importCandidateCsvPreview();
    if (action === 'csv-select-clean' || action === 'csv-clear-selection') {
      const preview = state.csvImportPreview;
      if (!preview) return;
      const rows = getCsvPreviewRows(preview);
      for (const row of rows) {
        const raw = preview.rows.find(item => item.rowNumber === row.rowNumber);
        if (raw) raw.include = action === 'csv-select-clean' ? row.errors.length === 0 && !row.duplicate : false;
      }
      renderApp(); return;
    }
    if (action === 'refresh-radar') { await loadRadar(); toast('Radar refreshed.'); return; }
    if (action === 'mobile-more') { state.mobileMoreOpen = !state.mobileMoreOpen; renderApp(); return; }
    if (action === 'mobile-more-close') { state.mobileMoreOpen = false; renderApp(); return; }
    if (action === 'demo-login') {
      const result = await API('/api/auth/demo', { method: 'POST', body: '{}' });
      state.auth = result; state.authError = ''; state.view = 'overview';
      await refresh();
      if (!state.auth?.authenticated || !state.auth?.demoAccess) throw new Error('Demo sign-in did not persist in this browser. Refresh and try again.');
      toast('Demo admin access enabled. Use fictional sample data only.'); return;
    }
    if (action === 'logout') {
      if (state.auth.openAccessDemo) return toast('Authentication is disabled in this disposable demo workspace.');
      await API('/api/auth/logout', { method: 'POST', body: '{}' });
      state.auth = await API('/api/auth/status').catch(() => ({ authenticated: false, setupRequired: false }));
      state.authError = ''; state.view = 'overview'; renderAuthGate(); return;
    }
    if (action === 'test-ai' || action === 'test-smtp' || action === 'test-search') {
      button.disabled = true;
      try {
        const form = button.closest('form[data-form="settings"]');
        if (form) { await saveSettingsForm(form); } // test what you just typed, not what was saved last week
        const result = await API(`/api/settings/${action}`, { method: 'POST', body: '{}' });
        if (form) await refresh();
        toast(result.message || 'Connection test succeeded.');
      } catch (err) { toast(`${err.message}`, true); }
      finally { button.disabled = false; }
      return;
    }
    if (action === 'send-smtp') {
      const lead = getLead(id); const followUp = button.dataset.followUp === 'true';
      const attachProposal = Boolean(followUp && followUpPdfSelected(lead));
      if (!lead || !confirm(`Send the approved ${followUp ? 'follow-up' : 'email'} to ${lead.email} ${attachProposal ? 'with the prepared proposal PDF attached' : 'without a PDF attachment'} through SMTP?${state.data.settings?.openTrackingReady ? '\n\nA best-effort open-tracking pixel will be included.' : ''}`)) return;
      button.disabled = true;
      try {
        const result = await API(`/api/leads/${encodeURIComponent(id)}/send-email`, { method: 'POST', body: JSON.stringify({ kind: followUp ? 'follow-up' : 'initial' }) });
        state.modal = null; if (state.view !== 'workbench') state.view = 'sent'; await refresh();
        toast(result.message || 'Queued for sending.');
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'public-opt-out') {
      const token = location.pathname.split('/').filter(Boolean).pop();
      await API(`/api/public/opt-out/${encodeURIComponent(token)}`, { method: 'POST', body: '{}' });
      state.optOutDone = true; state.optOutInfo.optedOut = true; renderPublicOptOut(); return;
    }
    if (action === 'dismiss-demo') { state.dismissDemo = true; return renderApp(); }
    if (action === 'new-lead') return openModal('lead-form');
    if (action === 'candidate-import') { $('#candidate-csv')?.click(); return; }
    if (action === 'candidate-review') return openModal('candidate-review', id);
    if (action === 'candidate-recheck') {
      const result = await API(`/api/candidates/${encodeURIComponent(id)}/check`, { method: 'POST', body: '{}' });
      await refresh();
      if (result.deleted) return toast(result.message || 'Candidate contact data was removed.');
      return toast(result.message || 'Contact check updated.', result.candidate?.contactCheck?.status !== 'ready');
    }
    if (action === 'promote-candidate') {
      button.disabled = true;
      let result;
      try { result = await API(`/api/candidates/${encodeURIComponent(id)}/promote`, { method: 'POST', body: JSON.stringify({ run: true }) }); }
      catch (err) { button.disabled = false; return toast(err.message, true); }
      if (result.deleted) { await refresh(); return toast(result.error || 'That email address does not work, so the row was removed.', true); }
      if (!result.lead) { await refresh(); return toast('Already added earlier.'); }
      state.view = 'workbench'; state.wb.intake = 'add'; state.wb.filter = 'all'; state.wb.selectedId = result.lead.id; state.query = '';
      await refresh();
      toast(result.alreadyAdded ? `${result.lead.company} is already in To do.` : `${result.lead.company} added — Chelo is checking the address, researching and drafting.`);
      if (!result.alreadyAdded) wbPollFlow(result.lead.id);
      return;
    }
    if (action === 'pool-select-all') {
      const q = state.query.trim().toLowerCase();
      const shown = state.data.candidates.filter(c => !c.promotedLeadId && c.status === 'New candidate' && (state.candidateFilter === 'All candidates' || c.status === state.candidateFilter) && (!q || [c.company, c.contactName, c.email, c.sector].join(' ').toLowerCase().includes(q))).map(c => c.id);
      const all = shown.every(id => (state.wb.poolPicks || []).includes(id));
      state.wb.poolPicks = all ? [] : shown; renderApp(); return;
    }
    if (action === 'pool-run-selected') {
      const ids = (state.wb.poolPicks || []).slice(); if (!ids.length) return;
      state.wb.busy.pool = true; renderApp();
      try {
        const r = await API('/api/candidates/promote-run', { method: 'POST', body: JSON.stringify({ ids }) });
        state.wb.poolPicks = []; state.wb.intake = 'add'; state.wb.filter = 'all'; if (r.added?.length) state.wb.selectedId = r.added[0].id;
        await refresh();
        toast(`${r.added.length} added — Chelo is working through them.${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped.map(x => `${x.company || x.id} (${x.reason})`).join('; ')}` : ''}`, Boolean(r.skipped.length && !r.added.length));
        r.added.forEach(l => wbPollFlow(l.id));
      } catch (err) { toast(err.message, true); }
      finally { delete state.wb.busy.pool; renderApp(); }
      return;
    }
    if (action === 'media-kit-save-approve') { const form = $('#media-kit-form'); if (!form) return; const data = formDataObject(form); data.facts = String(data.facts || '').split('\n').map(x => x.trim()).filter(Boolean); if (!String(data.boilerplate || '').trim()) return toast('Write the boilerplate paragraph first.', true); state.mediaKit = await API('/api/media-kit', { method: 'PUT', body: JSON.stringify({ ...data, approve: true }) }); toast('Media kit saved and approved — waiting pitches are being written.'); await refresh(); return; }
    if (action === 'photo-pin') { await API(`/api/projects/${encodeURIComponent(id)}/photo`, { method: 'PUT', body: JSON.stringify({ theme: button.dataset.theme, n: Number(button.dataset.n) }) }); toast('Picture pinned for this project.'); await refresh(); return; }
    if (action === 'photo-unpin') { await API(`/api/projects/${encodeURIComponent(id)}/photo`, { method: 'PUT', body: JSON.stringify({ theme: '' }) }); toast('Back to automatic rotation.'); await refresh(); return; }
    if (action === 'sch-toggle') { state.sch.collapsed = !state.sch.collapsed; try { localStorage.setItem('chelo-sch-collapsed', state.sch.collapsed ? '1' : ''); } catch {} renderApp(); return; }
    if (action === 'supporters-match') { const r = await API(`/api/projects/${encodeURIComponent(id)}/supporters`); state.sup.tell = { projectId: id, ...r }; renderApp(); return; }
    if (action === 'supporters-tell') { const r = await API(`/api/projects/${encodeURIComponent(id)}/supporters/tell`, { method: 'POST', body: '{}' }); state.sup.tell = null; toast(`${r.queued} supporter${r.queued === 1 ? '' : 's'} emailed a pledge link${r.failed.length ? ` (${r.failed.length} could not be queued)` : ''}.`); await refresh(); return; }
    if (action === 'pledge-status') { const r = await API(`/api/leads/${encodeURIComponent(id)}/pledges/${encodeURIComponent(button.dataset.pledge)}`, { method: 'PUT', body: JSON.stringify({ status: button.dataset.status }) }); toast(`Pledge ${r.pledge.status}.`); await refresh(); return; }
    if (action === 'sme-find') {
      const trade = $('#sme-trade')?.value || 'building'; const town = $('#sme-town')?.value?.trim() || ''; if (!town) { toast('Give a town so the search stays local.', true); return; }
      state.sup.sme = { trade, town, busy: true, results: [], picked: {}, error: '', done: null }; renderApp();
      try { const r = await API(`/api/discovery/search?q=${encodeURIComponent(`${TRADE_LABELS[trade] || trade} ${town}`)}`); const results = r.organisations || []; state.sup.sme = { trade, town, busy: false, results, picked: Object.fromEntries(results.map((o, i) => [i, !o.alreadyTracked && Boolean(o.mailbox?.email)])), error: results.length ? '' : (r.warnings || []).join(' ') || 'Nothing found with a mailbox. Try a nearby bigger town.', done: null }; }
      catch (err) { state.sup.sme = { trade, town, busy: false, results: [], picked: {}, error: err.message, done: null }; }
      renderApp(); return;
    }
    if (action === 'sme-invite') {
      const f = state.sup.sme; const items = f.results.filter((o, i) => f.picked[i]).map(o => ({ name: o.name, website: o.website, email: o.mailbox?.email, mailbox: o.mailbox }));
      const r = await API('/api/suppliers/invite', { method: 'POST', body: JSON.stringify({ trade: f.trade, town: f.town, items }) });
      state.sup.sme = { ...f, done: r, picked: {}, results: f.results.map(o => items.some(i => i.email === o.mailbox?.email) ? { ...o, alreadyTracked: true } : o) }; toast(`${r.queued} invitation${r.queued === 1 ? '' : 's'} queued.`); renderApp(); return;
    }
    if (action === 'sup-open') { state.wb.filter = 'all'; state.wb.selectedId = id; setView('workbench'); return; }
    if (action === 'desk-add') {
      const desk = currentDesk();
      if (desk === 'suppliers') { const l = state.sup.link || await API('/api/suppliers/signup-link'); state.sup.link = l; await navigator.clipboard?.writeText(l.url).catch(() => {}); toast('Supplier sign-up link copied. Share it on WhatsApp groups and with district offices.'); if (state.view !== 'workbench') setView('workbench'); return; }
      if (desk === 'schools') { state.sch.collapsed = false; try { localStorage.setItem('chelo-sch-collapsed', '0'); } catch {} setView('workbench'); return; }
      state.wb.intake = 'add'; setView('workbench'); setTimeout(() => $('#wb-add-form input[name="company"]')?.focus(), 50); return;
    }
    if (action === 'open-media-kit') { state.settingsSection = 'media-kit'; setView('settings'); return; }
    if (action === 'mfa-restart') { state.mfaChallenge = null; state.authError = ''; renderAuthGate(); return; }
    if (action === 'mfa-setup') { state.mfa.setup = await API('/api/auth/mfa/setup', { method: 'POST', body: '{}' }); renderApp(); return; }
    if (action === 'mfa-cancel') { state.mfa.setup = null; renderApp(); return; }
    if (action === 'mfa-codes-saved') { state.mfa.recoveryCodes = null; renderApp(); return; }
    if (action === 'revoke-sessions') { const r = await API('/api/auth/sessions/revoke-all', { method: 'POST', body: '{}' }); toast(r.revoked ? `Signed out of ${r.revoked} other session${r.revoked === 1 ? '' : 's'}.` : 'No other sessions were open.'); return; }
    if (action === 'staff-signout') { const u = state.data.staff.find(x => x.id === id); if (!u || !confirm(`End every session of ${u.displayName}? They will need to sign in again.`)) return; const r = await API(`/api/staff/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ signOutEverywhere: true }) }); toast(`${u.displayName}: ${r.revoked} session${r.revoked === 1 ? '' : 's'} ended.`); await refresh(); return; }
    if (action === 'staff-mfa-reset') { const u = state.data.staff.find(x => x.id === id); if (!u || !confirm(`Switch two-step off for ${u.displayName} and sign them out everywhere? Only do this after confirming it is really them (call back on a known number).`)) return; await API(`/api/staff/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ mfaReset: true }) }); toast(`${u.displayName} can sign in with password only until they set two-step up again.`); await refresh(); return; }
    if (action === 'vet') { const notes = $('#vet-notes')?.value || ''; const r = await API(`/api/leads/${encodeURIComponent(id)}/vetting`, { method: 'PUT', body: JSON.stringify({ status: button.dataset.status, notes }) }); toast(`${r.lead.company}: ${r.vetting.status}.`); await refresh(); return; }
    if (action === 'copy-text') { try { await navigator.clipboard.writeText(button.dataset.text); toast('Copied.'); } catch { toast(button.dataset.text); } return; }
    if (action === 'tender-match') { const modal = button.closest('.modal, .modal-frame, body'); const trade = $('#tender-trade')?.value; const province = $('#tender-province')?.value ?? ''; const r = await API(`/api/suppliers/match?trade=${encodeURIComponent(trade)}&province=${encodeURIComponent(province)}&projectId=${encodeURIComponent(id)}`); state.sup.match = { trade, province, ...r }; renderApp(); return; }
    if (action === 'tender-open') { const body = { trade: $('#tender-trade')?.value, province: $('#tender-province')?.value ?? '', closesInDays: $('#tender-days')?.value || 7, brief: $('#tender-brief')?.value || '' }; const r = await API(`/api/projects/${encodeURIComponent(id)}/tender`, { method: 'POST', body: JSON.stringify(body) }); state.sup.match = null; toast(`Need sent to ${r.queued} supplier${r.queued === 1 ? '' : 's'}${r.failed.length ? ` (${r.failed.length} could not be queued)` : ''}. Quote link copied below.`); await refresh(); return; }
    if (action === 'tender-reopen') { state.sup.reopen = id; state.sup.match = null; renderApp(); return; }
    if (action === 'tender-widen') { const r = await API(`/api/projects/${encodeURIComponent(id)}/tender/widen`, { method: 'POST', body: '{}' }); toast(`Sent to ${r.wave.queued} more supplier${r.wave.queued === 1 ? '' : 's'} ${r.wave.label}.`); await refresh(); return; }
    if (action === 'doc-save') { const row = button.closest('tr'); const body = { key: button.dataset.key, status: row.querySelector('select').value, ref: row.querySelector('input[data-ref]').value, expiresAt: row.querySelector('input[data-exp]')?.value || '' }; const r = await API(`/api/leads/${encodeURIComponent(id)}/documents`, { method: 'PUT', body: JSON.stringify(body) }); toast(`${r.lead.company}: document ${r.document.status}.`); await refresh(); return; }
    if (action === 'tender-close') { await API(`/api/projects/${encodeURIComponent(id)}/tender/close`, { method: 'POST', body: '{}' }); toast('Quote request closed.'); await refresh(); return; }
    if (action === 'quote-status') { const feePct = button.dataset.status === 'signed' ? ($('#tender-fee')?.value ?? '') : null; const r = await API(`/api/projects/${encodeURIComponent(id)}/tender/quotes/${encodeURIComponent(button.dataset.quote)}`, { method: 'PUT', body: JSON.stringify({ status: button.dataset.status, feePct }) }); toast(`${r.quote.company}: ${r.quote.status}.`); await refresh(); return; }
    if (action === 'tender-done') { const confirmedBy = $('#tender-confirmed-by')?.value || ''; const notes = $('#tender-done-notes')?.value || ''; const r = await API(`/api/projects/${encodeURIComponent(id)}/tender/done`, { method: 'POST', body: JSON.stringify({ confirmedBy, notes }) }); toast(`${r.project.recipientName} confirmed the work is done.`); await refresh(); return; }
    if (action === 'dbe-load') { state.sch.busy = true; renderApp(); try { const r = await API('/api/schools/load', { method: 'POST', body: '{}' }); state.sch.status = r.status; toast(`DBE list loaded: ${r.imported.toLocaleString('en-ZA')} schools.`); } catch (err) { toast(err.message, true); } finally { state.sch.busy = false; state.sch.treeKey = ''; renderApp(); } return; }
    if (action === 'dbe-upload') { $('#dbe-csv')?.click(); return; }
    if (action === 'sch-nav') { Object.assign(state.sch, { province: button.dataset.province || '', district: button.dataset.district || '', circuit: '', q: '' }); schLoadTree(); return; }
    if (action === 'sch-add') { state.sch.busy = true; renderApp(); try { const r = await API(`/api/schools/${encodeURIComponent(id)}/add`, { method: 'POST', body: '{}' }); toast(r.alreadyAdded ? `${r.lead.company} is already in To do.` : `${r.lead.company} added — ${r.lead.email ? 'Chelo checks the email and writes the first note.' : 'no published email, so a call task opens with the script.'}`); if (r.lead.id) { state.wb.selectedId = r.lead.id; wbPollFlow(r.lead.id); } await refresh(); state.sch.list = null; await schLoadList(); } catch (err) { toast(err.message, true); } finally { state.sch.busy = false; renderApp(); } return; }
    if (action === 'call-log') { const notes = $('#call-notes')?.value || ''; const when = $('#call-when')?.value || ''; const outcome = button.dataset.outcome; const r = await API(`/api/leads/${encodeURIComponent(id)}/call`, { method: 'POST', body: JSON.stringify({ outcome, notes, callBackAt: outcome === 'call-back' ? when : '', bookedAt: outcome === 'booked' ? when : '' }) }); toast(outcome === 'booked' ? `Call booked with ${r.lead.company}. Capture the needs when you speak.` : `Logged: ${outcome}.`); await refresh(); return; }
    if (action === 'need-project') { const r = await API(`/api/leads/${encodeURIComponent(id)}/needs/${encodeURIComponent(button.dataset.need)}/project`, { method: 'POST', body: '{}' }); toast(`Verified Project created: ${r.project.name}. Add the budget and photos under Projects.`); await refresh(); return; }
    if (action === 'media-kit-approve') { state.mediaKit = await API('/api/media-kit/approve', { method: 'POST', body: '{}' }); renderApp(); toast(state.mediaKit.rerun ? `Media kit approved — ${state.mediaKit.rerun} waiting pitch${state.mediaKit.rerun === 1 ? ' is' : 'es are'} being written now.` : 'Media kit approved — pitches can go out.'); await refresh(); return; }
    if (action === 'pitch-track') { await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pitchTrack: button.dataset.track }) }); toast(button.dataset.track === 'partnership' ? 'Partnership pitch — Chelo redrafts.' : 'PR pitch — Chelo redrafts.'); await wbRunFlow(id, { redraft: true }); return; }
    if (action === 'media-outcome') { const on = button.dataset.on !== 'false'; const r = await API(`/api/leads/${encodeURIComponent(id)}/outcome`, { method: 'PUT', body: JSON.stringify({ outcome: button.dataset.outcome, on }) }); toast(on ? `${button.dataset.outcome.charAt(0).toUpperCase()}${button.dataset.outcome.slice(1)} recorded for ${r.lead.company}.` : 'Cleared.'); await refresh(); return; }
    if (action === 'desk-switch') { try { localStorage.setItem(DESK_KEY, button.dataset.desk); } catch {} if (!deskAllowsView(state.view, button.dataset.desk)) state.view = 'workbench'; state.wb.selectedId = null; state.wb.discovery = { query: '', results: [], busy: false, error: '' }; if (state.ix) state.ix.data = null; refresh(); return; }
    if (action === 'edit-lead') return openModal('lead-form', id);
    if (action === 'lead-share-open') return openModal('lead-share', id);
    if (action === 'project-team-open') return openModal('project-team', id);
    if (['create-outreach', 'email', 'follow-up', 'create-proposal'].includes(action)) {
      const check = await API(`/api/leads/${encodeURIComponent(id)}/contact-check`, { method: 'POST', body: '{}' });
      await refresh();
      if (!check.ready) { openModal('lead-form', id); toast(check.message || 'Complete the contact details before drafting.', true); return; }
      if (action === 'create-outreach') return openModal('outreach', id);
      if (action === 'email') return openModal('email', id, { followUp: false });
      if (action === 'follow-up') return openModal('email', id, { followUp: true });
      return openModal('proposal', id, { returnToEmail: state.modal?.type === 'email', returnToFollowUp: Boolean(state.modal?.followUp), returnAttachProposal: Boolean(state.modal?.attachProposal) });
    }
    if (action === 'proposal-draft' || action === 'proposal-rewrite') {
      const fields = getProposalFields();
      if (!fields) return toast('Open a proposal form first.', true);
      if (action === 'proposal-rewrite' && !String(fields.rewriteNotes || '').trim()) return toast('Add a rewrite request first, such as “make it shorter” or “lead with the project impact.”', true);
      if (action === 'proposal-draft') fields.rewriteNotes = '';
      button.disabled = true;
      const priorMarkup = button.innerHTML;
      button.textContent = action === 'proposal-rewrite' ? 'Rewriting…' : 'Drafting…';
      try {
        const result = await API(`/api/leads/${encodeURIComponent(id)}/proposal/draft`, { method: 'POST', body: JSON.stringify(fields) });
        fillProposalDraft(result);
        toast(result.mode === 'openai' ? 'AI draft ready. Review every claim before sharing.' : 'Guided draft preview ready.');
      } finally { button.disabled = false; button.innerHTML = priorMarkup; }
      return;
    }
    if (action === 'open-lead') return openModal('lead-detail', id);
    if (action === 'edit-partner') return openModal('partner', id);
    if (action === 'confirm-booking' || action === 'decline-booking' || action === 'complete-booking') {
      const status = action === 'confirm-booking' ? 'Confirmed' : action === 'decline-booking' ? 'Declined' : 'Completed';
      const result = await API(`/api/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refresh();
      if (status === 'Confirmed' && result.confirmation) toast(result.confirmation.ok ? `Briefing confirmed. ${result.confirmation.message}` : `Briefing confirmed, but the invite failed: ${result.confirmation.error}`, !result.confirmation.ok);
      else toast(`Briefing ${status.toLowerCase()}.`);
      return;
    }
    if (action === 'resend-invite') {
      const result = await API(`/api/bookings/${encodeURIComponent(id)}/send-confirmation`, { method: 'POST', body: '{}' });
      await refresh(); toast(result.message || result.error || 'Invite processed.', !result.ok); return;
    }
    if (action === 'edit-booking') return openModal('booking-edit', id);
    if (action === 'open-project') return openModal('project-detail', id);
    if (action === 'new-project') return openModal('project-form');
    if (action === 'edit-project') return openModal('project-form', id);
    if (action === 'delete-project') {
      if (!confirm('Remove this verified project from the catalog?')) return;
      await API(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.modal = null; await refresh(); toast('Project removed.'); return;
    }
    if (action === 'import-projects') { $('#project-csv-input')?.click(); return; }
    if (action === 'project-import-confirm') {
      const rows = (state.projectImportPreview?.rows || []).filter(r => r.include && !r.error).map(r => r.data);
      if (!rows.length) return toast('Select at least one valid row.', true);
      const result = await API('/api/projects/import', { method: 'POST', body: JSON.stringify({ rows }) });
      state.projectImportPreview = null; state.modal = null; await refresh();
      toast(`${result.created} project(s) added, ${result.updated} updated${result.errors.length ? `, ${result.errors.length} rejected` : ''}.`, Boolean(result.errors.length)); return;
    }
    if (action === 'open-copilot') { state.copilot = { target: button.dataset.target || 'lead-form', text: '', result: null, error: '' }; const returnTo = state.modal; const leadFormDraft = $('#lead-form') ? formDataObject($('#lead-form')) : null; return openModal('copilot', null, { returnTo, leadFormDraft }); }
    if (action === 'send-preview') { await openSendPreview(button.dataset.id, Number(button.dataset.step || 0)); return; }
    if (action === 'send-preview-step') { await openSendPreview(button.dataset.id, Number(button.dataset.step || 0)); return; }
    if (action === 'send-preview-close') { closeSendPreview(); return; }
    if (action === 'google-save') {
      const clientId = $('#google-client-id')?.value.trim() || ''; const clientSecret = $('#google-client-secret')?.value || '';
      if (!clientId && !clientSecret) return toast('Paste the Client ID and Client secret first.', true);
      const body = {}; if (clientId) body.clientId = clientId; if (clientSecret) body.clientSecret = clientSecret;
      try { const r = await API('/api/settings/google', { method: 'PUT', body: JSON.stringify(body) }); state.googleStatus = null; state.myMailboxes = null; if (state.dlv) state.dlv.googleSetupOpen = false; await refresh(); if (state.dlv?.data) await loadDeliverability(true); if (r.configured) toast('Google saved. Press Connect with Google to add your mailbox.'); else toast(`Saved, but not complete yet: ${r.missing}`, true); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (action === 'google-clear') { if (!confirm('Remove the Google client? Mailboxes already connected stop working until it is added again.')) return; try { await API('/api/settings/google', { method: 'PUT', body: JSON.stringify({ clear: true }) }); state.googleStatus = null; await refresh(); toast('Google client removed.'); } catch (err) { toast(err.message, true); } return; }
    if (action === 'google-setup-toggle') { state.dlv.googleSetupOpen = !state.dlv.googleSetupOpen; renderApp(); document.getElementById('settings-google')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (action === 'me-mailbox-sync') { button.disabled = true; try { const r = await API(`/api/me/mailboxes/${encodeURIComponent(button.dataset.id)}/sync-inbox`, { method: 'POST', body: '{}' }); toast(r.ok ? `Checked ${r.checked} new message${r.checked === 1 ? '' : 's'}; ${r.matched} matched a funder.` : r.error, !r.ok); } catch (err) { toast(err.message, true); } loadMyMailboxes(true); return; }
    if (action === 'me-mailbox-remove') { if (!confirm('Remove this mailbox from Chelo? Emails already queued from it will stop. Your Gmail itself is untouched.')) return; try { await API(`/api/me/mailboxes/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); toast('Mailbox removed.'); state.myMailboxes = null; await refresh(); loadMyMailboxes(true); } catch (err) { toast(err.message, true); } return; }
    if (action === 'google-connect') { const mb = button.dataset.mailbox ? `?mailbox=${encodeURIComponent(button.dataset.mailbox)}` : ''; location.href = `/api/oauth/google/start${mb}`; return; }
    if (action === 'rv-make-pdf') { // builds the PDF from the chosen project — same as Send does — then refreshes the preview
      button.disabled = true; button.textContent = 'Making the PDF…';
      try { await API(`/api/leads/${encodeURIComponent(button.dataset.id)}/proposal`, { method: 'POST', body: '{}' }); toast('PDF ready — it is attached to the first email.'); await refresh(); if (state.review) state.review.cache = {}; await openSendPreview(button.dataset.id, Number(state.review?.step || 0)); }
      catch (err) { toast(err.message, true); button.disabled = false; button.textContent = 'Make the PDF now'; }
      return;
    }
    if (action === 'send-preview-edit') { state.modal = null; state.view = 'workbench'; state.wb.selectedId = button.dataset.id; state.wb.openStep = 'draft'; renderApp(); setTimeout(() => $('#email-body')?.focus(), 60); return; }
    if (action === 'prospects-mode') { state.prospectsMode = button.dataset.mode === 'board' ? 'board' : 'table'; renderApp(); return; }
    if (action === 'wb-intake') { state.wb.intake = button.dataset.intake === 'pool' ? 'pool' : 'add'; if (state.wb.intake === 'pool') loadCatalogue(); renderApp(); return; }
    if (action === 'ops-tab') { state.ops.tab = button.dataset.tab; if (!isRoot() && ROOT_ONLY_OPS_TABS.includes(state.ops.tab)) state.ops.tab = 'analytics'; if (state.ops.tab === 'analytics') loadAnalytics(state.analyticsRange); if (state.ops.tab === 'deliverability') loadDeliverability(); if (state.ops.tab === 'data') loadDataQuality(); renderApp(); return; }
    if (action === 'copilot-tab') { state.copilotTab = 'paste'; renderApp(); return; }
    if (action === 'research-run') {
      const lead = getLead(id); if (!lead) return;
      const website = $('#research-website')?.value?.trim() || '';
      state.researchBusy = true; state.researchError = ''; renderApp();
      try {
        const result = await API(`/api/leads/${encodeURIComponent(lead.id)}/research`, { method: 'POST', body: JSON.stringify({ website }) });
        await refresh();
        state.researchBusy = false;
        openModal('research', lead.id, { returnTo: button.dataset.return ? { type: button.dataset.return, id: lead.id } : (state.modal?.type === 'research' ? state.modal.returnTo : state.modal) });
        toast(result.message || 'Funder brief ready for review.');
      } catch (err) { state.researchBusy = false; state.researchError = err.message; renderApp(); toast(err.message, true); }
      return;
    }
    if (action === 'research-open') { const lead = getLead(id); if (!lead) return; return openModal('research', lead.id, { returnTo: state.modal }); }
    if (action === 'research-back') { const returnTo = state.modal?.returnTo; state.modal = returnTo && returnTo.type ? returnTo : null; renderApp(); return; }
    if (action === 'research-approve' || action === 'research-reject') {
      const lead = getLead(id); if (!lead?.research) return;
      const panel = $('#research-review'); if (!panel) return;
      const checked = name => Array.from(panel.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);
      const payload = { approvedFindingIds: checked('finding'), approvedAlignmentIds: checked('alignment'), approvedContactIds: checked('contact'), missionSummary: $('#research-mission')?.value, reviewNotes: $('#research-notes')?.value || '', applySuggestedProject: Boolean($('#research-apply-project')?.checked), reject: action === 'research-reject' };
      if (action === 'research-approve' && !payload.approvedFindingIds.length && !payload.approvedAlignmentIds.length) return toast('Tick at least one fact, or press Not useful.', true);
      button.disabled = true;
      try {
        await API(`/api/leads/${encodeURIComponent(lead.id)}/research/review`, { method: 'POST', body: JSON.stringify(payload) });
        await refresh();
        toast(action === 'research-approve' ? `Saved. ${payload.approvedFindingIds.length + payload.approvedAlignmentIds.length} fact(s) will shape the email and PDF.` : 'Noted — Chelo will not use those facts.');
        const wasModal = Boolean(state.modal); const returnTo = state.modal?.returnTo; state.modal = returnTo && returnTo.type ? returnTo : wasModal ? { type: 'lead-detail', id: lead.id } : null; renderApp();
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'research-clear') {
      const lead = getLead(id); if (!lead?.research) return;
      if (!confirm('Remove this funder brief? Approved findings will no longer inform drafts.')) return;
      await API(`/api/leads/${encodeURIComponent(lead.id)}/research`, { method: 'DELETE' });
      await refresh(); toast('Funder brief removed.');
      const returnTo = state.modal?.returnTo; state.modal = returnTo && returnTo.type ? returnTo : { type: 'lead-detail', id: lead.id }; renderApp();
      return;
    }
    if (action === 'copilot-run') {
      const text = $('#copilot-text')?.value || '';
      state.copilot = { ...(state.copilot || {}), text, error: '', result: null }; state.copilotBusy = true; renderApp();
      try { state.copilot.result = await API('/api/copilot/extract', { method: 'POST', body: JSON.stringify({ text }) }); }
      catch (err) { state.copilot.error = err.message; }
      finally { state.copilotBusy = false; renderApp(); }
      return;
    }
    if (action === 'copilot-apply') {
      const extracted = state.copilot?.result?.extracted; if (!extracted) return;
      const returnTo = state.modal?.returnTo || null;
      const draft = state.modal?.leadFormDraft || null;
      state.modal = returnTo; renderApp();
      const form = $('#lead-form');
      if (form) {
        const setVal = (name, value) => { const el = form.elements[name]; if (el && value !== undefined && value !== null && value !== '') el.value = value; };
        if (draft) for (const [k, v] of Object.entries(draft)) setVal(k, v);
        if (extracted.sector) setVal('sector', extracted.sector);
        if (extracted.partnerPriorities) setVal('partnerPriorities', extracted.partnerPriorities);
        if (extracted.grantWindowOpenMonth) setVal('grantWindowOpenMonth', String(extracted.grantWindowOpenMonth));
        if (extracted.grantWindowCloseMonth) setVal('grantWindowCloseMonth', String(extracted.grantWindowCloseMonth));
        if (extracted.nextGrantDeadline) setVal('nextGrantDeadline', extracted.nextGrantDeadline);
        if (extracted.suggestedProjectId && form.elements.projectId) { form.elements.projectId.value = extracted.suggestedProjectId; form.elements.projectId.dispatchEvent(new Event('change', { bubbles: true })); }
        const notes = form.elements.notes; if (notes && extracted.summaryNotes) notes.value = `${notes.value ? `${notes.value}\n\n` : ''}${extracted.summaryNotes}${extracted.focusAreas?.length ? ` Focus areas: ${extracted.focusAreas.join('; ')}.` : ''}`;
      }
      toast('Extracted fields applied. Review every value before saving.'); return;
    }
    if (action === 'new-staff') return openModal('staff-form');
    if (action === 'edit-staff') return openModal('staff-form', id);
    if (action === 'toggle-coroot') {
      const enable = button.dataset.enable === '1';
      const user = state.data.staff.find(u => u.id === id); if (!user) return;
      if (!confirm(enable ? `Give ${user.displayName} the same access as the root account? They will see Ops, Deliverability, Data quality, Integrations and every staff account, and nobody except themselves can rename, reset or deactivate them.` : `Revoke full access from ${user.displayName}? They stay an administrator with everyday powers.`)) return;
      await API(`/api/staff/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ coRoot: enable }) });
      await refresh(); toast(enable ? 'Full access granted.' : 'Full access revoked.'); return;
    }
    if (action === 'toggle-staff') {
      const user = state.data.staff.find(u => u.id === id); if (!user) return;
      await API(`/api/staff/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ active: !user.active }) });
      await refresh(); toast(user.active ? 'Account deactivated and sessions revoked.' : 'Account reactivated.'); return;
    }
    if (action === 'set-outreach-style') { await API('/api/settings', { method: 'PUT', body: JSON.stringify({ outreachStyle: button.dataset.style }) }); await refresh(); toast(button.dataset.style === 'ladder' ? 'CTA ladder enabled for new drafts and sequences.' : 'Classic first-touch template enabled.'); return; }
    if (action === 'set-guardrail') { await API('/api/settings', { method: 'PUT', body: JSON.stringify({ guardrail: button.dataset.mode }) }); await refresh(); toast(button.dataset.mode === 'block' ? 'Guardrail will block approvals with issues.' : 'Guardrail set to warn only.'); return; }
    if (action === 'set-approval-policy') {
      await API('/api/settings', { method: 'PUT', body: JSON.stringify({ approvalPolicy: button.dataset.policy }) });
      state.auth = await API('/api/auth/status'); await refresh(); toast(button.dataset.policy === 'four-eyes' ? 'From now on two people must approve each email.' : 'From now on one person approves and sends.'); return;
    }
    if (action === 'clear-demo') {
      if (!confirm('Remove all demo prospects, candidates, partners and briefings? Verified Chelo projects are kept.')) return;
      const result = await API('/api/demo/clear', { method: 'POST', body: '{}' });
      await refresh(); toast(`Demo records cleared: ${result.removedLeads} prospects, ${result.removedCandidates} candidates, ${result.removedPartners} partners, ${result.removedBookings} briefings.`); return;
    }
    if (action === 'verify-audit') {
      const result = await API('/api/audit/verify');
      toast(result.valid ? `Audit chain intact: ${result.chainedEntries} chained entries verified.` : `Audit chain BROKEN at ${result.brokenAtId}.`, !result.valid); return;
    }
    if (action === 'rotate-webhook-secret') {
      if (!confirm('Rotate the inbound webhook secret? Update your mail provider afterwards.')) return;
      await API('/api/settings', { method: 'PUT', body: JSON.stringify({ rotateInboundSecret: true }) });
      await refresh(); toast('Webhook secret rotated.'); return;
    }
    if (action === 'imap-sync') {
      const result = await API('/api/inbound/imap-sync', { method: 'POST', body: '{}' });
      await refresh(); toast(`IMAP checked ${result.checked} unread message(s); ${result.matched} matched prospects.`); return;
    }
    if (action === 'mark-replied') {
      if (!confirm('Record that this recipient replied? This will stop all scheduled follow-ups.')) return;
      await API(`/api/leads/${encodeURIComponent(id)}/mark-replied`, { method: 'POST', body: '{}' });
      state.view = 'sent'; await refresh(); toast('Reply recorded. Scheduled follow-ups cancelled.'); return;
    }
    if (action === 'mark-won') {
      await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ stage: 'Won', nextAction: 'Welcome partner and confirm stewardship plan' }) });
      state.modal = null; await refresh(); toast('Won deal added to Partners with its point of contact.'); return;
    }
    if (action === 'opt-out') {
      if (!confirm('Add this prospect to the do-not-contact list and cancel follow-ups?')) return;
      await API(`/api/leads/${encodeURIComponent(id)}/opt-out`, { method: 'POST', body: '{}' });
      await refresh(); toast('Contact suppressed. Follow-ups cancelled.'); return;
    }
    if (action === 'copy-proposal-link') {
      const lead = getLead(id); const url = proposalLink(lead);
      if (!url) return toast('Generate a proposal first.', true);
      await navigator.clipboard.writeText(url); toast('Secure proposal link copied.'); return;
    }
    if (action === 'generate-follow-up') {
      button.disabled = true;
      try {
        const result = await API(`/api/leads/${encodeURIComponent(id)}/follow-up/draft`, { method: 'POST', body: JSON.stringify({ attachProposal: followUpPdfSelected(getLead(id)) }) });
        await refresh();
        toast(result.mode === 'openai' ? 'Performance-informed follow-up draft ready. Review and approve it before sending.' : 'Guided follow-up preview refreshed. No AI provider is configured.');
      } finally { if (button.isConnected) button.disabled = false; }
      return;
    }
    if (action === 'email-save-draft') {
      const fields = getEmailFields();
      if (!fields.subject || !fields.body) return toast('Add a subject and email body first.', true);
      const followUp = button.dataset.followUp === 'true';
      const patch = followUp
        ? { followUpDraft: { ...fields, attachProposal: followUpPdfSelected(getLead(id)), updatedAt: new Date().toISOString() }, followUpEmailStatus: 'Draft' }
        : { emailDraft: { ...fields, updatedAt: new Date().toISOString() }, emailStatus: 'Draft' };
      await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      if (state.modal) delete state.modal.editedDraft;
      await refresh(); toast('Draft saved.'); return;
    }
    if (action === 'email-approve') {
      let fields = getEmailFields();
      // From the preview screen there is no editor on the page: approve the draft exactly as previewed.
      if ((!fields.subject || !fields.body) && state.modal?.type === 'send-preview' && getLead(id)?.emailDraft) fields = { subject: getLead(id).emailDraft.subject || '', body: getLead(id).emailDraft.body || '' };
      if (!fields.subject || !fields.body) return toast('Add a subject and email body first.', true);
      const followUp = button.dataset.followUp === 'true';
      await API(`/api/leads/${encodeURIComponent(id)}/approve-email`, { method: 'POST', body: JSON.stringify({ ...fields, kind: followUp ? 'follow-up' : 'initial', attachProposal: Boolean(followUp && followUpPdfSelected(getLead(id))) }) });
      if (state.modal) delete state.modal.editedDraft;
      await refresh();
      const updated = getLead(id);
      const status = followUp ? updated?.followUpEmailStatus : updated?.emailStatus;
      toast(status === 'Pending second approval' ? 'Approved by you. A second person must approve before it can be sent.' : 'Email approved. Open it in your email client when ready.'); return;
    }
    if (action === 'email-countersign') {
      const followUp = button.dataset.followUp === 'true';
      await API(`/api/leads/${encodeURIComponent(id)}/approve-email`, { method: 'POST', body: JSON.stringify({ kind: followUp ? 'follow-up' : 'initial', confirmSecond: true }) });
      await refresh(); toast('Approved by a second person. The email can be sent now.'); return;
    }
    if (action === 'email-return') {
      const followUp = button.dataset.followUp === 'true';
      const reason = prompt('Optional note for the audit trail (why is this returned to draft?)') || '';
      await API(`/api/leads/${encodeURIComponent(id)}/return-draft`, { method: 'POST', body: JSON.stringify({ kind: followUp ? 'follow-up' : 'initial', reason }) });
      if (state.modal) delete state.modal.editedDraft;
      await refresh(); toast('Returned to draft. Approvals were voided.'); return;
    }
    if (action === 'email-open') {
      const lead = getLead(id); const fields = getEmailFields();
      const followUp = button.dataset.followUp === 'true';
      if (!lead?.email) return toast('Add an email address first.', true);
      if (lead.doNotContact) return toast('This contact is on the do-not-contact list.', true);
      const approved = followUp ? lead.followUpEmailStatus === 'Approved' : lead.emailStatus === 'Approved';
      if (!approved) return toast('Approve the email before handoff.', true);
      const attachProposal = Boolean(followUp && followUpPdfSelected(lead));
      const manualAttachment = 'Please attach the downloaded personalised Chelo proposal PDF before sending.';
      let body = emailBodyForAttachmentMode(fields.body, attachProposal);
      if (attachProposal) {
        body = body.split(/\r?\n/).map(line => /(?:proposal|pdf)[^\r\n]*(?:attach|enclos)|(?:attach|enclos)[^\r\n]*(?:proposal|pdf)/i.test(line) ? manualAttachment : line).join('\n');
        if (!body.includes(manualAttachment)) body = `${body.trim()}\n\n${manualAttachment}`;
      }
      const mailto = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(fields.subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
      toast(attachProposal ? 'Mailto cannot attach files. Attach the prepared PDF manually, or use “Download .eml + PDF attached”.' : 'Text-only mailto draft opened; this introductory email needs no attachment.'); return;
    }
    if (action === 'mark-sent') {
      const followUp = button.dataset.followUp === 'true';
      await API(`/api/leads/${encodeURIComponent(id)}/mark-sent`, { method: 'POST', body: JSON.stringify({ kind: followUp ? 'follow-up' : 'initial' }) });
      state.modal = null; state.view = 'sent'; await refresh(); toast(followUp ? 'Follow-up handoff confirmed. The remaining scheduled follow-up is tracked.' : 'Handoff confirmed. Follow-ups are queued for 5 and 10 business days.'); return;
    }
    if (action === 'mobile-menu') {
      $('.sidebar')?.classList.toggle('mobile-open'); return;
    }
  } catch (err) { toast(err.message || 'That action did not complete. Check your connection and try again.', true); }
}

async function handleSubmit(event) {
  const form = event.target;
  const type = form.dataset.form;
  if (!type) return;
  event.preventDefault();
  if (type === 'wb-add') return wbAddSubmit(form);
  if (type === 'lead-share') return leadShareSubmit(form);
  if (type === 'project-team') return projectTeamSubmit(form);
  if (type === 'dlv-mailbox') return dlvMailboxSubmit(form);
  if (type === 'dlv-mailbox-connect') return dlvMailboxConnect(form);
  if (type === 'dlv-policy') return dlvPolicySubmit(form);
  try {
    if (type === 'auth-mfa') {
      const data = formDataObject(form);
      let result;
      try { result = await API('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ mfaToken: state.mfaChallenge?.mfaToken, code: data.code }) }); }
      catch (err) { if (err.payload?.restart) state.mfaChallenge = null; state.authError = err.message; renderAuthGate(); return; }
      state.mfaChallenge = null; state.auth = result; state.authError = ''; state.view = 'overview';
      await refresh(); toast(result.recoveryUsed ? `Signed in with a recovery code — ${result.recoveryLeft} left.` : 'Signed in.'); return;
    }
    if (type === 'mfa-enable') {
      const data = formDataObject(form);
      const r = await API('/api/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code: data.code }) });
      state.mfa.setup = null; state.mfa.status = r.status; state.mfa.recoveryCodes = r.recoveryCodes; renderApp(); toast('Two-step sign-in is on.'); await refresh(); return;
    }
    if (type === 'mfa-disable') {
      const data = formDataObject(form);
      const r = await API('/api/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password: data.password }) });
      state.mfa.status = r.status; renderApp(); toast('Two-step sign-in is off.'); await refresh(); return;
    }
    if (type === 'auth-setup' || type === 'auth-login') {
      const data = formDataObject(form);
      if (type === 'auth-setup' && data.password !== data.confirmPassword) { state.authError = 'The passwords do not match.'; renderAuthGate(); return; }
      const result = await API(type === 'auth-setup' ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: data.username, password: data.password, displayName: data.displayName }) });
      if (result.mfaRequired) { state.mfaChallenge = { mfaToken: result.mfaToken, username: result.username }; state.authError = ''; renderAuthGate(); return; }
      state.auth = result; state.authError = ''; state.view = 'overview';
      await refresh(); toast(type === 'auth-setup' ? 'Admin account created. Welcome to Chelo.' : 'Signed in.'); return;
    }
    if (type === 'settings') { await saveSettingsForm(form); await refresh(); toast('Saved.'); return; }
    if (type === 'project') {
      const data = formDataObject(form);
      const result = form.dataset.id
        ? await API(`/api/projects/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) })
        : await API('/api/projects', { method: 'POST', body: JSON.stringify(data) });
      state.modal = null; await refresh(); toast(form.dataset.id ? `Project updated: ${result.name}` : `Verified project added: ${result.name}`); return;
    }
    if (type === 'need') {
      const data = formDataObject(form);
      await API(`/api/leads/${encodeURIComponent(form.dataset.id)}/needs`, { method: 'POST', body: JSON.stringify(data) }); toast('Need captured.'); await refresh(); return;
    }
    if (type === 'media-kit') {
      const data = formDataObject(form); data.facts = String(data.facts || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      state.mediaKit = await API('/api/media-kit', { method: 'PUT', body: JSON.stringify(data) }); renderApp(); toast('Media kit saved. Approve it before pitching.'); return;
    }
    if (type === 'staff') {
      const data = formDataObject(form);
      data.desks = [...form.querySelectorAll('input[name="desks"]:checked')].map(i => i.value);
      if (!form.dataset.id && data.password !== data.confirmPassword) throw new Error('The passwords do not match.');
      if (form.dataset.id) { if (!data.password) delete data.password; delete data.confirmPassword; delete data.username; await API(`/api/staff/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) }); }
      else await API('/api/staff', { method: 'POST', body: JSON.stringify({ username: data.username, displayName: data.displayName, role: data.role, password: data.password, desks: data.desks }) });
      state.modal = null; await refresh(); toast(form.dataset.id ? 'Staff account updated.' : 'Staff account created.'); return;
    }
    if (type === 'booking-edit') {
      const data = formDataObject(form);
      const result = await API(`/api/bookings/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ ...data, resendInvite: Boolean(form.elements.resendInvite?.checked) }) });
      state.modal = null; await refresh();
      toast(result.confirmation ? (result.confirmation.ok ? result.confirmation.message : result.confirmation.error) : 'Briefing details updated.', Boolean(result.confirmation && !result.confirmation.ok)); return;
    }
    if (type === 'candidate-review') {
      const data = formDataObject(form);
      const result = await API(`/api/candidates/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(data) });
      state.modal = null; await refresh();
      if (result.deleted) return toast(result.message || 'Candidate contact data was removed.');
      toast(result.message || 'Candidate details updated.', result.candidate?.contactCheck?.status !== 'ready'); return;
    }
    if (type === 'lead') {
      const data = formDataObject(form);
      data.amount = Number(data.amount || 0);
      data.stage = data.stage || 'New';
      const result = form.dataset.id
        ? await API(`/api/leads/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(data) })
        : await API('/api/leads', { method: 'POST', body: JSON.stringify(data) });
      state.modal = null; await refresh();
      if (result.contactCheck?.status && result.contactCheck.status !== 'ready') toast(`Prospect saved, but drafting is blocked: ${(result.contactCheck.issues || []).join(', ') || result.contactCheck.status}.`, true);
      else toast(form.dataset.id ? 'Prospect updated and email domain checked.' : 'Prospect added and email domain checked.');
      return;
    }
    if (type === 'outreach') {
      const data = formDataObject(form); data.amount = Number(data.amount || 0); data.origin = location.origin;
      const result = await API(`/api/leads/${encodeURIComponent(form.dataset.id)}/outreach/generate`, { method: 'POST', body: JSON.stringify(data) });
      const leadId = form.dataset.id;
      state.modal = null; await refresh(); openModal('email', leadId, { followUp: false });
      toast(result.emailMode === 'openai' ? 'Intro email drafted with the configured AI. Review the wording and booking button before approval.' : 'Guided intro-email preview drafted locally; no AI provider is configured. Review it before approval.');
      return;
    }
    if (type === 'proposal') {
      const data = formDataObject(form); data.amount = Number(data.amount || 0);
      const leadId = form.dataset.id; const returnToEmail = Boolean(state.modal?.returnToEmail);
      const returnToFollowUp = Boolean(state.modal?.returnToFollowUp);
      const returnAttachProposal = Boolean(state.modal?.returnAttachProposal);
      const result = await API(`/api/leads/${encodeURIComponent(leadId)}/proposal`, { method: 'POST', body: JSON.stringify(data) });
      state.modal = null; await refresh(); if (returnToEmail) openModal('email', leadId, { followUp: returnToFollowUp, attachProposal: returnAttachProposal });
      toast('Branded proposal PDF generated.');
      return result;
    }
    if (type === 'rel-person' || type === 'rel-touch' || type === 'rel-pledge') {
      const data = formDataObject(form); const relId = form.dataset.id; const sub = { 'rel-person': 'people', 'rel-touch': 'touches', 'rel-pledge': 'pledges' }[type];
      if (type === 'rel-pledge') data.amount = Number(data.amount || 0);
      state.rel.view = await API(`/api/relationships/${encodeURIComponent(relId)}/${sub}`, { method: 'POST', body: JSON.stringify(data) });
      state.rel.summary = null; state.rel.tab = sub === 'people' ? 'people' : sub === 'pledges' ? 'pledges' : 'timeline'; renderApp(); toast(sub === 'people' ? 'Person added.' : sub === 'pledges' ? 'Pledge recorded.' : 'Touch logged.'); loadRelationships(true); return;
    }
    if (type === 'partner') {
      const data = formDataObject(form); data.amount = Number(data.amount || 0);
      await API(`/api/partners/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(data) });
      state.modal = null; await refresh(); toast('Partner profile updated.'); return;
    }
    if (type === 'public-booking') {
      state.bookingError = '';
      const data = formDataObject(form);
      const token = location.pathname.split('/').filter(Boolean).pop();
      await API(`/api/public/booking/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify(data) });
      state.bookingSubmitted = true; renderPublicBooking(); return;
    }
  } catch (err) {
    if (type === 'public-booking') { state.bookingError = err.message; renderPublicBooking(); }
    else if (type === 'auth-setup' || type === 'auth-login') { state.authError = err.message || 'Could not sign in.'; state.auth = await API('/api/auth/status').catch(() => state.auth); renderAuthGate(); }
    else toast(err.message || 'Unable to save changes.', true);
  }
}

function parseCsvDocument(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const records = [], errors = [];
  let row = [], field = '', inQuotes = false, line = 1, recordStartLine = 1, quoteStartLine = 0;
  const pushRecord = () => {
    row.push(field); field = '';
    if (row.some(value => String(value).trim())) records.push({ rowNumber: recordStartLine, values: row });
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else if (c === '\n' || c === '\r') {
        field += '\n';
        if (c === '\r' && source[i + 1] === '\n') i++;
        line++;
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (!field) { inQuotes = true; quoteStartLine = line; }
      else { errors.push({ line, fatal: true, message: 'Unexpected quote inside an unquoted field; correct the CSV quoting before import.' }); field += c; }
    } else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      pushRecord();
      if (c === '\r' && source[i + 1] === '\n') i++;
      line++; recordStartLine = line;
    } else field += c;
  }
  if (inQuotes) errors.push({ line: quoteStartLine || line, fatal: true, message: `Quoted field starting at line ${quoteStartLine || line} is not closed.` });
  if (field || row.length || (source.length && !/[\r\n]$/.test(source))) pushRecord();
  if (records.length < 2) return { headers: [], rows: [], errors: [...errors, { line: 1, fatal: true, message: 'Include a header row and at least one contact row.' }], totalRows: 0 };
  const rawHeaders = records[0].values;
  const headers = rawHeaders.map((header, index) => String(header || '').trim() || `Column ${index + 1}`);
  const dataRows = records.slice(1).map(record => ({ rowNumber: record.rowNumber, values: record.values, headerCount: headers.length }));
  return { headers, rows: dataRows, errors, totalRows: dataRows.length };
}
async function handleCandidateCsv(file) {
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('CSV file exceeds 5 MB. Split it into smaller review batches.');
    const parsed = parseCsvDocument(await file.text());
    if (!parsed.headers.length || !parsed.rows.length) throw new Error(parsed.errors[0]?.message || 'No contact rows found. Check the CSV headers and data.');
    const maxRows = 500;
    state.csvImportPreview = {
      filename: file.name || 'contacts.csv', headers: parsed.headers, rows: parsed.rows.slice(0, maxRows).map(row => ({ ...row })),
      mapping: autoMapCsvHeaders(parsed.headers), parserErrors: parsed.errors, totalRows: parsed.totalRows, omittedRows: Math.max(0, parsed.totalRows - maxRows)
    };
    state.view = 'discover'; state.modal = { type: 'csv-preview' }; renderApp();
  } catch (err) { toast(err.message || 'Could not read candidate CSV.', true); }
  finally { const input = $('#candidate-csv'); if (input) input.value = ''; }
}
async function importCandidateCsvPreview() {
  const preview = state.csvImportPreview;
  if (!preview) return;
  const rows = getCsvPreviewRows(preview);
  const selected = rows.filter(row => row.selected);
  if (preview.parserErrors.some(error => error.fatal)) return toast('Fix the CSV parse error before importing.', true);
  if (!selected.length) return toast('Select at least one clean CSV row to import.', true);
  const button = $('[data-action="csv-import-confirm"]');
  if (button) { button.disabled = true; button.textContent = 'Checking selected rows…'; }
  try {
    const result = await API('/api/import', { method: 'POST', body: JSON.stringify({ source: 'csv', candidates: selected.map(row => row.candidate) }) });
    state.csvImportPreview = null; state.importReport = result; state.modal = null;
    await refresh(); openModal('import-report');
  } catch (err) {
    toast(err.message || 'Could not import candidate CSV.', true);
    if (button) { button.disabled = false; button.textContent = 'Import selected to Discover'; }
  }
}

function renderPublicBooking() {
  const root = $('#app');
  if (!state.bookingInfo) {
    root.innerHTML = `<main class="booking-screen"><div class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${BRAND_MARK}</span>Chelo</div><div class="eyebrow">Partnership briefing</div><h1>Choose a preferred time</h1><p>Loading your invitation…</p></div><div class="loading-line"><span></span></div></div></main>`;
    return;
  }
  const info = state.bookingInfo;
  const meetingDuration = Number(info.meetingDurationMinutes || INTRO_MEETING_MINUTES);
  const dateOptions = [];
  const today = new Date();
  for (let i = 2; i <= 18 && dateOptions.length < 12; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    dateOptions.push(d);
  }
  const bookingBody = state.bookingSubmitted ? `<div class="booking-success"><div class="success-check">${svgIcon('check')}</div><h2>Thank you — request received</h2><p>The Chelo team will review your preferred time and confirm your ${meetingDuration}-minute introductory video briefing directly. You can close this page.</p></div>` : `<div class="booking-card-body"><div class="booking-project"><small>${meetingDuration}-minute introductory video chat</small><strong>${esc(info.company)} · ${esc(info.project)}</strong></div><p class="page-subtitle" style="margin:0 0 17px">Your contact details are prefilled. Choose a preferred time; Chelo will confirm it. No preparation or commitment is required.</p><form id="booking-form" data-form="public-booking"><div class="form-grid">
    <div class="form-group"><label for="b-name">Your name *</label><input class="form-control" id="b-name" name="name" required autocomplete="name" value="${esc(info.contactName || '')}" /></div>
    <div class="form-group"><label for="b-org">Organisation *</label><input class="form-control" id="b-org" name="organization" required value="${esc(info.organization || info.company.replace(/\s·\sDemo$/, ''))}" autocomplete="organization" /></div>
    <div class="form-group"><label for="b-email">Work email *</label><input class="form-control" id="b-email" name="email" type="email" required autocomplete="email" value="${esc(info.email || '')}" /></div>
    <div class="form-group"><label for="b-phone">Phone number <span class="optional">(optional)</span></label><input class="form-control" id="b-phone" name="phone" autocomplete="tel" placeholder="+27 …" value="${esc(info.phone || '')}" /></div>
    <div class="form-group"><label for="b-date">Preferred date *</label><select class="form-control" id="b-date" name="date" required>${dateOptions.map((d, i) => `<option value="${localDateValue(d)}" ${i === 0 ? 'selected' : ''}>${d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}</option>`).join('')}</select></div>
    <div class="form-group full"><label for="b-platform">Preferred video platform</label><select class="form-control" id="b-platform" name="videoPlatform">${(info.videoPlatforms || []).map(p => `<option value="${esc(p.id)}" ${p.id === info.defaultPlatform ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select><span class="form-hint">Times are South Africa Standard Time (UTC+02:00). You will receive a calendar invite with the join link once confirmed.</span></div>
    <div class="form-group"><label for="b-time">Preferred time (SAST) *</label><select class="form-control" id="b-time" name="time" required>${['09:00', '10:30', '13:00', '14:30', '15:30'].map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
    <div class="form-group full"><label for="b-note">Anything you'd like us to prepare? <span class="optional">(optional)</span></label><textarea class="form-control" id="b-note" name="note" placeholder="Share your focus areas or questions."></textarea></div>
  </div>${state.bookingError ? `<div class="form-error" style="margin-top:11px">${esc(state.bookingError)}</div>` : ''}<div style="display:flex;justify-content:flex-end;margin-top:17px"><button type="submit" class="button button-primary">Request ${meetingDuration}-minute introduction ${svgIcon('arrow')}</button></div></form></div>`;
  root.innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${BRAND_MARK}</span>Chelo</div><div class="eyebrow">A conversation about impact</div><h1>A ${meetingDuration}-minute introduction to Chelo.</h1><p>Choose a preferred time for a brief, no-commitment conversation.</p></div>${bookingBody}<div class="booking-foot">Chelo · Security. Transparency. Accountability. · South Africa<br>Your selected slot is a preference; the team will confirm it personally.</div></article></main>`;
}
async function initPublicBooking() {
  state.bookingLoading = true; renderPublicBooking();
  const token = location.pathname.split('/').filter(Boolean).pop();
  try { state.bookingInfo = await API(`/api/public/booking/${encodeURIComponent(token)}`); }
  catch (err) { state.bookingInfo = { error: err.message }; }
  state.bookingLoading = false;
  if (state.bookingInfo?.error) {
    $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${BRAND_MARK}</span>Chelo</div><div class="eyebrow">Partnership briefing</div><h1>Invitation unavailable</h1><p>This link may have expired or the contact has been suppressed.</p></div><div class="booking-card-body"><p class="page-subtitle">Please reply to your Chelo contact for assistance.</p></div></article></main>`;
  } else renderPublicBooking();
}
// Hosted partnership page (/p/:token): funder-as-hero picture, three numbers, what you receive, two slots + booking.
function renderPublicPage() {
  const root = $('#app'); const m = state.pageInfo;
  const brand = `<div class="pp-brand"><img src="/brand/chelo-mark.svg" alt="" width="28" height="28" /><span>Chelo</span></div>`;
  if (!m) { root.innerHTML = `<main class="pp"><section class="pp-card">${brand}<p class="page-subtitle">Loading…</p></section></main>`; return; }
  if (m.error) { root.innerHTML = `<main class="pp"><section class="pp-card">${brand}<h1>This page is not available</h1><p class="page-subtitle">${esc(m.error)}</p></section></main>`; return; }
  if (m.expired) { root.innerHTML = `<main class="pp"><section class="pp-card"><div class="pp-hero pp-hero-${esc(m.template)}" style="background-image:url('${esc(m.image)}')"><div class="pp-hero-text">${brand}<h1>${esc(m.fallback.title)}</h1></div></div><div class="pp-body"><p class="pp-lead">${esc(m.fallback.text)}</p><a class="button button-primary" href="${esc(m.fallback.href)}" rel="noopener">${svgIcon('external')} Browse live verified projects</a></div></section></main>`; return; }
  const done = state.pageBooked;
  const slots = (m.slots || []).map(sl => `<button type="button" class="pp-slot" data-action="pp-book" data-date="${esc(sl.date)}" data-time="${esc(sl.time)}">${svgIcon('calendar')}<strong>${esc(sl.label)}</strong><span>${m.meetingDurationMinutes || 15} min · video</span></button>`).join('');
  root.innerHTML = `<main class="pp"><section class="pp-card">
    <div class="pp-hero pp-hero-${esc(m.template)}" style="background-image:url('${esc(m.image)}')"><div class="pp-hero-text">${brand}<span class="pp-kicker">${esc(m.company)} × Chelo</span><h1>${esc(m.project?.name || m.project?.recipient || 'A verified school')}</h1>${m.project && (m.project.recipient || m.project.province) ? `<p class="pp-place">${esc([m.project.recipient, m.project.province].filter(Boolean).join(' · '))}</p>` : ''}</div></div>
    <div class="pp-body">
      <p class="pp-lead">${esc(m.picture)}</p>
      <div class="pp-numbers">${m.numbers.map(n => `<div class="pp-num"><strong>${esc(n.value)}</strong><span>${esc(n.label)}</span></div>`).join('')}</div>
      ${m.project ? `<div class="pp-project"><span class="pp-badge">${svgIcon('shield')} ${esc(m.project.status || 'Verified')}${m.project.verifiedAt ? ` · ${esc(String(m.project.verifiedAt).slice(0, 10))}` : ''}</span><h2>${esc(m.project.name)}</h2><p>${esc(m.project.summary || '')}</p></div>` : ''}
      <div class="pp-receive"><h3>What ${esc(m.company)} receives</h3><ul>${m.receive.map(r => `<li>${svgIcon('check')}${esc(r)}</li>`).join('')}</ul></div>
      ${done ? `<div class="booking-success"><div class="success-check">${svgIcon('check')}</div><h2>Request received</h2><p>The Chelo team will confirm your slot by email with a calendar invite.</p></div>` : `<div class="pp-cta"><h3>Pick a 15-minute slot</h3><div class="pp-slots">${slots}</div>${state.pageError ? `<div class="form-error">${esc(state.pageError)}</div>` : ''}<a class="pp-alt" href="${esc(m.bookingPath)}">Prefer another time? Choose your own →</a></div>`}
      ${(m.trustedBy || []).length ? `<div class="pp-trust"><span>Trusted by</span>${m.trustedBy.map(t => `<strong>${esc(t)}</strong>`).join("")}</div>` : ""}<footer class="pp-foot"><span>Every rand traceable · cheloapp.com</span><a href="${esc(m.optOutPath)}">Stop further outreach</a></footer>
    </div></section></main>`;
}
async function initPublicPage() {
  renderPublicPage();
  const token = location.pathname.split('/').filter(Boolean).pop();
  try { state.pageInfo = await API(`/api/public/page/${encodeURIComponent(token)}`); } catch (err) { state.pageInfo = { error: err.message }; }
  renderPublicPage();
}
async function bookFromPage(date, time) {
  const m = state.pageInfo; const token = location.pathname.split('/').filter(Boolean).pop();
  const name = m.contactName || prompt('Your name'); const email = m.email || prompt('Your work email');
  if (!name || !email) return;
  try { await API(`/api/public/booking/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify({ name, email, organization: m.company, date, time, note: 'Booked from partnership page' }) }); state.pageBooked = true; state.pageError = ''; }
  catch (err) { state.pageError = err.message; }
  renderPublicPage();
}
function renderPublicOptOut() {
  const info = state.optOutInfo;
  if (!info) {
    $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${BRAND_MARK}</span>Chelo</div><div class="eyebrow">Email preferences</div><h1>Loading your request…</h1><p>One moment.</p></div></article></main>`;
    return;
  }
  const unavailable = Boolean(info.error);
  const completed = state.optOutDone || info.optedOut;
  const content = unavailable
    ? `<div class="booking-card-body"><h2 style="font-size:14px;color:#2a2560">This link is unavailable</h2><p class="page-subtitle">Please contact the Chelo team if you need help with your email preferences.</p></div>`
    : completed
      ? `<div class="booking-success"><div class="success-check">${svgIcon('check')}</div><h2>Preference saved</h2><p>Chelo will not send further outreach or follow-up emails to this contact. You may close this page.</p></div>`
      : `<div class="booking-card-body"><div class="booking-project"><small>Organisation</small><strong>${esc(info.company)}</strong></div><p class="page-subtitle" style="margin:0 0 16px">If you no longer wish to receive Chelo outreach about this partnership, confirm below. This will stop future follow-ups for this contact.</p><button type="button" class="button button-primary" data-action="public-opt-out">${svgIcon('ban')}Stop further outreach</button></div>`;
  $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${BRAND_MARK}</span>Chelo</div><div class="eyebrow">Email preferences</div><h1>${completed ? 'You’re opted out.' : 'Manage your email preferences.'}</h1><p>We respect your choice.</p></div>${content}<div class="booking-foot">Chelo · Security. Transparency. Accountability. · South Africa</div></article></main>`;
}
async function initPublicOptOut() {
  renderPublicOptOut();
  const token = location.pathname.split('/').filter(Boolean).pop();
  try { state.optOutInfo = await API(`/api/public/opt-out/${encodeURIComponent(token)}`); }
  catch (err) { state.optOutInfo = { error: err.message }; }
  renderPublicOptOut();
}

// Delegated UI events keep the workspace lightweight and dependency-free.
document.addEventListener('click', async event => {
  const settingsTab = event.target.closest('[data-settings-tab]');
  if (settingsTab) { event.preventDefault(); state.settingsSection = settingsTab.dataset.settingsTab; if (state.settingsSection === 'mailbox') loadMyMailboxes(true); if (state.settingsSection === 'media-kit') loadMediaKit(true); renderApp(); if (state.settingsSection === 'audit') loadAudit(); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { event.preventDefault(); if (typeof window.isPhone === 'function' && window.isPhone() && state.auth?.authenticated) { state.m.tab = ({ briefings: 'inbox', partners: 'more', prospects: 'leads', pipeline: 'leads', workbench: 'approvals' })[viewButton.dataset.view] || 'inbox'; state.m.leadId = null; if (state.m.tab === 'more') state.m.section = 'relationships'; renderApp(); return; } setView(viewButton.dataset.view); return; }
  const ppBook = event.target.closest('[data-action="pp-book"]');
  if (ppBook) { event.preventDefault(); await bookFromPage(ppBook.dataset.date, ppBook.dataset.time); return; }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) { event.preventDefault(); await dispatchAction(actionButton); return; }
  const leadRow = event.target.closest('[data-open-lead]');
  if (leadRow && typeof window.isPhone === 'function' && window.isPhone() && state.m) { event.preventDefault(); state.m.leadId = leadRow.dataset.openLead; renderApp(); return; }
  if (leadRow) { openModal('lead-detail', leadRow.dataset.openLead); return; }
  if (event.target.id === 'modal-backdrop') closeModal();
  if (event.target.id === 'ix-members-backdrop' && state.ix) { state.ix.members = null; renderApp(); }
  if (event.target.id === 'mobile-more-backdrop') { state.mobileMoreOpen = false; renderApp(); }
});
document.addEventListener('submit', handleSubmit);
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.id === 'email-attach-proposal') {
    if (state.modal?.type === 'email') {
      state.modal.attachProposal = target.checked;
      state.modal.editedDraft = getEmailFields();
      renderApp();
    }
    return;
  }
  if (target.matches('[data-csv-map]')) {
    if (state.csvImportPreview) { state.csvImportPreview.mapping[target.dataset.csvMap] = Number(target.value); renderApp(); }
    return;
  }
  if (target.matches('[data-csv-row]')) {
    const row = state.csvImportPreview?.rows.find(item => item.rowNumber === Number(target.dataset.csvRow));
    if (row) { row.include = target.checked; renderApp(); }
    return;
  }
  if (target.id === 'candidate-csv') { await handleCandidateCsv(target.files?.[0]); return; }
  if (target.id === 'analytics-range') { state.analyticsRange = Number(target.value); await loadAnalytics(state.analyticsRange); return; }
  if (target.id === 'stage-filter') { state.stageFilter = target.value; renderApp(); return; }
  if (target.id === 'candidate-filter') { state.candidateFilter = target.value; renderApp(); return; }
  if (target.matches('[data-lead-stage]')) {
    const id = target.dataset.leadStage;
    try {
      await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ stage: target.value }) });
      await refresh(); toast(target.value === 'Won' ? 'Won deal added to Partners.' : `Moved to ${target.value}.`);
    } catch (err) { toast(err.message, true); }
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'projectId') { const free = target.closest('form')?.querySelector('.project-freeform'); if (free) free.classList.toggle('is-hidden', Boolean(target.value)); return; }
  if (target.id === 'project-csv-input' && target.files?.[0]) { handleProjectCsv(target.files[0]); target.value = ''; return; }
  if (target.id === 'project-province-filter') { state.projectFilter = target.value; renderApp(); return; }
  if (target.dataset.projectRow !== undefined && state.projectImportPreview) { const row = state.projectImportPreview.rows.find(r => String(r.rowNumber) === target.dataset.projectRow); if (row) row.include = target.checked; return; }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'email-subject' || target.id === 'email-body') {
    if (state.modal?.type === 'email') state.modal.editedDraft = getEmailFields();
    updateEmailReadiness(); return;
  }
  if (target.id === 'audit-search') {
    state.auditQuery = target.value; const caret = target.selectionStart; renderApp(); const next = $('#audit-search'); if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch {} }
    clearTimeout(auditSearchTimer); auditSearchTimer = setTimeout(() => loadAudit(), 250); return;
  }
  if (['global-search', 'lead-search', 'candidate-search', 'project-search'].includes(target.id)) {
    state.query = target.value;
    if (target.id === 'global-search' && target.value.trim() && !['workbench', 'prospects', 'discover', 'partners', 'projects', 'pipeline', 'sent'].includes(state.view)) state.view = 'prospects';
    const caret = target.selectionStart;
    renderApp();
    const next = document.getElementById(target.id);
    if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch {} }
  }
});
document.addEventListener('dragstart', event => {
  const card = event.target.closest('[data-drag-lead]');
  if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.dragLead);
  event.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', event => {
  const column = event.target.closest('[data-drop-stage]');
  if (!column) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  column.classList.add('drop-active');
});
document.addEventListener('dragleave', event => {
  const column = event.target.closest('[data-drop-stage]');
  if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop-active');
});
document.addEventListener('drop', async event => {
  const column = event.target.closest('[data-drop-stage]');
  if (!column) return;
  event.preventDefault(); column.classList.remove('drop-active');
  const leadId = event.dataTransfer.getData('text/plain');
  const stage = column.dataset.dropStage;
  if (!leadId || !stage) return;
  try {
    await API(`/api/leads/${encodeURIComponent(leadId)}`, { method: 'PATCH', body: JSON.stringify({ stage }) });
    await refresh(); toast(stage === 'Won' ? 'Won deal added to Partners.' : `Moved to ${stage}.`);
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || state.palette) return;
  if (state.mobileMoreOpen) { state.mobileMoreOpen = false; renderApp(); return; }
  if (state.modal) closeModal();
});

async function init() {
  if (!document.getElementById('app')) return; // design/gallery pages load app.js only for the icon definitions
  if (location.pathname.startsWith('/book/')) return initPublicBooking();
  if (location.pathname.startsWith('/p/')) return initPublicPage();
  if (location.pathname.startsWith('/opt-out/')) return initPublicOptOut();
  try {
    state.auth = await API('/api/auth/status');
    const q = new URLSearchParams(location.search);
    if (q.get('login') === 'error') { history.replaceState(null, '', location.pathname); state.authError = q.get('message') || 'Google sign-in failed.'; }
    if (!state.auth.authenticated) { renderAuthGate(); return; }
    state.data = await API('/api/init');
    if (q.get('login') === 'welcome' || q.get('login') === 'ok') {
      history.replaceState(null, '', location.pathname); state.myMailboxes = null;
      const mb = q.get('mailbox'), email = q.get('email') || 'your mailbox';
      if (mb === 'missing') { state.settingsSection = 'mailbox'; state.view = 'settings'; setTimeout(() => toast('Signed in, but Google did not connect your mailbox. Press Connect with Google here.', true), 600); }
      else if (q.get('login') === 'welcome') { state.settingsSection = 'mailbox'; state.view = 'settings'; setTimeout(() => toast(`Welcome to Chelo. ${email} is connected — emails you approve go out from it.`), 600); }
      else if (mb === 'connected') setTimeout(() => toast(`${email} connected. Emails you approve go out from it.`), 600);
    }
    if (q.get('google')) { history.replaceState(null, '', location.pathname); if (q.get('google') === 'connected') { toast(`${q.get('email')} connected with Google. Emails you approve now go out from it.`); state.myMailboxes = null; state.settingsSection = 'mailbox'; setView('settings'); } else toast(q.get('message') || 'Google connection failed.', true); }
    renderApp(); loadRadar(); if (state.view === 'workbench') wbRunPending();
  } catch (err) { $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${BRAND_MARK}</span>Chelo</div><div class="eyebrow">Workspace unavailable</div><h1>Could not load the partnerships workspace.</h1><p>${esc(err.message)}</p></div><div class="booking-card-body">Refresh the page in a moment. Check that the local app server is running.</div></article></main>`; }
}
init();


// ---------- Verified Projects Catalog, Governance, Briefings, Copilot & Radar ----------
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function roleLabel(role) { return ({ admin: 'Admin', reviewer: 'Reviewer', owner: 'Relationship Owner' })[role] || 'Admin'; }
function platformLabel(id) { return (state.data.videoPlatforms || []).find(p => p.id === id)?.label || ({ google_meet: 'Google Meet', microsoft_teams: 'Microsoft Teams', zoom: 'Zoom' })[id] || 'Google Meet'; }
function monthOptions(selected) { return `<option value="0" ${!Number(selected) ? 'selected' : ''}>Not recorded</option>${MONTHS.slice(1).map((m, i) => `<option value="${i + 1}" ${Number(selected) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}`; }
function projectOptions(selectedId) {
  return `<option value="" ${!selectedId ? 'selected' : ''}>Other / not linked yet</option>${(state.data.projects || []).map(p => `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)} · ${esc(p.province)} · gap ${shortMoney(p.funding?.fundingGap || 0)}</option>`).join('')}`;
}
function grantCycleLabel(record) {
  if (record.nextGrantDeadline) return `Deadline ${dateOnly(record.nextGrantDeadline)}`;
  const o = Number(record.grantWindowOpenMonth || 0), c = Number(record.grantWindowCloseMonth || 0);
  if (o && c && o !== c) return `${MONTHS[o].slice(0, 3)}–${MONTHS[c].slice(0, 3)} window`;
  if (o) return `${MONTHS[o]} cycle`;
  return 'Not recorded';
}
function fundingBar(funding, target) {
  const pct = Math.max(0, Math.min(100, Number(funding?.coveragePct || 0)));
  return `<div class="funding-bar" title="${pct}% of target committed"><span style="width:${pct}%"></span></div><div class="funding-legend"><span>Committed ${shortMoney(funding?.committedTotal || 0)}</span><span>Gap ${shortMoney(funding?.fundingGap || 0)}</span><span>Target ${shortMoney(target || 0)}</span></div>`;
}
function projectsView() {
  const q = state.query.trim().toLowerCase();
  const provinces = ['All provinces', ...new Set((state.data.projects || []).map(p => p.province).filter(Boolean))];
  const projects = (state.data.projects || []).filter(p => (state.projectFilter === 'All provinces' || p.province === state.projectFilter) && (!q || [p.name, p.recipientName, p.sector, p.province, p.summary].join(' ').toLowerCase().includes(q)));
  const totalTarget = projects.reduce((s, p) => s + Number(p.targetAmount || 0), 0);
  const totalGap = projects.reduce((s, p) => s + Number(p.funding?.fundingGap || 0), 0);
  const totalPipeline = projects.reduce((s, p) => s + Number(p.funding?.pipelineAmount || 0), 0);
  const canEdit = state.auth.role !== 'reviewer';
  const cards = projects.map(p => `<article class="project-card"><div class="project-card-head"><div><span class="project-sector">${esc(p.sector || 'Education')}</span><h3>${esc(p.name)}</h3><p class="project-recipient">${svgIcon('building')} ${esc(p.recipientName)}${p.recipientType ? ` · ${esc(p.recipientType)}` : ''}</p></div><span class="stage-pill pill-interested">${esc(p.province || 'National')}</span></div><p class="project-summary">${esc(p.summary || '')}</p>${fundingBar(p.funding, p.targetAmount)}<div class="project-meta"><span>${svgIcon('clock')}${esc(p.grantCycleWindow || 'Rolling')}</span><span>${svgIcon('check')}Verified ${esc(dateOnly(p.verifiedAt) || '—')}</span><span>${svgIcon('prospects')}${p.linkedProspects} prospect${p.linkedProspects === 1 ? '' : 's'} · ${shortMoney(p.funding?.pipelineAmount || 0)} in pipeline</span></div><div class="project-metrics">${(p.verifiedMetrics || []).map(m => `<div class="project-metric"><strong>${esc(m.label)}</strong><span>${esc(String(m.baselineValue))} → <b>${esc(String(m.currentValue))}</b> ${esc(m.unit)}</span><small>${esc(m.period)} · ${esc(m.source)}</small></div>`).join('') || '<small class="subtle">No verified metrics yet.</small>'}</div><div class="project-actions"><button class="button button-secondary button-small" data-action="open-project" data-id="${esc(p.id)}">${svgIcon('grid')}Details</button>${canEdit ? `<button class="button button-ghost button-small" data-action="edit-project" data-id="${esc(p.id)}">${svgIcon('edit')} Edit</button>` : ''}</div></article>`).join('');
  return `${pageHead('Projects', 'Projects', 'What we are raising money for. Each one is verified by Chelo.', canEdit ? `<input type="file" id="project-csv-input" accept=".csv,text/csv" hidden /><a class="button button-ghost" href="/sample-projects.csv" download>${svgIcon('download')}CSV template</a><button class="button button-secondary" data-action="import-projects">${svgIcon('upload')} Import CSV</button><button class="button button-primary" data-action="new-project">${svgIcon('plus')} Add project</button>` : '')}
    <div class="metric-grid">${metricCard('Catalog target', shortMoney(totalTarget), `${projects.length} verified project${projects.length === 1 ? '' : 's'}`, 'target')}${metricCard('Open funding gap', shortMoney(totalGap), 'after committed + won', 'trend', totalGap ? 'Seeking partners' : 'Fully funded', Boolean(totalGap))}${metricCard('Pipeline coverage', shortMoney(totalPipeline), 'active prospects linked', 'send', totalGap ? `${Math.min(999, Math.round((totalPipeline / Math.max(1, totalGap)) * 100))}% of gap` : '', false)}${metricCard('Provinces', String(new Set(projects.map(p => p.province)).size), 'with verified recipients', 'calendar')}</div>
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="project-search" type="search" placeholder="Search project, recipient, sector…" value="${esc(state.query)}" /></label><select class="select-control" id="project-province-filter">${provinces.map(p => `<option ${state.projectFilter === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div><div class="control-right"><span class="subtle">${projects.length} shown</span></div></div>
    <div class="project-grid">${cards || `<div class="empty-state"><div class="empty-state-icon">${svgIcon('grid')}</div><strong>No projects match</strong><p>Add a verified project or import the CSV template.</p></div>`}</div>`;
}
function projectFormModal(project) {
  const edit = Boolean(project);
  const provinces = state.data.provinces || [];
  const body = `<form id="project-form" data-form="project" data-id="${edit ? esc(project.id) : ''}"><div class="form-grid">
    <div class="form-group full"><label for="p-name">Project name *</label><input class="form-control" id="p-name" name="name" required value="${esc(project?.name || '')}" /></div>
    <div class="form-group"><label for="p-recipient">Verified recipient *</label><input class="form-control" id="p-recipient" name="recipientName" required value="${esc(project?.recipientName || '')}" placeholder="School, NGO or community organisation" /></div>
    <div class="form-group"><label for="p-rtype">Recipient type</label><input class="form-control" id="p-rtype" name="recipientType" value="${esc(project?.recipientType || '')}" placeholder="e.g. Section 18A NPO" /></div>
    <div class="form-group"><label for="p-province">Province</label><select class="form-control" id="p-province" name="province">${provinces.map(p => `<option ${p === (project?.province || 'Gauteng') ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
    <div class="form-group"><label for="p-sector">Sector</label><input class="form-control" id="p-sector" name="sector" value="${esc(project?.sector || '')}" placeholder="e.g. Foundation Phase Literacy" /></div>
    <div class="form-group"><label for="p-target">Target budget (ZAR) *</label><input class="form-control" id="p-target" name="targetAmount" type="number" min="0" step="1000" required value="${Number(project?.targetAmount || 0) || ''}" /></div>
    <div class="form-group"><label for="p-committed">Already committed (ZAR)</label><input class="form-control" id="p-committed" name="committedAmount" type="number" min="0" step="1000" value="${Number(project?.committedAmount || 0) || ''}" /><span class="form-hint">Won pipeline deals are added automatically.</span></div>
    <div class="form-group"><label for="p-status">Status</label><input class="form-control" id="p-status" name="status" value="${esc(project?.status || 'Verified · Seeking Partners')}" /></div>
    <div class="form-group"><label for="p-verified">Verified on</label><input class="form-control" id="p-verified" name="verifiedAt" type="date" value="${esc(verificationDateValue(project?.verifiedAt))}" /></div>
    <div class="form-group full"><label for="p-cycle">Grant / delivery window</label><input class="form-control" id="p-cycle" name="grantCycleWindow" value="${esc(project?.grantCycleWindow || '')}" placeholder="e.g. Q1–Q3 delivery · Section 18A verified" /></div>
    <div class="form-group full"><label for="p-source">Verification source URL</label><input class="form-control" id="p-source" name="sourceUrl" type="url" value="${esc(project?.sourceUrl || '')}" placeholder="https://…" /></div>
    <div class="form-group full"><label for="p-summary">Summary</label><textarea class="form-control" id="p-summary" name="summary" maxlength="1200">${esc(project?.summary || '')}</textarea></div>
    <div class="form-group full"><label for="p-picture">End-state picture <span class="optional">(one sentence funders will read; use {{company}} for the funder)</span></label><textarea class="form-control" id="p-picture" name="picture" maxlength="300" placeholder="Picture the first day of term: 24 freshly painted classrooms at Philemon Montsho Primary — and a co-branded photo of {{company}} on the wall that made it happen.">${esc(project?.picture || '')}</textarea></div>
    <div class="form-group full"><label for="p-metrics">Verified metrics (max 3, one per line)</label><textarea class="form-control" id="p-metrics" name="verifiedMetrics" placeholder="Metric | baseline | latest | unit | period | verified source">${esc(verifiedMetricsText(project?.verifiedMetrics || []))}</textarea><span class="form-hint">Format: Metric | baseline value | latest value | unit | period | verified source.</span></div>
  </div></form>`;
  const footer = `<div class="modal-footer-left">${edit ? `<button type="button" class="button button-ghost button-small" data-action="delete-project" data-id="${esc(project.id)}">${svgIcon('trash')}Remove</button>` : '<span class="subtle">Adds a verified project to the catalog</span>'}</div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="project-form" class="button button-primary">${svgIcon('save')}${edit ? 'Save project' : 'Add project'}</button></div>`;
  return modalFrame(edit ? 'Edit verified project' : 'Add verified project', 'Catalog entries must name a verified recipient and a cited source.', body, footer);
}
/** R4: the supplier side of a Verified Project — ask for quotes, shortlist, sign (optional Chelo fee %), school confirms done. */
function tenderHistoryNote(p) {
  const h = p.tenderHistory || []; if (!h.length) return '';
  return `<details class="subtle" style="margin:6px 0"><summary>${h.length} earlier round${h.length === 1 ? '' : 's'}</summary><ul class="wb-need-list">${h.map(r => `<li>${esc(TRADE_LABELS[r.trade] || r.trade)}${r.province ? ` · ${esc(r.province)}` : ''} · ${isoDate(r.openedAt)} · sent to ${(r.sentTo || []).length}, ${(r.quotes || []).length} quote${(r.quotes || []).length === 1 ? '' : 's'} · ${esc(r.status)}${r.awardedQuoteId ? ` (${esc((r.quotes || []).find(q => q.id === r.awardedQuoteId)?.company || '')})` : ''}</li>`).join('')}</ul></details>`;
}
/** v68: the picture that goes on this project's hosted page, PDF cover and backgrounder. Auto by theme and rotated per funder unless pinned. */
function projectPhotoSection(p) {
  const g = state.photos;
  if (!g.themes && !g.loading) { g.loading = true; API('/api/photos').then(r => { g.themes = r.themes; g.loading = false; renderApp(); }).catch(() => { g.loading = false; }); }
  const pick = p.photoPick || {}; const theme = g.theme[p.id] || pick.theme || 'other';
  const themes = g.themes || []; const current = themes.find(t => t.id === theme) || { photos: [] };
  const id = esc(p.id);
  return `<div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('eye')}Picture</span></div>
    <p class="subtle">${pick.pinned ? `<strong>Pinned:</strong> every funder sees this photo.` : `<strong>Automatic:</strong> theme “${esc((themes.find(t => t.id === pick.theme) || {}).label || pick.theme || '')}”, rotated so each funder gets a different one of its ${pick.choices || 0} photo${pick.choices === 1 ? '' : 's'}.`} Used on the hosted page, the PDF cover and the press backgrounder.</p>
    <div class="photo-pick"><img class="photo-current" src="${esc(pick.image || '')}" alt="" />
      <div><label class="form-group"><span>Browse a theme</span><select class="form-control" data-photo-theme="${id}">${themes.map(t => `<option value="${t.id}" ${t.id === theme ? 'selected' : ''}>${esc(t.label)} (${t.photos.length})</option>`).join('')}</select></label>
      <div class="photo-grid">${current.photos.map(ph => `<button type="button" class="photo-tile ${pick.pinned && pick.theme === theme && pick.n === ph.n ? 'is-pinned' : ''}" data-action="photo-pin" data-id="${id}" data-theme="${esc(theme)}" data-n="${ph.n}" title="Pin this photo for every funder"><img src="${esc(ph.image)}" alt="" loading="lazy" /></button>`).join('') || '<span class="subtle">No photos in this theme yet.</span>'}</div>
      ${pick.pinned ? `<button type="button" class="button button-ghost button-small" data-action="photo-unpin" data-id="${id}">${svgIcon('refresh')}Back to automatic rotation</button>` : ''}</div></div></div>`;
}
function projectTenderSection(p) {
  const t = p.tender; const id = esc(p.id); const isAdmin = state.auth.role === 'admin' || state.auth.isRoot || state.auth.demoAccess;
  const provinces = ['', 'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
  const head = `<div class="detail-section-title"><span class="section-title-text">${svgIcon('shield')}Suppliers & quotes</span></div>`;
  if (!t || (['closed', 'done'].includes(t.status) && state.sup.reopen === p.id)) {
    const m = state.sup.match;
    return `<div class="detail-section">${head}${tenderHistoryNote(p)}<p class="subtle">Send this need to approved suppliers by trade and province. Each gets an email with a hosted quote form; quotes land here.</p>
      <div class="tender-form"><select class="form-control" id="tender-trade">${Object.entries(TRADE_LABELS).map(([k, v]) => `<option value="${k}" ${m?.trade === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="form-control" id="tender-province">${provinces.map(x => `<option value="${esc(x)}" ${(m ? m.province : p.province) === x ? 'selected' : ''}>${x || 'Any province'}</option>`).join('')}</select>
      <input class="form-control" id="tender-days" type="number" min="1" max="60" value="7" title="Days until quotes close" /></div>
      <textarea class="form-control" id="tender-brief" rows="3" placeholder="What exactly must be quoted (the need in plain words). Defaults to the project summary.">${esc(p.summary || '')}</textarea>
      <div class="wb-step-actions"><button type="button" class="button button-secondary button-small" data-action="tender-match" data-id="${id}">${svgIcon('search')}Who would get it?</button>${m ? `<span class="subtle">${m.located ? `${m.rings.map(r => `<strong>${r.count}</strong> ${esc(r.label)}`).join(' · ')}${m.where ? ` of ${esc(m.where)}` : ''}` : `${m.count} approved supplier${m.count === 1 ? '' : 's'} (no GPS for this school — all at once)`}${m.suppliers.length ? `: ${m.suppliers.slice(0, 5).map(x => `${esc(x.company)}${x.distanceKm !== null ? ` ${x.distanceKm} km` : ''}`).join(', ')}${m.count > 5 ? '…' : ''}` : ''}</span>` : ''}<button type="button" class="button button-primary button-small" data-action="tender-open" data-id="${id}" ${m && m.count === 0 ? 'disabled title="No approved supplier matches yet"' : ''}>${svgIcon('send')}Ask suppliers to quote</button></div>
      <p class="subtle">Nearest first: suppliers within 25 km of the school get the email now; if fewer than 3 quotes arrive, Chelo widens to 75 km after 48 hours, then the whole province.</p></div>`;
  }
  const open = t.status === 'open' && new Date(t.closesAt) > new Date();
  const signed = (t.quotes || []).find(q => q.id === t.awardedQuoteId);
  const link = `${location.origin}/quote/${encodeURIComponent(t.token)}`;
  const rows = (t.quotes || []).slice().sort((a, b) => a.amount - b.amount).map(q => `<tr class="${q.status === 'declined' ? 'row-invalid' : ''}"><td><strong>${esc(q.company)}</strong><br><small class="subtle">${esc(q.contactName || '')}${q.phone ? ` · ${esc(q.phone)}` : ''} · ${isoDate(q.submittedAt)}</small>${q.notes ? `<br><small>${esc(q.notes)}</small>` : ''}${q.attachmentsUrl ? `<br><a class="source-link" href="${esc(safeUrl(q.attachmentsUrl))}" target="_blank" rel="noopener noreferrer">${svgIcon('external')}itemised quote</a>` : ''}</td><td>R ${Number(q.amount).toLocaleString('en-ZA')}</td><td>${q.leadTimeDays} d</td><td><span class="stage-pill ${q.status === 'signed' ? 'pill-won' : q.status === 'shortlisted' ? 'pill-interested' : q.status === 'declined' ? 'pill-not-proceeding' : 'pill-new'}">${esc(q.status)}</span></td><td>${t.status === 'done' ? '' : `${q.status === 'submitted' ? `<button type="button" class="button button-ghost button-small" data-action="quote-status" data-id="${id}" data-quote="${esc(q.id)}" data-status="shortlisted">Shortlist</button>` : ''}${['submitted', 'shortlisted'].includes(q.status) && !signed && isAdmin ? `<button type="button" class="button button-primary button-small" data-action="quote-status" data-id="${id}" data-quote="${esc(q.id)}" data-status="signed">${svgIcon('check')}Sign</button>` : ''}${q.status !== 'declined' ? `<button type="button" class="button button-ghost button-small" data-action="quote-status" data-id="${id}" data-quote="${esc(q.id)}" data-status="declined">Decline</button>` : ''}`}</td></tr>`).join('');
  return `<div class="detail-section">${head}
    <p class="subtle">${esc(TRADE_LABELS[t.trade] || t.trade)}${t.province ? ` · ${esc(t.province)}` : ''} · sent to ${t.sentTo.length} supplier${t.sentTo.length === 1 ? '' : 's'} ${isoDate(t.openedAt)} · ${t.status === 'done' ? `<strong>done</strong>, confirmed by ${esc(t.confirmedBy)} ${isoDate(t.completedAt)}` : t.status === 'awarded' ? `<strong>${esc(signed?.company || '')} signed</strong> ${isoDate(t.signedAt)}${t.feePct !== null && t.feePct !== undefined ? ` · Chelo fee ${t.feePct}%` : ' · no Chelo fee recorded'}` : open ? `open until ${isoDate(t.closesAt)}` : 'closed'}</p>
    <div class="wb-step-actions"><input class="form-control" readonly value="${esc(link)}" style="min-width:260px" /><button type="button" class="button button-ghost button-small" data-action="copy-text" data-text="${esc(link)}">${svgIcon('copy')}Copy quote link</button>${open ? `<button type="button" class="button button-ghost button-small" data-action="tender-close" data-id="${id}">Close quotes</button>` : ''}</div>
    ${t.waves?.length ? `<p class="subtle tender-waves">${t.waves.map(w => `${svgIcon('send')}${w.count} ${esc(w.label)} · ${isoDate(w.sentAt)}`).join(' → ')}${open && Math.max(...t.waves.map(w => w.ring)) < 2 ? ` · ${(t.quotes || []).length >= (t.targetQuotes || 3) ? 'enough quotes, no widening planned' : `widens automatically ${isoDate(t.nextWaveAt)}`} <button type="button" class="link-button" data-action="tender-widen" data-id="${id}">widen now</button>` : ''}</p>` : ''}
    ${tenderHistoryNote(p)}
    ${['closed', 'done'].includes(t.status) ? `<p><button type="button" class="button button-ghost button-small" data-action="tender-reopen" data-id="${id}">${svgIcon('plus')}Ask suppliers again (new request)</button></p>` : ''}
    ${t.quotes?.length ? `<div class="lead-table-wrap"><table class="table"><thead><tr><th>Supplier</th><th>Amount</th><th>Time</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="subtle">No quotes yet.</p>'}
    ${!signed && isAdmin && (t.quotes || []).some(q => ['submitted', 'shortlisted'].includes(q.status)) ? `<label class="form-group" style="max-width:260px"><span>Chelo fee % on the signed quote (optional — money is handled on your other platform)</span><input class="form-control" id="tender-fee" type="number" min="0" max="30" step="0.5" placeholder="e.g. 5" /></label>` : ''}
    ${t.status === 'awarded' ? `<div class="wb-call-log" style="margin-top:10px"><strong>When the school says the work is done</strong><input class="form-control" id="tender-confirmed-by" placeholder="Who confirmed, how — e.g. Principal Mokoena, by phone" /><input class="form-control" id="tender-done-notes" placeholder="Notes (optional)" /><div><button type="button" class="button button-primary button-small" data-action="tender-done" data-id="${id}">${svgIcon('checkCircle')}School confirmed done</button></div></div>` : ''}
  </div>`;
}
function projectDetailModal(p) {
  if (!p) return '';
  const linked = state.data.leads.filter(l => l.projectId === p.id);
  const partners = state.data.partners.filter(x => x.projectId === p.id);
  const source = safeUrl(p.sourceUrl);
  const body = `<div class="detail-profile"><div class="detail-avatar">${initials(p.name)}</div><div><h2>${esc(p.name)}</h2><p>${esc(p.recipientName)} · ${esc(p.province)} · ${esc(p.sector)}</p></div></div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('trend')}Funding ledger</span></div>${fundingBar(p.funding, p.targetAmount)}<div class="detail-grid" style="margin-top:12px"><div class="detail-item"><small>Target</small><strong>${money(p.targetAmount)}</strong></div><div class="detail-item"><small>Committed (incl. won)</small><strong>${money(p.funding?.committedTotal)}</strong></div><div class="detail-item"><small>Funding gap</small><strong>${money(p.funding?.fundingGap)}</strong></div><div class="detail-item"><small>Active pipeline</small><strong>${money(p.funding?.pipelineAmount)}</strong></div></div></div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('checkCircle')}Verification</span></div><div class="detail-item"><small>Source</small>${source ? `<a class="source-link" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(source)} ${svgIcon('external')}</a>` : '<strong>No source URL</strong>'}<small>Verified ${esc(dateOnly(p.verifiedAt) || '—')} · ${esc(p.status)}</small></div>${p.summary ? `<div class="detail-note" style="margin-top:10px">${esc(p.summary)}</div>` : ''}</div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('analytics')}Verified metrics</span></div>${(p.verifiedMetrics || []).map(m => `<div class="project-metric"><strong>${esc(m.label)}</strong><span>${esc(String(m.baselineValue))} → <b>${esc(String(m.currentValue))}</b> ${esc(m.unit)}</span><small>${esc(m.period)} · ${esc(m.source)}</small></div>`).join('') || '<span class="subtle">None recorded.</span>'}</div>
    ${projectPhotoSection(p)}
    ${projectSupportersSection(p)}
    ${projectTenderSection(p)}
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('users')}Team on this project</span>${state.data.canSeeAll ? `<button class="table-action" data-action="project-team-open" data-id="${esc(p.id)}">${svgIcon('edit')}Change</button>` : ''}</div><p class="subtle">${(p.team || []).length ? esc((p.team || []).map(id => (state.data.directory || []).find(u => String(u.id) === String(id))?.displayName || 'Former staff').join(', ')) + ' — they see every funder linked to this project.' : 'Nobody extra yet. Owners of each funder, people it is shared with, and admins can see them.'}</p></div>
    <div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('prospects')}Linked prospects (${linked.length}) & partners (${partners.length})</span></div>${linked.map(l => `<div class="shortcut-row"><div class="shortcut-icon">${svgIcon('prospects')}</div><div class="shortcut-copy"><strong>${esc(l.company)}</strong><span>${esc(l.stage)} · ${money(l.amount)} · ${esc(grantCycleLabel(l))}</span></div><button class="table-action" data-action="open-lead" data-id="${esc(l.id)}">${svgIcon('eye')}Open</button></div>`).join('')}${partners.map(x => `<div class="shortcut-row"><div class="shortcut-icon">${svgIcon('partners')}</div><div class="shortcut-copy"><strong>${esc(x.company)}</strong><span>Partner · ${money(x.amount)}</span></div></div>`).join('') || (!linked.length ? '<span class="subtle">No prospects linked yet.</span>' : '')}</div>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">Updated ${isoDate(p.updatedAt)}</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Close</button>${state.auth.role !== 'reviewer' ? `<button type="button" class="button button-primary" data-action="edit-project" data-id="${esc(p.id)}">${svgIcon('edit')} Edit project</button>` : ''}</div>`;
  return modalFrame('Verified project', 'Funding gap, provenance and linked outreach.', body, footer);
}
const PROJECT_CSV_FIELDS = ['name', 'recipient_name', 'recipient_type', 'province', 'sector', 'target_amount', 'committed_amount', 'grant_cycle_window', 'source_url', 'verified_at', 'summary', 'verified_metrics'];
async function handleProjectCsv(file) {
  try {
    const text = await file.text();
    const { records, errors } = parseCsvDocument(text);
    if (!records.length) throw new Error('The CSV file has no rows.');
    const headers = records[0].values.map(csvHeaderKey);
    const rows = records.slice(1).map(record => {
      const data = {};
      headers.forEach((h, i) => { if (PROJECT_CSV_FIELDS.includes(h)) data[h] = record.values[i] ?? ''; });
      const problems = [];
      if (!String(data.name || '').trim()) problems.push('name missing');
      if (!String(data.recipient_name || '').trim()) problems.push('recipient missing');
      if (!/^\d+(\.\d+)?$/.test(String(data.target_amount || '').replace(/[^\d.]/g, ''))) problems.push('target amount invalid');
      return { rowNumber: record.rowNumber, data, error: problems.join(', '), include: problems.length === 0 };
    });
    state.projectImportPreview = { fileName: file.name, rows, parseErrors: errors || [] };
    openModal('project-import');
  } catch (err) { toast(err.message, true); }
}
function projectImportModal(preview) {
  if (!preview) return '';
  const rows = preview.rows.map(r => `<tr class="${r.error ? 'row-invalid' : ''}"><td><input type="checkbox" data-project-row="${r.rowNumber}" ${r.include ? 'checked' : ''} ${r.error ? 'disabled' : ''} /></td><td>${esc(r.data.name || '')}<span class="company-secondary">${esc(r.data.recipient_name || '')} · ${esc(r.data.province || '')}</span></td><td>${esc(r.data.target_amount || '')}</td><td>${r.error ? `<span class="status-pill status-declined">${esc(r.error)}</span>` : '<span class="status-pill status-confirmed">Ready</span>'}</td></tr>`).join('');
  const body = `<p class="page-subtitle">${esc(preview.fileName)} · ${preview.rows.length} row(s). Existing projects with the same name are updated.</p><div class="lead-table-wrap"><table class="table"><thead><tr><th></th><th>Project</th><th>Target</th><th>Check</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${preview.rows.filter(r => !r.error).length} valid</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="button" class="button button-primary" data-action="project-import-confirm">${svgIcon('upload')} Import selected</button></div>`;
  return modalFrame('Import verified projects', 'Review before adding to the catalog.', body, footer, false, 'modal-wide');
}
function copilotModal() {
  const c = state.copilot || { text: '', result: null, error: '' };
  const tabs = `<div class="note-callout"><span class="note-callout-icon">${svgIcon('info')}</span><span>Web research with citations runs from the Workbench <strong>Research</strong> step. This copilot extracts facts from text you paste.</span></div>`;
  const r = c.result;
  const extracted = r?.extracted;
  const resultBlock = r ? `<div class="copilot-result"><div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>${r.mode === 'openai' ? 'AI-assisted extraction' : 'Local extraction (no AI provider)'}.</strong> ${esc(r.message)} Redacted before processing: ${r.redactions.emails} email(s), ${r.redactions.phones} phone(s), ${r.redactions.saIds} ID number(s).</span></div><div class="detail-grid" style="margin-top:12px"><div class="detail-item"><small>Sector</small><strong>${esc(extracted.sector || '—')}</strong></div><div class="detail-item"><small>Grant window</small><strong>${esc(grantCycleLabel(extracted))}</strong></div><div class="detail-item"><small>Suggested project</small><strong>${esc(state.data.projects.find(p => p.id === extracted.suggestedProjectId)?.name || 'None (staff decide)')}</strong></div><div class="detail-item"><small>Signals</small><strong>${extracted.employeeVolunteering ? 'Volunteering · ' : ''}${extracted.inKindSupport ? 'In-kind · ' : ''}${(extracted.focusAreas || []).length} focus area(s)</strong></div></div><div class="detail-item" style="margin-top:10px"><small>Partner priorities (editable after apply)</small><div class="detail-note">${esc(extracted.partnerPriorities || '')}</div></div>${(extracted.focusAreas || []).length ? `<div class="chip-row">${extracted.focusAreas.map(f => `<span class="stage-pill pill-researched">${esc(f)}</span>`).join('')}</div>` : ''}</div>` : '';
  const body = `<div class="note-callout"><span class="note-callout-icon">${svgIcon('info')}</span><span><strong>POPIA boundary.</strong> Paste only text from public CSI reports, sustainability pages or grant guidelines (ideal for PDFs the web tab cannot read). Chelo never bulk-crawls websites; research runs only when staff ask for one organisation. Emails, phone numbers and SA ID numbers are scrubbed server-side before any AI call; relationship notes and contact details are never sent.</span></div>
    <div class="form-group" style="margin-top:12px"><label for="copilot-text">Public excerpt</label><textarea class="form-control" id="copilot-text" style="min-height:180px" maxlength="12000" placeholder="Paste a paragraph or two from the public source…">${esc(c.text)}</textarea></div>
    ${c.error ? `<div class="form-error">${esc(c.error)}</div>` : ''}${resultBlock}`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${state.copilotBusy ? 'Scrubbing & extracting…' : 'Human review required before saving'}</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Close</button><button type="button" class="button button-secondary" data-action="copilot-run" ${state.copilotBusy ? 'disabled' : ''}>${svgIcon('spark')} Extract</button>${extracted ? `<button type="button" class="button button-primary" data-action="copilot-apply">${svgIcon('check')} Apply to prospect form</button>` : ''}</div>`;
  return modalFrame('Research copilot', 'Structure public CSI text into priorities and grant timing.', `${tabs}${body}`, footer, true);
}
function radarView() {
  const radar = state.data.radar;
  if (!radar) return `<section class="panel radar-panel"><div class="panel-head"><div><h2>Grant-Cycle Radar</h2><p class="panel-description">Loading grant windows and follow-up queue…</p></div></div></section>`;
  const items = (radar.items || []).slice(0, 8);
  const due = radar.followUps?.dueNow || [];
  const list = items.map(i => `<div class="radar-row radar-${esc(i.cycle.code)}"><div class="radar-copy"><strong>${esc(i.company)}</strong><span>${esc(i.project || '')} · ${esc(i.stage)} · ${shortMoney(i.amount)}</span></div><span class="radar-label">${esc(i.cycle.label)}</span>${i.kind === 'prospect' ? `<button class="table-action" data-action="open-lead" data-id="${esc(i.id)}">${svgIcon('eye')}Open</button>` : `<button class="table-action" data-view="discover">${svgIcon('eye')}Review</button>`}</div>`).join('');
  const dueList = due.slice(0, 5).map(d => `<div class="radar-row radar-closing-soon"><div class="radar-copy"><strong>${esc(d.company)}</strong><span>Follow-up ${d.step} · ${esc(d.owner)} · ${d.overdueDays ? `${d.overdueDays}d overdue` : 'due today'}</span></div><span class="radar-label">${esc(d.followUpEmailStatus)}</span><button class="table-action" data-action="open-lead" data-id="${esc(d.leadId)}">${svgIcon('eye')}Open</button></div>`).join('');
  return `<section class="panel radar-panel"><div class="panel-head"><div><h2>Grant-Cycle Radar</h2><p class="panel-description">Funder windows and deadlines recorded by staff, plus follow-ups due now (${radar.followUps?.dueCount || 0}).</p></div><button class="panel-action" data-action="refresh-radar">${svgIcon('refresh')}Refresh</button></div><div class="radar-grid"><div><h3 class="radar-heading h-icon">${svgIcon('calendar')}Grant windows</h3>${list || '<span class="subtle">Record grant windows or deadlines on prospects to populate the radar.</span>'}</div><div><h3 class="radar-heading h-icon">${svgIcon('clock')}Follow-ups due</h3>${dueList || '<span class="subtle">No follow-ups due right now.</span>'}</div></div></section>`;
}
async function loadRadar() {
  try { state.data.radar = await API('/api/radar'); if (state.view === 'overview') renderApp(); } catch {}
}
/** Settings → Media kit (R2): the only words a pitch may use about Chelo. Admin edits; admin approves; editing resets approval. */
function loadMediaKit(force) {
  if ((state.mediaKit && !force) || state.mediaKitLoading) return;
  state.mediaKitLoading = true;
  API('/api/media-kit').then(r => { state.mediaKit = r; state.mediaKitLoading = false; renderApp(); }).catch(err => { state.mediaKitLoading = false; toast(err.message, true); });
}
function mediaKitView(isAdmin) {
  loadMediaKit();
  const k = state.mediaKit?.kit; if (!k) return `<section class="panel settings-card"><p class="subtle">Loading the media kit…</p></section>`;
  const approved = k.status === 'approved';
  const ro = isAdmin ? '' : 'readonly';
  return `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('globe')}</span><div><h2>Media kit</h2><p>Every PR and partnership pitch is written from this kit and nothing else. ${approved ? `<span class="stage-pill pill-won">${svgIcon('check')}Approved ${isoDate(k.approvedAt)} by ${esc(k.approvedBy || '')}</span>` : `<span class="stage-pill pill-pending">Draft — pitches are blocked until an administrator approves</span>`}${k.starter ? ' <span class="subtle">Chelo wrote this starter kit from the product and the public site. Read it, change what is out of date (spokesperson, press mailbox, facts), then <strong>Save & approve</strong>.</span>' : ''}</p></div></div>
    <form id="media-kit-form" data-form="media-kit" class="settings-fields">
      <div class="form-group full"><label for="mk-boiler">About Chelo (one paragraph journalists can quote) *</label><textarea id="mk-boiler" class="form-control" name="boilerplate" rows="4" maxlength="600" ${ro}>${esc(k.boilerplate)}</textarea></div>
      <div class="form-group full"><label for="mk-facts">Facts they may quote (one per line, max 8)</label><textarea id="mk-facts" class="form-control" name="facts" rows="5" ${ro} placeholder="e.g. Chelo verifies every quote and pays suppliers directly.">${esc((k.facts || []).join('\n'))}</textarea></div>
      <div class="form-group"><label for="mk-spokes">Spokesperson</label><input id="mk-spokes" class="form-control" name="spokesperson" value="${esc(k.spokesperson)}" ${ro} /></div>
      <div class="form-group"><label for="mk-spokes-title">Spokesperson title</label><input id="mk-spokes-title" class="form-control" name="spokespersonTitle" value="${esc(k.spokespersonTitle)}" ${ro} /></div>
      <div class="form-group"><label for="mk-press">Press mailbox</label><input id="mk-press" class="form-control" name="pressEmail" type="email" value="${esc(k.pressEmail)}" ${ro} /></div>
      <div class="form-group"><label for="mk-assets">Photos, logos, backgrounder (link)</label><input id="mk-assets" class="form-control" name="assetsUrl" value="${esc(k.assetsUrl)}" ${ro} placeholder="https://…" /></div>
    </form>
    ${isAdmin ? `<div class="settings-card-actions"><button type="submit" form="media-kit-form" class="button button-secondary">${svgIcon('save')} Save kit</button><button type="button" class="button button-primary" data-action="media-kit-save-approve">${svgIcon('checkCircle')} Save & approve for pitches</button>${approved ? '' : `<button type="button" class="button button-secondary" data-action="media-kit-approve" ${k.boilerplate ? '' : 'disabled'}>${svgIcon('checkCircle')} Approve for pitches</button>`}<span class="subtle">Saving resets approval, so a second look always follows a change.</span></div>` : `<p class="subtle">Only administrators edit and approve the kit.</p>`}
  </section>`;
}
/** R5 G2: the signed-in person's own two-step sign-in and sessions. */
function signInSecurityCard() {
  if (state.auth.demoAccess) return '';
  const m = state.mfa;
  if (!m.status && !m.loading) { m.loading = true; API('/api/auth/mfa').then(r => { m.status = r; m.loading = false; renderApp(); }).catch(() => { m.loading = false; }); }
  const st = m.status || { enabled: false, recoveryLeft: 0 };
  let body;
  if (m.recoveryCodes) {
    body = `<div class="form-error" style="background:#e8f5ec;color:#1d5a2e"><strong>Two-step is on.</strong> Save these recovery codes somewhere safe (password manager, printed in a drawer). Each works once if you lose your phone. They will not be shown again.</div>
      <pre class="mfa-codes">${m.recoveryCodes.map(esc).join('\n')}</pre><div class="settings-card-actions"><button type="button" class="button button-secondary" data-action="copy-text" data-text="${esc(m.recoveryCodes.join('\n'))}">${svgIcon('copy')} Copy codes</button><button type="button" class="button button-primary" data-action="mfa-codes-saved">${svgIcon('check')} I have saved them</button></div>`;
  } else if (m.setup) {
    body = `<p>1. Open your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and add an account by <strong>entering the key manually</strong>, or open the link below on your phone.</p>
      <p class="mfa-secret"><code>${esc(m.setup.secret.replace(/(.{4})/g, '$1 ').trim())}</code> <button type="button" class="table-action" data-action="copy-text" data-text="${esc(m.setup.secret)}">${svgIcon('copy')}Copy key</button> · <a href="${esc(m.setup.otpauth)}">Open in authenticator app</a></p>
      <p>2. Type the 6-digit code the app shows for <strong>Chelo</strong>.</p>
      <form data-form="mfa-enable" class="wb-step-actions"><input class="form-control" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" required style="max-width:160px" /><button type="submit" class="button button-primary">${svgIcon('lock')} Switch two-step on</button><button type="button" class="button button-ghost" data-action="mfa-cancel">Cancel</button></form>`;
  } else if (st.enabled) {
    body = `<p><span class="status-pill status-confirmed">On</span> since ${isoDate(st.enabledAt)} · ${st.recoveryLeft} recovery code${st.recoveryLeft === 1 ? '' : 's'} left${st.recoveryLeft <= 2 ? ' — <strong>switch off and on again to get a fresh set</strong>' : ''}.</p>
      <form data-form="mfa-disable" class="wb-step-actions"><input class="form-control" name="password" type="password" autocomplete="current-password" placeholder="Current password" required style="max-width:220px" /><button type="submit" class="button button-ghost">Switch two-step off</button></form>`;
  } else {
    body = `<p><span class="status-pill status-declined">Off</span> Your password alone opens this workspace. Two-step adds a 6-digit code from an app on your phone; ${state.auth.role === 'admin' ? '<strong>recommended for every administrator</strong>' : 'recommended'}.</p>
      <div class="settings-card-actions"><button type="button" class="button button-primary" data-action="mfa-setup">${svgIcon('lock')} Set up two-step sign-in</button></div>`;
  }
  return `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('lock')}</span><div><h2>Your sign-in security</h2><p>Two-step sign-in for <strong>${esc(state.auth.username)}</strong>, and a way to end every other session of yours (shared computer, lost laptop). Google sign-in keeps Google's own two-step.</p></div></div>
    ${body}
    <div class="settings-card-actions" style="margin-top:12px"><button type="button" class="button button-secondary" data-action="revoke-sessions">${svgIcon('lock')} Sign out everywhere else</button><span class="subtle">Ends your sessions on other browsers and devices; this one stays.</span></div>
    <p class="subtle" style="margin-top:10px">${svgIcon('shield')} Rate limiting is on for the whole API (sign-in 30/min, public forms 90/min, signed-in 900/min per session). <a href="/privacy" target="_blank" rel="noopener">Privacy notice</a> covers what we hold and where (hosted in the EU/US under standard contractual clauses).</p>
  </section>`;
}
function governanceView(isAdmin) {
  const policy = state.auth.approvalPolicy || state.data.settings?.approvalPolicy || 'single';
  const staff = state.data.staff || [];
  const rows = staff.map(u => `<tr><td><strong>${esc(u.displayName)}</strong><span class="company-secondary">${esc(u.username)}</span></td><td>${esc(roleLabel(u.role))}${u.isRoot ? ' <span class="status-pill status-confirmed" title="Founding administrator · cannot be demoted, deactivated or reset by others">Root</span>' : ''}${u.coRoot ? ' <span class="status-pill status-confirmed" title="Same access as the root account · protected from demotion, deactivation and resets by others">Full access</span>' : ''}</td><td>${u.active ? '<span class="status-pill status-confirmed">Active</span>' : '<span class="status-pill status-declined">Deactivated</span>'}${u.mfaEnabled ? ' <span class="status-pill status-confirmed" title="Two-step sign-in on">2-step</span>' : ''}</td><td>${isoDate(u.createdAt)}</td><td>${u.isRoot && u.id !== state.auth.userId ? '<span class="subtle">Protected</span>' : `<button class="table-action" data-action="edit-staff" data-id="${esc(u.id)}">${svgIcon('edit')}Edit</button>${!u.isRoot && !u.coRoot && u.id !== state.auth.userId ? `<button class="table-action" data-action="staff-signout" data-id="${esc(u.id)}" title="End every session of this account">${svgIcon('lock')}Sign out</button>${u.mfaEnabled ? `<button class="table-action" data-action="staff-mfa-reset" data-id="${esc(u.id)}" title="Lost phone: switch two-step off so they can sign in and set it up again">${svgIcon('shield')}Reset 2-step</button>` : ''}` : ''}${u.isRoot || u.coRoot ? '' : `<button class="table-action" data-action="toggle-staff" data-id="${esc(u.id)}">${svgIcon('users')}${u.active ? 'Deactivate' : 'Reactivate'}</button>`}${isPrimaryRoot() && !u.isRoot && u.active ? `<button class="table-action" data-action="toggle-coroot" data-id="${esc(u.id)}" data-enable="${u.coRoot ? '0' : '1'}">${svgIcon('shield')}${u.coRoot ? 'Revoke full access' : 'Grant full access'}</button>` : ''}`}</td></tr>`).join('');
  return `<div class="settings-status-grid"><div class="settings-status-card"><span class="metric-icon">${svgIcon('shield')}</span><div><strong>Approval policy</strong><small>${policy === 'four-eyes' ? 'Strict 4-eyes · two different staff must approve every outbound email' : 'Single approver · one staff approval releases email'}</small></div><span class="status-dot ${policy === 'four-eyes' ? 'is-on' : ''}"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('partners')}</span><div><strong>Staff accounts</strong><small>${staff.filter(u => u.active).length} active · ${staff.filter(u => u.role === 'admin' && u.active).length} admin</small></div><span class="status-dot is-on"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('activity')}</span><div><strong>Audit ledger</strong><small>HMAC hash-chained · 365-day retention</small></div><button class="table-action" data-action="verify-audit">${svgIcon('shield')}Verify chain</button></div></div>
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('shield')}</span><div><h2>Outbound email approval</h2><p>Approvals are stamped with an HMAC digest of recipient, subject, body and attachment. Any edit voids the approval. In 4-eyes mode the second signature must come from a different Admin or Reviewer.</p></div></div><div class="policy-toggle"><button type="button" class="policy-option ${policy === 'single' ? 'active' : ''}" data-action="set-approval-policy" data-policy="single" ${isAdmin ? '' : 'disabled'}>${svgIcon('prospects')}<strong>1-person approval</strong><span>Small team · fast handoff</span></button><button type="button" class="policy-option ${policy === 'four-eyes' ? 'active' : ''}" data-action="set-approval-policy" data-policy="four-eyes" ${isAdmin ? '' : 'disabled'}>${svgIcon('shield')}<strong>Strict 4-eyes</strong><span>Drafter + independent countersignature</span></button></div>${isAdmin ? '' : '<span class="form-hint">Only administrators can change the policy.</span>'}</section>
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('send')}</span><div><h2>Outreach style & guardrail</h2><p>Ladder: interest-based first touch (no link), one-page + meeting at step 2, two real slots at step 3, graceful close. The guardrail checks every approval for invented numbers, false urgency, scarcity and guilt framing.</p></div></div><div class="policy-toggle"><button type="button" class="policy-option ${(state.data.settings?.outreachStyle || 'ladder') === 'ladder' ? 'active' : ''}" data-action="set-outreach-style" data-style="ladder" ${isAdmin ? '' : 'disabled'}>${svgIcon('send')}<strong>CTA ladder</strong><span>Interest → page + meeting → slots → close</span></button><button type="button" class="policy-option ${state.data.settings?.outreachStyle === 'classic' ? 'active' : ''}" data-action="set-outreach-style" data-style="classic" ${isAdmin ? '' : 'disabled'}>${svgIcon('mail')}<strong>Classic</strong><span>Booking link in the first email</span></button></div><div class="policy-toggle" style="margin-top:10px"><button type="button" class="policy-option ${(state.data.settings?.guardrail || 'block') === 'block' ? 'active' : ''}" data-action="set-guardrail" data-mode="block" ${isAdmin ? '' : 'disabled'}>${svgIcon('shield')}<strong>Guardrail blocks</strong><span>Admin may override with a reason</span></button><button type="button" class="policy-option ${state.data.settings?.guardrail === 'warn' ? 'active' : ''}" data-action="set-guardrail" data-mode="warn" ${isAdmin ? '' : 'disabled'}>${svgIcon('eye')}<strong>Warn only</strong><span>Issues shown, approval proceeds</span></button></div></section>
    ${signInSecurityCard()}
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('partners')}</span><div><h2>Staff accounts & roles</h2><p>Admin: full control. Reviewer: read everything, approve/countersign/return drafts, no record edits. Relationship Owner: manage prospects, projects and briefings; first approvals only.</p></div></div>${isAdmin ? `<div class="lead-table-wrap"><table class="table"><thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5"><div class="panel-empty">No staff accounts yet.</div></td></tr>'}</tbody></table></div><div class="settings-card-actions"><button class="button button-primary" type="button" data-action="new-staff">${svgIcon('plus')} Add staff account</button></div>` : '<span class="form-hint">Staff management is restricted to administrators.</span>'}</section>
    ${isAdmin ? `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon gold">${svgIcon('info')}</span><div><h2>Demo data</h2><p>Remove the fictional demo prospects, candidates, partners and briefings in one step. The verified Chelo project catalog is retained.</p></div></div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-action="clear-demo">${svgIcon('trash')}Clear demo records</button></div></section>` : ''}`;
}
function staffFormModal(user) {
  const edit = Boolean(user);
  const body = `<form id="staff-form" data-form="staff" data-id="${edit ? esc(user.id) : ''}"><div class="form-grid">
    <div class="form-group"><label for="s-name">Display name *</label><input class="form-control" id="s-name" name="displayName" required value="${esc(user?.displayName || '')}" /></div>
    <div class="form-group"><label for="s-email">Work email *</label><input class="form-control" id="s-email" name="username" type="email" required value="${esc(user?.username || '')}" ${edit ? 'readonly' : ''} /></div>
    <div class="form-group full"><label for="s-role">Role</label><select class="form-control" id="s-role" name="role" ${user?.isRoot || user?.coRoot ? 'disabled title="This account is always an administrator"' : ''}>${['admin', 'reviewer', 'owner'].map(r => `<option value="${r}" ${(user?.role || 'owner') === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}</select></div>
    <div class="form-group full"><label>Desks</label><div class="desk-checks">${(state.auth?.deskCatalogue || []).map(d => `<label class="check-inline"><input type="checkbox" name="desks" value="${esc(d.id)}" ${(user?.desks || ['csi']).includes(d.id) ? 'checked' : ''} ${user?.isRoot || user?.coRoot ? 'disabled' : ''} /> ${esc(d.label)}</label>`).join('')}</div><div class="subtle">Administrators always hold every desk. Tick one or more desks for owners and reviewers.</div></div>
    <div class="form-group"><label for="s-pass">${edit ? 'New password (optional)' : 'Password *'}</label><input class="form-control" id="s-pass" name="password" type="password" autocomplete="new-password" minlength="12" ${edit ? '' : 'required'} placeholder="At least 12 characters" /></div>
    ${edit ? '' : `<div class="form-group"><label for="s-pass2">Confirm password *</label><input class="form-control" id="s-pass2" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></div>`}
  </div></form>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${edit ? 'Password changes revoke active sessions' : 'Share credentials securely'}</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="staff-form" class="button button-primary">${svgIcon('save')}${edit ? 'Save account' : 'Create account'}</button></div>`;
  return modalFrame(edit ? 'Edit staff account' : 'Add staff account', 'Every action is attributed to the signed-in staff member.', body, footer, true);
}
function briefingsSettingsView(settings) {
  const platforms = state.data.videoPlatforms || [];
  return `<form id="settings-form" data-form="settings" class="settings-form">
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('calendar')}</span><div><h2>Video briefings & calendar invites</h2><p>When a briefing is confirmed, Chelo emails an RFC 5545 .ics invite (Africa/Johannesburg, 20 minutes) with the video link. Add standing room links per platform, or paste a unique link on each booking.</p></div></div><div class="settings-fields">
      <div class="form-group"><label for="set-platform">Default platform</label><select class="form-control" id="set-platform" name="defaultPlatform">${platforms.map(p => `<option value="${esc(p.id)}" ${settings.defaultPlatform === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
      <label class="check-row"><input type="checkbox" name="autoSendCalendarInvite" ${settings.autoSendCalendarInvite ? 'checked' : ''} /> Send .ics invite automatically on confirmation <small>Requires SMTP; otherwise download the .ics from Briefings.</small></label>
      <div class="form-group full"><label for="set-meet">Google Meet standing room</label><input class="form-control" id="set-meet" name="googleMeetUrl" type="url" value="${esc(settings.googleMeetUrl || '')}" placeholder="https://meet.google.com/abc-defg-hij" /></div>
      <div class="form-group full"><label for="set-teams">Microsoft Teams standing room</label><input class="form-control" id="set-teams" name="microsoftTeamsUrl" type="url" value="${esc(settings.microsoftTeamsUrl || '')}" placeholder="https://teams.microsoft.com/l/meetup-join/…" /></div>
      <div class="form-group full"><label for="set-zoom">Zoom standing room</label><input class="form-control" id="set-zoom" name="zoomUrl" type="url" value="${esc(settings.zoomUrl || '')}" placeholder="https://zoom.us/j/…" /></div>
    </div><div class="settings-card-actions"><button class="button button-primary" type="submit">${svgIcon('check')} Save settings</button></div></section>
    ${isRoot() ? `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>Inbound replies & bounces</h2><p>Hard bounces mark the contact invalid and stop follow-ups; replies move the prospect to Interested and cancel the 5/10-business-day sequence. Use a provider webhook (HMAC-SHA256 signed) and/or optional IMAP polling of the sending mailbox.</p></div></div><div class="settings-fields">
      <div class="form-group full"><label>Webhook endpoint</label><input class="form-control" readonly value="${esc(location.origin)}/api/inbound/webhook" /><span class="form-hint">Header <code>X-Chelo-Signature</code> = hex HMAC-SHA256 of the raw JSON body. Accepts generic, Postmark, Resend and SendGrid shapes.</span></div>
      <div class="form-group full"><label>Webhook secret</label><input class="form-control" readonly value="${settings.inboundWebhookReady ? '•••••••• (stored encrypted)' : 'Not set'}" /><span class="form-hint">Fetch via <code>GET /api/inbound/webhook-info</code> as Admin, or rotate below.</span></div>
      <div class="form-group"><label for="set-imap-host">IMAP host</label><input class="form-control" id="set-imap-host" name="imapHost" value="${esc(settings.imapHost || '')}" placeholder="imap.example.com" /></div>
      <div class="form-group"><label for="set-imap-port">IMAP port (TLS)</label><input class="form-control" id="set-imap-port" name="imapPort" type="number" min="1" max="65535" value="${Number(settings.imapPort || 993)}" /></div>
      <div class="form-group"><label for="set-imap-user">IMAP username</label><input class="form-control" id="set-imap-user" name="imapUsername" autocomplete="username" value="${esc(settings.imapUsername || '')}" /></div>
      <div class="form-group"><label for="set-imap-pass">IMAP password <span class="optional">(leave blank to keep)</span></label><input class="form-control" id="set-imap-pass" name="imapPassword" type="password" autocomplete="new-password" placeholder="${settings.imapConfigured ? 'Stored; hidden' : 'App password'}" /></div>
      <label class="check-row"><input type="checkbox" name="clearImapPassword" /> Remove saved IMAP password</label>
    </div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-action="rotate-webhook-secret">${svgIcon('key')}Rotate webhook secret</button><button class="button button-secondary" type="button" data-action="imap-sync" ${settings.imapConfigured ? '' : 'disabled'}>${svgIcon('activity')} Check inbox now</button><button class="button button-primary" type="submit">${svgIcon('check')} Save settings</button></div></section>` : ''}</form>`;
}
function bookingEditModal(b) {
  if (!b) return '';
  const platforms = state.data.videoPlatforms || [];
  const body = `<form id="booking-edit-form" data-form="booking-edit" data-id="${esc(b.id)}"><div class="form-grid">
    <div class="form-group"><label for="be-date">Date (SAST)</label><input class="form-control" id="be-date" name="date" type="date" value="${esc(b.date)}" /></div>
    <div class="form-group"><label for="be-time">Time (SAST)</label><input class="form-control" id="be-time" name="time" type="time" value="${esc(b.time)}" /></div>
    <div class="form-group"><label for="be-platform">Video platform</label><select class="form-control" id="be-platform" name="videoPlatform">${platforms.map(p => `<option value="${esc(p.id)}" ${b.videoPlatform === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
    <div class="form-group"><label for="be-status">Status</label><select class="form-control" id="be-status" name="status">${['Requested', 'Confirmed', 'Declined', 'Completed'].map(st => `<option ${b.status === st ? 'selected' : ''}>${st}</option>`).join('')}</select></div>
    <div class="form-group full"><label for="be-url">Meeting link (HTTPS)</label><input class="form-control" id="be-url" name="meetingUrl" type="url" value="${esc(b.meetingUrl || '')}" placeholder="${esc(platforms.find(p => p.id === b.videoPlatform)?.placeholder || 'https://…')}" /><span class="form-hint">Leave blank to use the standing room link from Settings → Briefings.</span></div>
    <div class="form-group full"><label for="be-note">Internal note</label><textarea class="form-control" id="be-note" name="note" maxlength="1000">${esc(b.note || '')}</textarea></div>
    <label class="check-row full"><input type="checkbox" name="resendInvite" /> Email an updated .ics invite after saving <small>Sequence number increments on time changes so calendars update.</small></label>
  </div></form>`;
  const footer = `<div class="modal-footer-left"><a class="button button-ghost button-small" href="/api/bookings/${encodeURIComponent(b.id)}/invite.ics" download>${svgIcon('download')} Download .ics</a></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="booking-edit-form" class="button button-primary">${svgIcon('save')}Save briefing</button></div>`;
  return modalFrame('Briefing details', `${b.organization} · ${b.contactName}`, body, footer, true);
}

// ---- Funder research (web) — cited brief, human review, then drafting ----
function researchStatus(lead) {
  const brief = lead?.research;
  if (!brief) return { key: 'none', label: 'No funder brief yet', pill: 'pill-new' };
  const stale = brief.expiresAt && new Date(brief.expiresAt).getTime() < Date.now();
  if (brief.status === 'approved' && stale) return { key: 'stale', label: `Approved brief is older than 30 days (${dateOnly(brief.generatedAt)})`, pill: 'pill-contacted' };
  if (brief.status === 'approved') return { key: 'approved', label: `Approved · ${brief.approvedFindingIds.length} finding(s), ${brief.approvedAlignmentIds.length} alignment point(s) in use`, pill: 'pill-won' };
  if (brief.status === 'rejected') return { key: 'rejected', label: 'Brief rejected · not used in drafts', pill: 'pill-not-proceeding' };
  return { key: 'pending', label: `Awaiting review · ${brief.findings.length} cited finding(s) from ${brief.sources.length} source(s)`, pill: 'pill-researched' };
}
function researchBriefCard(lead, context) {
  if (!lead) return '';
  const status = researchStatus(lead);
  const busy = state.researchBusy;
  const searchConfigured = Boolean(state.data.settings?.searchConfigured);
  const website = lead.research?.website || lead.website || lead.sourceUrl || '';
  const needsWebsite = !searchConfigured && !website;
  const hint = searchConfigured
    ? `Uses ${esc(state.data.settings.searchProvider)} plus the official website. Only organisation-level public facts are kept; PII is scrubbed before any AI step.`
    : 'No search provider is configured (Settings → Web research provider). Research will read the official website only.';
  const runLabel = status.key === 'none' ? 'Research funder' : 'Re-run research';
  const intro = context === 'copilot' ? '' : `<small>${status.key === 'approved' ? 'Approved findings will shape the alignment wording in this draft and the PDF’s “Alignment with your mission” section.' : status.key === 'pending' ? 'Review the brief so approved findings can inform this draft.' : 'Optional: gather cited public context on the funder’s mission before drafting.'}</small>`;
  return `<div class="research-card research-${status.key}"><div class="research-card-head"><span class="ai-guidance-icon">${svgIcon('globe')}</span><div><strong>Funder brief · ${esc(lead.company)}</strong><span class="stage-pill ${status.pill}">${esc(status.label)}</span>${intro}</div></div>
    <div class="research-card-body"><div class="form-group"><label for="research-website">Official website <span class="optional">(optional)</span></label><input class="form-control" id="research-website" value="${esc(website)}" placeholder="https://www.organisation.co.za" ${busy ? 'disabled' : ''} /><span class="form-hint">${hint}${needsWebsite ? ' Add the website to enable research.' : ''}</span></div>
    <div class="research-card-actions"><button type="button" class="button button-secondary button-small" data-action="research-run" data-id="${esc(lead.id)}" data-return="${esc(context === 'copilot' ? 'lead-detail' : context)}" ${busy ? 'disabled' : ''}>${svgIcon('globe')} ${busy ? 'Researching…' : runLabel}</button>${lead.research ? `<button type="button" class="button button-secondary button-small" data-action="research-open" data-id="${esc(lead.id)}">${svgIcon('eye')} ${status.key === 'pending' ? 'Review brief' : 'View brief'}</button>` : ''}${state.researchError ? `<span class="form-error">${esc(state.researchError)}</span>` : ''}</div></div></div>`;
}
function researchDetailSection(lead) {
  const brief = lead?.research;
  const status = researchStatus(lead);
  const approvedPoints = brief ? brief.alignmentPoints.filter(a => brief.approvedAlignmentIds.includes(a.id)) : [];
  return `<div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('globe')}Funder research</span> <span class="stage-pill ${status.pill}">${esc(status.label)}</span></div>
    ${brief ? `<div class="detail-item"><small>Mission summary (public sources)</small><div class="detail-note">${esc(brief.missionSummary || 'No mission statement extracted.')}</div>${brief.focusAreas?.length ? `<div class="chip-row">${brief.focusAreas.map(f => `<span class="stage-pill pill-researched">${esc(f)}</span>`).join('')}</div>` : ''}${approvedPoints.length ? `<ul class="research-list compact">${approvedPoints.map(a => `<li>${esc(a.text)} ${a.sourceUrl ? `<a class="source-link" href="${esc(safeUrl(a.sourceUrl))}" target="_blank" rel="noopener noreferrer">source ${svgIcon('external')}</a>` : ''}</li>`).join('')}</ul>` : ''}</div>` : `<p class="subtle">Run web research from Prepare outreach, the proposal editor or the Research copilot to gather cited public context on this funder’s mission.</p>`}
    <div class="detail-actions" style="margin-top:8px">${brief ? `<button type="button" class="button button-secondary button-small" data-action="research-open" data-id="${esc(lead.id)}">${svgIcon('eye')} ${status.key === 'pending' ? 'Review brief' : 'View brief'}</button>` : ''}<button type="button" class="button button-secondary button-small" data-action="open-copilot" data-target="lead-detail">${svgIcon('globe')} Research copilot</button></div></div>`;
}
function researchModal(lead) {
  if (!lead) return '';
  const brief = lead.research;
  if (!brief) return modalFrame('Funder brief', `No research brief for ${lead.company} yet.`, researchBriefCard(lead, 'lead-detail'), `<div class="modal-footer-left"></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="research-back">${svgIcon('back')}Back</button></div>`, true);
  const status = researchStatus(lead);
  const editable = true;
  const checked = (list, id) => (brief.status === 'pending-review' ? true : list.includes(id)) ? 'checked' : '';
  const conf = c => `<span class="research-confidence conf-${esc(c)}">${esc(c)}</span>`;
  const src = (url, title) => url ? `<a class="source-link" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(title || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))} ${svgIcon('external')}</a>` : '';
  const suggested = brief.suggestedProjectId ? state.data.projects.find(p => p.id === brief.suggestedProjectId) : null;
  const kindLabel = { mission: 'Mission', programme: 'Programme', public_figure: 'Public figure', grant_window: 'Grant window', news_giving: 'In the news' };
  const body = `<div id="research-review">
    <div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>${brief.mode === 'openai' ? 'AI-synthesised from public pages' : 'Local extraction from public pages'} via ${esc(brief.provider)}.</strong> Gathered ${isoDate(brief.generatedAt)}${brief.requestedBy ? ` by ${esc(brief.requestedBy)}` : ''}; valid for 30 days. Scrubbed before processing: ${brief.redactions.emails} email(s), ${brief.redactions.phones} phone(s), ${brief.redactions.saIds} ID number(s). Tick only facts you have checked against the source — approved items inform the email and the PDF’s “Alignment with your mission” section.</span></div>
    ${brief.warnings?.length ? `<div class="note-callout warn"><span class="note-callout-icon">${svgIcon('info')}</span><span>${brief.warnings.map(esc).join(' ')}</span></div>` : ''}
    <div class="form-group" style="margin-top:12px"><label for="research-mission">Mission summary <span class="optional">(editable; printed in the PDF when approved)</span></label><textarea class="form-control" id="research-mission" maxlength="240" rows="2">${esc(brief.missionSummary || '')}</textarea>${brief.focusAreas?.length ? `<div class="chip-row">${brief.focusAreas.map(f => `<span class="stage-pill pill-researched">${esc(f)}</span>`).join('')}</div>` : ''}</div>
    <div class="research-group"><h4>Alignment with Chelo <span class="subtle">(${brief.alignmentPoints.length})</span></h4>${brief.alignmentPoints.length ? brief.alignmentPoints.map(a => `<label class="research-item"><input type="checkbox" name="alignment" value="${esc(a.id)}" ${checked(brief.approvedAlignmentIds, a.id)} /><span><strong>${esc(a.text)}</strong>${a.evidence ? `<em>Evidence: ${esc(a.evidence)}</em>` : ''}<small>${src(a.sourceUrl, a.sourceTitle)}</small></span></label>`).join('') : '<p class="subtle">No alignment points could be grounded in the sources.</p>'}</div>
    <div class="research-group"><h4>Cited findings <span class="subtle">(${brief.findings.length})</span></h4>${brief.findings.length ? brief.findings.map(f => `<label class="research-item"><input type="checkbox" name="finding" value="${esc(f.id)}" ${f.kind === 'news_giving' && !f.fresh ? 'disabled' : checked(brief.approvedFindingIds, f.id)} /><span><strong>${esc(f.text)}</strong><small><span class="research-kind">${esc(kindLabel[f.kind] || f.kind)}</span>${f.kind === 'news_giving' ? ` ${esc(f.publishedAt ? f.publishedAt.slice(0, 7) : 'undated')}${f.fresh ? '' : ' · older than 12 months — not used in emails'}` : ''} ${conf(f.confidence)} ${src(f.sourceUrl, f.sourceTitle)}</small></span></label>`).join('') : '<p class="subtle">No findings. Try adding the official website or use Paste-to-Extract on a PDF report.</p>'}</div>
    <div class="research-group"><h4>Publicly listed CSI / foundation leads <span class="subtle">(${brief.contacts.length})</span></h4><p class="form-hint">Names and titles from public pages only — no emails or phone numbers are collected. Verify before adding to the prospect.</p>${brief.contacts.length ? brief.contacts.map(c => `<label class="research-item"><input type="checkbox" name="contact" value="${esc(c.id)}" ${checked(brief.approvedContactIds, c.id)} /><span><strong>${esc(c.name)}</strong> · ${esc(c.title)}<small>${conf(c.confidence)} ${src(c.sourceUrl, c.sourceTitle)}</small></span></label>`).join('') : '<p class="subtle">None found.</p>'}</div>
    ${suggested && !lead.projectId ? `<label class="check-row"><input type="checkbox" id="research-apply-project" checked /> Link suggested verified project: <strong>${esc(suggested.name)}</strong> <small>${esc(suggested.sector)} · ${esc(suggested.province)}</small></label>` : ''}
    <div class="research-group"><h4>Sources read <span class="subtle">(${brief.sources.length})</span></h4><ul class="research-list compact">${brief.sources.map(s => `<li>${src(s.url, s.title)} ${s.official ? '<span class="research-kind">official site</span>' : ''}</li>`).join('')}${(brief.attempted || []).filter(a => a.status === 'skipped').slice(0, 6).map(a => `<li class="subtle">Skipped ${esc(a.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70))} — ${esc(a.reason || '')}</li>`).join('')}</ul></div>
    <div class="form-group"><label for="research-notes">Reviewer note <span class="optional">(optional, audited)</span></label><input class="form-control" id="research-notes" maxlength="600" value="${esc(brief.reviewNotes || '')}" placeholder="e.g. Verified against 2024 integrated report; excluded dated programme." /></div>
    ${brief.reviewedAt ? `<p class="subtle">Last reviewed ${isoDate(brief.reviewedAt)} by ${esc(brief.reviewedBy || 'staff')} · ${esc(brief.status)}</p>` : ''}
  </div>`;
  const footer = `<div class="modal-footer-left"><button type="button" class="button button-secondary button-small" data-action="research-run" data-id="${esc(lead.id)}" ${state.researchBusy ? 'disabled' : ''}>${svgIcon('globe')} ${state.researchBusy ? 'Researching…' : 'Re-run'}</button><button type="button" class="button button-secondary button-small" data-action="research-clear" data-id="${esc(lead.id)}">${svgIcon('trash')}Remove</button></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="research-back">${svgIcon('back')}Back</button><button type="button" class="button button-secondary" data-action="research-reject" data-id="${esc(lead.id)}">${svgIcon('xCircle')}Reject brief</button><button type="button" class="button button-primary" data-action="research-approve" data-id="${esc(lead.id)}">${svgIcon('check')} Approve selected &amp; use</button></div>`;
  return modalFrame(`Funder brief · ${lead.company}`, status.label, body, footer, true, 'modal-wide');
}

// =====================================================================
// Outreach Workbench — one screen: add/discover → verify → research → match → draft → review & send → track
// =====================================================================
// What a person sees: three states (plus Stopped). The engine's precise status stays on hover and in Health.
const WB_FILTERS = [['all', 'All'], ['your-turn', 'Your turn'], ['working', 'Working'], ['waiting', 'Waiting on them'], ['stopped', 'Stopped']];
const SIMPLE_OF = { supporter: 'waiting', pledged: 'your-turn', vet: 'your-turn', vetted: 'waiting', call: 'your-turn', 'call-booked': 'waiting', replied: 'your-turn', 'needs-review': 'your-turn', ready: 'your-turn', approved: 'your-turn', blocked: 'your-turn', error: 'your-turn', new: 'your-turn', running: 'working', queued: 'working', sequence: 'working', sent: 'waiting', dead: 'stopped' };
const SIMPLE_META = { 'your-turn': ['Your turn', 'pill-interested'], working: ['Working', 'pill-researched'], waiting: ['Waiting on them', 'pill-new'], stopped: ['Stopped', 'pill-not-proceeding'] };
// One line that says what "your turn" means for this funder.
const NEXT_STEP = { vet: 'New supplier — check the company and references, then approve or reject', vetted: 'Approved — gets needs in their trades and provinces', call: 'No published email — phone the school; the script is on the card', 'call-booked': 'Call booked — capture the needs when you speak to the principal', replied: 'They replied — read it in the Inbox', 'needs-review': 'Check what we found about them', ready: 'Read the email and send it', approved: 'Approved — press Send', blocked: 'Something is missing — open to see what', error: 'The last step failed — open to see the reason and try again', new: 'Not started yet — press Run', running: 'Chelo is checking, researching and drafting', queued: 'Email is scheduled — sends in the next free slot', sequence: 'Sent — Chelo will follow up if they go quiet', sent: 'Sent — waiting for a reply', dead: 'Email address does not work' };
function simpleStatusOf(lead) { return SIMPLE_OF[wbStatusOf(lead)] || 'your-turn'; }
function nextStepOf(lead) { return NEXT_STEP[wbStatusOf(lead)] || ''; }
function approvalItems() {
  const items = [];
  for (const l of state.data.leads) {
    if (l.doNotContact) continue;
    const seq = l.sequence;
    if (seq && seq.status === 'pending-approval') items.push({ kind: 'countersign-plan', lead: l, at: seq.approval?.firstApprovedAt || l.updatedAt });
    else if (seq && seq.status === 'draft') items.push({ kind: 'plan', lead: l, at: seq.builtAt || l.updatedAt });
    else if (l.emailStatus === 'Pending second approval') items.push({ kind: 'countersign-email', lead: l, at: l.updatedAt });
    else if (l.emailDraft && ['Draft', 'None', undefined, ''].includes(l.emailStatus) && !seq) items.push({ kind: 'draft', lead: l, at: l.emailDraft.generatedAt || l.updatedAt });
    else if (l.research && l.research.status === 'pending-review') items.push({ kind: 'research', lead: l, at: l.research.fetchedAt || l.updatedAt });
  }
  for (const b of state.data.bookings.filter(b => b.status === 'Requested')) { const lead = state.data.leads.find(l => l.id === b.leadId); if (lead) items.push({ kind: 'booking', lead, booking: b, at: b.createdAt }); }
  return items.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
}
const APPROVAL_KIND_META = { 'countersign-plan': ['Needs a second person to approve', 'shield', 'tone-warn'], plan: ['Email ready — read and send', 'send', 'tone-info'], 'countersign-email': ['Needs a second person to approve', 'shield', 'tone-warn'], draft: ['Email ready — read and send', 'mail', 'tone-info'], research: ['Check what we found about them', 'search', 'tone-info'], booking: ['Confirm a briefing time', 'calendar', 'tone-info'] };
function wbStatusOf(lead) {
  if (lead.flowStatus) return lead.flowStatus;
  const f = lead.flow; if (!f) return 'new';
  if (['running', 'dead', 'error', 'blocked'].includes(f.status)) return f.status;
  if (lead.triage && !lead.triage.handled) return 'replied';
  if (lead.sequence && lead.sequence.status === 'running') return 'sequence';
  if (lead.emailStatus === 'Sent') return 'sent';
  if (lead.emailStatus === 'Queued') return 'queued';
  if (String(lead.emailStatus || '').startsWith('Failed')) return 'blocked';
  if (lead.emailStatus === 'Approved') return 'approved';
  if (lead.research && lead.research.status === 'pending-review') return 'needs-review';
  if (lead.emailDraft) return 'ready';
  return f.status || 'new';
}
const WB_STATUS_META = { supporter: ['Supporter', 'pill-new'], pledged: ['Pledge to confirm', 'pill-interested'], vet: ['Vetting needed', 'pill-interested'], vetted: ['Approved supplier', 'pill-won'], call: ['Call the school', 'pill-interested'], 'call-booked': ['Principal call booked', 'pill-won'], replied: ['Replied — triage', 'pill-interested'], sequence: ['Sequence running', 'pill-researched'], queued: ['Queued to send', 'pill-researched'], new: ['Not started', 'pill-new'], running: ['Working…', 'pill-pending'], 'needs-review': ['Review research', 'pill-interested'], ready: ['Ready to send', 'pill-researched'], approved: ['Approved', 'pill-won'], sent: ['Sent', 'pill-won'], blocked: ['Needs input', 'pill-pending'], dead: ['Dead email', 'pill-not-proceeding'], error: ['Error', 'pill-not-proceeding'] };
function wbPill(status) { const simple = SIMPLE_OF[status] || 'your-turn'; const [label, cls] = SIMPLE_META[simple]; const [detail] = WB_STATUS_META[status] || [status]; return `<span class="stage-pill ${cls}" title="${esc(detail)}">${esc(label)}</span>`; }
function wbSelected() { return getLead(state.wb.selectedId) || null; }

function workbenchView() {
  const leads = state.data.leads.filter(l => !l.isDemo || state.auth.demoAccess || true);
  const counts = leads.reduce((acc, l) => { const s = simpleStatusOf(l); acc[s] = (acc[s] || 0) + 1; acc.all += 1; return acc; }, { all: 0 });
  const q = state.query.trim().toLowerCase();
  const visible = leads.filter(l => (state.wb.filter === 'all' ? simpleStatusOf(l) !== 'stopped' : simpleStatusOf(l) === state.wb.filter) && (!q || `${l.company} ${l.contactName} ${l.email} ${l.project || ''}`.toLowerCase().includes(q)));
  if (state.wb.sort === 'fit') visible.sort((a, b) => (b.fit?.score || 0) - (a.fit?.score || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  if (!state.wb.selectedId && visible.length) state.wb.selectedId = visible[0].id;
  const selected = wbSelected();
  return `${pageHead('To do', 'To do', deskMeta().todoBlurb || 'Funders that need you. Chelo checks the email address, researches them and writes the first draft — you read it and press Send.', onSchools() ? '' : onSuppliers() ? deskAddButton() : `<button type="button" class="button button-secondary" data-action="wb-intake" data-intake="pool">${svgIcon('upload')}Import CSV</button><button type="button" class="button button-primary" data-action="wb-focus-add">${svgIcon('plus')}${esc(deskWord('addLabel'))}</button>`)}
  ${wbIntakeBar()}
  <div class="wb-layout">
    <section class="panel wb-list-panel">
      <div class="wb-filters" role="tablist">${WB_FILTERS.map(([key, label]) => `<button type="button" class="wb-filter ${state.wb.filter === key ? 'is-active' : ''}" data-action="wb-filter" data-filter="${key}" role="tab">${esc(label)}<span class="wb-filter-count">${counts[key] || 0}</span></button>`).join('')}</div>
      <div class="wb-sort"><span class="subtle">Order by</span><button type="button" class="wb-sort-btn ${state.wb.sort === 'fit' ? 'is-active' : ''}" data-action="wb-sort" data-sort="fit" title="Sector × province × SED × approach window × warmth">${svgIcon('target')}Fit & timing</button><button type="button" class="wb-sort-btn ${state.wb.sort === 'recent' ? 'is-active' : ''}" data-action="wb-sort" data-sort="recent">${svgIcon('clock')}Recent</button></div>
      <div class="wb-list">${visible.length ? visible.map(l => wbRow(l, selected && selected.id === l.id)).join('') : `<div class="empty-state"><div class="empty-state-icon">${svgIcon('discover')}</div><p>No leads here yet. Add one above, import a CSV or discover organisations on the web.</p></div>`}</div>
    </section>
    <section class="wb-detail">${selected ? wbStepper(selected) : `<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('target')}</div><p>Select a lead to work on it.</p></div>`}</section>
  </div>`;
}
/** v66: the media-kit block was easy to miss on each card. One banner, one button, and pitches restart on approval. */
function mediaKitBanner() {
  const kit = state.data.mediaKit; if (kit && kit.status === 'approved' && kit.boilerplate) return '';
  const isAdmin = state.auth.role === 'admin' || state.auth.isRoot || state.auth.demoAccess;
  const written = Boolean(kit && kit.boilerplate);
  return `<section class="panel wb-kit-banner"><div><strong>${svgIcon('bell')} Pitches are on hold: ${written ? 'the media kit is written but not approved.' : 'there is no media kit yet.'}</strong>
    <p class="subtle">Every pitch quotes the kit (one paragraph about Chelo, the facts journalists may use, the spokesperson). ${written ? 'An administrator approves it once; every waiting pitch is then written automatically.' : 'Write it once under Settings → Media kit; approve it; every waiting pitch is then written automatically.'}</p></div>
    <div class="wb-step-actions">${written && isAdmin ? `<button type="button" class="button button-primary" data-action="media-kit-approve">${svgIcon('checkCircle')}Approve the media kit now</button>` : ''}<button type="button" class="button ${written && isAdmin ? 'button-secondary' : 'button-primary'}" data-action="open-media-kit">${svgIcon('globe')}${written ? 'Open media kit' : 'Write the media kit'}</button></div></section>`;
}
function wbIntakeBar() {
  if (onSchools()) return schoolsIntakeBar();
  if (onSuppliers()) return suppliersIntakeBar();
  const d = state.wb.discovery;
  const intake = state.wb.intake === 'pool' ? 'pool' : 'add';
  const kitBanner = onMarketing() ? mediaKitBanner() : onSupporters() ? supportersBanner() : '';
  const poolCount = state.data.candidates.filter(c => c.status === 'New candidate').length;
  const tabs = `${kitBanner}<div class="wb-intake-tabs" role="tablist"><button type="button" role="tab" class="wb-intake-tab ${intake === 'add' ? 'is-active' : ''}" data-action="wb-intake" data-intake="add" aria-selected="${intake === 'add'}">${svgIcon('plus')} Add or discover</button><button type="button" role="tab" class="wb-intake-tab ${intake === 'pool' ? 'is-active' : ''}" data-action="wb-intake" data-intake="pool" aria-selected="${intake === 'pool'}">${svgIcon('database')} Local pool & CSV${poolCount ? ` <span class="wb-count">${poolCount}</span>` : ''}</button></div>`;
  if (intake === 'pool') { loadCatalogue(); return `<section class="panel wb-intake">${tabs}${discoverPanel()}<input type="file" id="candidate-csv" accept=".csv,text/csv" hidden /></section>`; }
  return `<section class="panel wb-intake">${tabs}
    <form class="wb-add-form" data-form="wb-add" id="wb-add-form">
      <div class="wb-add-fields">
        <input class="form-control" name="company" placeholder="Organisation" required autocomplete="organization" />
        <input class="form-control" name="contactName" placeholder="Contact name" autocomplete="off" />
        <input class="form-control" name="email" type="email" placeholder="Work email (public page or your records)" />
        <input class="form-control" name="sourceUrl" placeholder="Source URL / website" />
      </div>
      <button type="submit" class="button button-primary" ${state.wb.busy.add ? 'disabled' : ''}>${svgIcon('spark')}${state.wb.busy.add ? 'Adding & running…' : 'Add & run'}</button>
    </form>
    <div class="wb-discover">
      <label class="wb-discover-input">${svgIcon('globe')}<input id="wb-discover-q" class="form-control" placeholder="${onMarketing() ? 'Find outlets — e.g. “education news South Africa” or “Limpopo community newspapers”' : onSupporters() ? 'Find NGOs — e.g. “literacy NGOs in Limpopo schools” or “school feeding non-profits KZN”' : 'Discover on the web — e.g. “JSE mining companies with education CSI”'}" value="${esc(d.query)}" /></label>
      <button type="button" class="button button-secondary" data-action="wb-discover" ${d.busy ? 'disabled' : ''}>${svgIcon('search')}${d.busy ? 'Searching…' : 'Discover'}</button>
    </div>
    ${d.busy ? '<p class="subtle">Searching, then checking each organisation\'s website and mail server for a working mailbox — up to a minute.</p>' : ''}
    ${!d.busy && d.query && !d.error && !d.results.length && !(d.withoutEmail || []).length && d.read ? '<p class="subtle">Nothing found for that search. Try other words.</p>' : ''}
    ${d.error ? `<p class="form-error">${esc(d.error)}</p>` : ''}
    ${d.read && !d.busy ? `<p class="subtle wb-discover-read">${d.read.aiOn ? `Read ${d.read.articles} article${d.read.articles === 1 ? '' : 's'}${d.read.named?.length ? ` → funders named inside: <strong>${d.read.named.map(esc).join(', ')}</strong> (shown above)` : d.read.articles ? ' → none named a funder that gives' : ''}.` : 'AI key not set — article reading is off, so funders named inside news stories are not pulled out.'}${d.read.articleTitles?.length ? ` Articles: ${d.read.articleTitles.map(a => `<a class="source-link" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.outlet || a.title)}</a>`).join(', ')}.` : ''}${(d.warnings || []).filter(w => !/AI key not set/.test(w)).length && d.results.length ? ` ${esc((d.warnings || []).filter(w => !/AI key not set/.test(w)).join(' '))}` : ''}</p>` : ''}
    ${d.results.length ? `<div class="wb-discover-results">${d.results.map(o => `<article class="wb-org ${o.alreadyTracked ? 'is-tracked' : ''}"><div class="wb-org-copy"><strong>${esc(o.name)}</strong>${o.website ? `<a class="source-link" href="${esc(o.website)}" target="_blank" rel="noopener noreferrer">${svgIcon('external')}${esc(o.domain)}</a>` : `<span class="subtle">website not found yet — add it after you add the ${esc(deskMeta().targetSingular || 'funder')}</span>`}<p>${esc(o.summary || 'No public summary captured.')}</p><small class="wb-org-meta">${o.mailbox?.email ? `${svgIcon('mail')} ${esc(o.mailbox.email)}` : o.website ? `${svgIcon('mail')} ${o.mailbox?.status === 'none' ? 'no published mailbox' : 'mailbox: checked when you press Run'}` : ''}${(o.articles || []).length ? ` · ${svgIcon('globe')} <a class="source-link" href="${esc(o.articles[0].url)}" target="_blank" rel="noopener noreferrer">${esc(o.articles[0].outlet || 'article')}${o.articles[0].publishedAt ? ` · ${esc(o.articles[0].publishedAt.slice(0, 7))}` : ''}</a>` : ''}</small></div>${o.alreadyTracked ? (o.tracked?.visible ? `<button type="button" class="button button-small button-ghost" data-action="wb-discover-open" data-id="${esc(o.tracked.id)}" data-hidden="${o.tracked.hidden ? '1' : ''}" title="${esc(o.tracked.hidden ? 'In Chelo but parked (no mailbox yet). Open moves it into To do.' : `Already in To do as ${o.tracked.company}`)}">${svgIcon('eye')}${o.tracked.hidden ? 'Parked · Open' : 'In To do · Open'}</button>` : `<span class="subtle" title="Another person owns this funder.">Already in Chelo — ask an admin to share it</span>`) : `<button type="button" class="button button-small button-secondary" data-action="wb-discover-add" data-domain="${esc(o.domain || o.name)}">${svgIcon('plus')}Add</button>`}</article>`).join('')}<p class="subtle">Only organisations with a working generic mailbox are shown (published on their site, or a standard address their mail server confirmed). Never a person's email (POPIA).</p></div>` : ''}
    ${d.withoutEmail?.length ? `<details class="subtle wb-discover-dropped"><summary>${d.withoutEmail.length} left out — no mailbox found${d.results.length ? '' : ' (that is everything this search turned up)'}</summary><ul class="wb-need-list">${d.withoutEmail.map(o => `<li>${o.website ? `<a class="source-link" href="${esc(o.website)}" target="_blank" rel="noopener noreferrer">${esc(o.name)}</a>` : esc(o.name)} <small>· ${esc(o.status === 'none-published' ? 'nothing published' : o.status === 'unreachable' ? 'site unreachable in time' : o.status === 'unconfirmed' ? 'addresses found but none confirmed' : o.status)}</small></li>`).join('')}</ul><p>Found their address yourself? Add the organisation by hand with that email.</p></details>` : ''}
  </section>`;
}
function wbRow(l, active) {
  const s = wbStatusOf(l);
  return `<button type="button" class="wb-row ${active ? 'is-active' : ''} wb-row-${s}" data-action="wb-select" data-id="${esc(l.id)}">
    <span class="wb-row-avatar">${initials(l.company)}</span>
    <span class="wb-row-copy"><strong>${esc(l.company)}</strong><small>${esc(l.contactName || 'No contact yet')}${l.project ? ` · ${esc(l.project)}` : ''}${state.data.canSeeAll && l.access?.ownerName && String(l.access.ownerId) !== String(state.auth.userId || '') ? ` · ${esc(l.access.ownerName)}` : ''}</small></span>
    <span class="wb-row-status">${orgPill(l.orgCheck)}${fitPill(l.fit)}${wbPill(s)}${s === 'running' ? '<span class="wb-spinner" aria-hidden="true"></span>' : ''}</span>
  </button>`;
}
function wbStepState(lead, name) { return lead.flow?.steps?.[name] || null; }
function wbStepTone(status) {
  if (!status) return 'idle';
  if (['verified', 'approved', 'drafted', 'set', 'suggested', 'sent', 'accepted'].includes(status)) return 'done';
  if (['running'].includes(status)) return 'running';
  if (['dead', 'error'].includes(status)) return 'bad';
  return 'attention';
}
function wbStep(index, title, status, detail, body, { open = false } = {}) {
  const tone = wbStepTone(status);
  return `<details class="wb-step wb-step-${tone}" ${open ? 'open' : ''}>
    <summary><span class="wb-step-index">${tone === 'done' ? svgIcon('check') : tone === 'bad' ? svgIcon('xCircle') : tone === 'running' ? '<span class="wb-spinner"></span>' : index}</span><span class="wb-step-title">${esc(title)}</span><span class="wb-step-detail">${esc(detail || '')}</span></summary>
    <div class="wb-step-body">${body}</div>
  </details>`;
}
function wbStepper(lead) { return wbLeadPage(lead); }
// ---------------------------------------------------------------------
// Simplify R2 — the funder page is three cards: Who they are · What we'll send · one button.
// The engine still runs verify → research → match → draft → follow-ups underneath; this page only shows what a person needs.
// ---------------------------------------------------------------------
function wbCard(icon, title, body, { aside = '', cls = '' } = {}) {
  return `<section class="wb-card ${cls}"><header class="wb-card-head"><h3>${svgIcon(icon)}${esc(title)}</h3>${aside}</header><div class="wb-card-body">${body}</div></section>`;
}
function wbFixButtons(lead, s, busy) {
  const b = [];
  b.push(`<button type="button" class="button button-secondary button-small" data-action="wb-verify" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('checkCircle')}Check the email address again</button>`);
  b.push(`<button type="button" class="button button-ghost button-small" data-action="wb-waterfall" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('users')}Find a public contact</button>`);
  b.push(`<button type="button" class="button button-ghost button-small" data-action="wb-mailbox" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('mail')}Find their published mailbox</button>`);
  if (s === 'dead') b.push(`<button type="button" class="button button-danger button-small" data-action="wb-delete" data-id="${esc(lead.id)}">${svgIcon('trash')}Remove this funder</button>`);
  return `<div class="wb-step-actions">${b.join('')}</div>`;
}
function wbWhoCard(lead, s, busy) {
  const brief = lead.research; const projects = state.data.projects || [];
  const mailbox = lead.mailboxCheck; const verify = wbStepState(lead, 'verify'); const researchStep = wbStepState(lead, 'research');
  const projectPick = `<label class="form-group wb-project-pick"><span>Project we'll show them</span>
      <select class="form-control" data-wb-project="${esc(lead.id)}"><option value="">— choose a project —</option>${projects.map(p => `<option value="${esc(p.id)}" ${lead.projectId === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.province || '')}${brief?.suggestedProjectId === p.id ? ' (Chelo suggests this one)' : ''}</option>`).join('')}</select></label>`;
  if (!brief) {
    const blocked = ['blocked', 'dead', 'error'].includes(s);
    const why = blocked ? (lead.flow?.error || mailbox?.reason || verify?.detail || 'Something is missing.') : s === 'running' ? 'Chelo is checking the email address and reading their public pages.' : (researchStep?.detail || 'Chelo reads their public pages as soon as the email address checks out.');
    const facts = [['Email address', lead.email || 'none yet'], ['Does it work?', mailbox?.status ? esc(mailbox.status) : 'not checked yet']];
    return wbCard('search', 'Who they are', `<p class="${blocked ? 'form-error' : 'subtle'}">${esc(why)}</p>
      <dl class="wb-facts-kv">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${blocked ? wbFixButtons(lead, s, busy) : ''}
      ${lead.mailboxSearch ? wbMailboxPanel(lead) : ''}${lead.contactLeads ? wbWaterfallPanel(lead) : ''}
      ${projectPick}`, { aside: s === 'running' ? '<span class="wb-spinner" aria-hidden="true"></span>' : '' });
  }
  const approved = brief.status === 'approved';
  const tick = (name, item, on, extra = '') => `<label class="check-row wb-fact"><input type="checkbox" name="${name}" value="${esc(item.id)}" ${on ? 'checked' : ''} ${item.kind === 'news_giving' && !item.fresh ? 'disabled' : ''} /> <span>${esc(item.text)}${extra}</span></label>`;
  const newsTag = f => f.kind === 'news_giving' ? ` <small class="subtle">— in the news${f.publishedAt ? ` ${esc(f.publishedAt.slice(0, 7))}` : ''}${f.fresh ? '' : ' · older than 12 months, kept for context, not used in emails'}</small>` : '';
  const findings = (brief.findings || []).slice(0, 4).map(f => tick('finding', f, f.kind === 'news_giving' && !f.fresh ? false : approved ? (brief.approvedFindingIds || []).includes(f.id) : true, newsTag(f)));
  const align = (brief.alignmentPoints || []).slice(0, 2).map(a => tick('alignment', a, approved ? (brief.approvedAlignmentIds || []).includes(a.id) : true));
  const contacts = (brief.contacts || []).slice(0, 2).map(c => tick('contact', { id: c.id, text: `${c.name} — ${c.title || 'public CSI contact'}` }, (brief.approvedContactIds || []).includes(c.id)));
  const sources = (brief.sources || []).slice(0, 3);
  const body = `<div id="research-review" class="wb-research">
      ${brief.missionSummary ? `<p class="wb-mission">${esc(brief.missionSummary)}</p>` : ''}
      <p class="subtle">Untick anything that looks wrong. Only ticked facts go into the email.</p>
      <div class="wb-facts">${[...findings, ...align, ...contacts].join('') || '<p class="subtle">Chelo could not find solid facts. Add their website under Edit details and press Look again.</p>'}</div>
      ${sources.length ? `<p class="wb-sources-line"><span class="subtle">Where this came from:</span> ${sources.map(src => `<a class="source-link" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${svgIcon('external')}${esc((src.title || src.url).slice(0, 48))}</a>`).join(' ')}</p>` : ''}
      <input type="hidden" id="research-mission" value="${esc(brief.missionSummary || '')}" /><input type="hidden" id="research-notes" value="" />
      ${projectPick}
      <div class="wb-step-actions">
        ${approved ? `<span class="stage-pill pill-won">${svgIcon('check')}Checked ${isoDate(brief.reviewedAt)}</span><button type="button" class="button button-secondary button-small" data-action="research-approve" data-id="${esc(lead.id)}">${svgIcon('checkCircle')}Save changes</button>` : `<button type="button" class="button button-primary button-small" data-action="research-approve" data-id="${esc(lead.id)}">${svgIcon('checkCircle')}Looks right — write the email</button>`}
        <button type="button" class="button button-ghost button-small" data-action="wb-run" data-force="true" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('refresh')}Look again</button>
        ${approved ? '' : `<button type="button" class="button button-ghost button-small" data-action="research-reject" data-id="${esc(lead.id)}">${svgIcon('xCircle')}Not useful</button>`}
      </div>
    </div>`;
  return wbCard('search', 'Who they are', body);
}
function wbSendCard(lead, s, busy) {
  const d = lead.emailDraft; const emailStatus = lead.emailStatus || 'None'; const seq = lead.sequence;
  if (!d) return wbCard('mail', "What we'll send", `<p class="subtle">${esc(s === 'running' ? 'Chelo is writing the first email.' : lead.research && lead.research.status === 'pending-review' ? 'Tick the facts above and Chelo writes the email.' : 'Chelo writes the first email once the facts are checked and a project is chosen.')}</p>`);
  const locked = emailStatus === 'Sent' || (seq && ['running', 'completed', 'approved', 'pending-approval'].includes(seq.status)) || emailStatus === 'Queued';
  const followUps = seq ? seq.steps.filter(st => st.n > 1 && !['skipped', 'cancelled'].includes(st.status)).length : isMediaLead(lead) ? 2 : 3;
  const body = `<div class="wb-send-meta"><div class="sp-row"><span>To</span><strong>${esc(lead.contactName || '')} &lt;${esc(lead.email || 'no email yet')}&gt;</strong></div>
      ${isMediaLead(lead) ? '' : `<div class="sp-row"><span>Attached</span><strong>${svgIcon('paperclip')}Chelo proposal PDF${lead.proposalFile ? '' : ' <small class="subtle">(made when you press Send)</small>'}</strong></div>`}</div>
    <label class="form-group"><span>Subject</span><input id="email-subject" class="form-control" value="${esc(d.subject || '')}" ${locked ? 'readonly' : ''} /></label>
    <label class="form-group"><span>Email</span><textarea id="email-body" class="form-control wb-email-body" rows="10" ${locked ? 'readonly' : ''}>${esc(d.body || '')}</textarea></label>
    <p class="subtle wb-followup-note">${svgIcon('clock')}If they don't reply, Chelo sends ${followUps} short follow-up${followUps === 1 ? '' : 's'} in the same thread over about two weeks and stops the moment they answer. You can stop it any time.</p>
    ${lead.emailDraft?.opening ? `<p class="subtle wb-opening-note">Opening: ${esc(OPENING_LABELS[lead.emailDraft.opening] || lead.emailDraft.opening)}. Each rewrite tries a different way in.</p>` : ''}
    ${locked ? '' : `<div class="wb-step-actions"><button type="button" class="button button-secondary button-small" data-action="email-save-draft" data-id="${esc(lead.id)}">${svgIcon('save')}Save changes</button><button type="button" class="button button-ghost button-small" data-action="wb-redraft" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('wand')}Rewrite differently</button>${lead.proposalFile ? `<a class="button button-ghost button-small" href="/api/leads/${encodeURIComponent(lead.id)}/proposal/preview" target="_blank" rel="noopener">${svgIcon('proposals')}Open the PDF</a>` : ''}</div>`}
    ${seq && seq.status !== 'draft' ? wbSequencePanel(lead) : ''}`;
  return wbCard('mail', "What we'll send", body);
}

/** "Sends at 09:44 — Send now" for an email waiting in the queue; outside the window it says when the window opens. */
function wbSendSlot(lead, { small = false } = {}) {
  const slot = lead.sendSlot; if (!slot) return '';
  const when = new Date(slot.at); const today = new Date().toDateString() === when.toDateString();
  const t = when.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  const label = slot.kind === 'follow-up' ? 'Follow-up' : 'Email';
  if (!slot.windowOpen) {
    const open = slot.nextOpen ? new Date(slot.nextOpen) : null;
    return `<span class="wb-send-slot subtle">${svgIcon('clock')}${label} waits for the sending window — ${open ? `goes ${open.toLocaleDateString('en-ZA', { weekday: 'short' })} ${open.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : `opens ${slot.windowStart} on a weekday`} (${slot.windowStart}–${slot.windowEnd} ${slot.timezone.replace('Africa/', '')}).</span>`;
  }
  return `<span class="wb-send-slot"><span class="subtle">${svgIcon('clock')}${label} ${slot.due ? 'is due now' : `sends at ${today ? t : `${when.toLocaleDateString('en-ZA', { weekday: 'short' })} ${t}`}`}</span><button type="button" class="button button-secondary ${small ? 'button-small' : ''}" data-action="wb-send-now" data-id="${esc(lead.id)}">${svgIcon('send')}Send now</button></span>`;
}
function wbActionCard(lead, s, busy) {
  const d = lead.emailDraft; const emailStatus = lead.emailStatus || 'None'; const seq = lead.sequence;
  const booking = (state.data.bookings || []).find(b => b.leadId === lead.id);
  let primary = ''; let note = nextStepOf(lead);
  const id = esc(lead.id);
  if (lead.doNotContact) { primary = `<span class="stage-pill pill-not-proceeding">${svgIcon('ban')}Do not contact</span>`; note = 'They asked us not to write to them.'; }
  else if (lead.triage && !lead.triage.handled) { primary = `<button type="button" class="button button-primary" data-action="ix-open-lead" data-lead="${id}">${svgIcon('reply')}Read their reply in the Inbox</button>`; }
  else if (s === 'running') { primary = `<span class="stage-pill pill-pending"><span class="wb-spinner"></span>Chelo is working</span>`; }
  else if (s === 'vet') { primary = `<span class="stage-pill pill-interested">${svgIcon('shield')}Vet below</span>`; }
  else if (s === 'vetted') { primary = `<span class="stage-pill pill-won">${svgIcon('check')}Approved supplier</span>`; }
  else if (s === 'call') { primary = `<a class="button button-primary" href="tel:${esc(lead.phone || '')}">${svgIcon('phone')}Call ${esc(lead.phone || '')}</a>`; }
  else if (s === 'call-booked') { primary = `<span class="stage-pill pill-won">${svgIcon('calendar')}Call booked${lead.callTask?.bookedAt ? ` · ${esc(lead.callTask.bookedAt)}` : ''}</span>`; }
  else if (['new', 'blocked', 'error', 'dead'].includes(s) || !d) {
    if (lead.research && lead.research.status === 'pending-review') { primary = `<button type="button" class="button button-primary" data-action="research-approve" data-id="${id}">${svgIcon('checkCircle')}Looks right — write the email</button>`; }
    else primary = `<button type="button" class="button button-primary" data-action="wb-run" data-id="${id}" ${busy ? 'disabled' : ''}>${svgIcon('spark')}${s === 'new' ? 'Start' : 'Try again'}</button>`;
  }
  else if (seq && seq.status === 'pending-approval') { primary = `<button type="button" class="button button-primary" data-action="seq-countersign" data-id="${id}">${svgIcon('shield')}Approve as second person & send</button>`; note = 'A teammate approved it. A second person must approve before it goes.'; }
  else if (seq && seq.status === 'running') { primary = `${wbSendSlot(lead)}<button type="button" class="button button-danger" data-action="seq-stop" data-id="${id}">${svgIcon('xCircle')}Stop follow-ups</button>`; note = wbSequenceStepDetail(lead, emailStatus); }
  else if (seq && seq.status === 'completed') { note = 'All emails sent. No reply yet.'; }
  else if (emailStatus === 'Queued') { primary = `${wbSendSlot(lead)}<button type="button" class="button button-ghost" data-action="dlv-cancel-job" data-id="${esc(lead.sendJobId || '')}" data-return-view="workbench">${svgIcon('xCircle')}Cancel</button>`; }
  else if (emailStatus === 'Pending second approval') { primary = `<button type="button" class="button button-primary" data-action="email-countersign" data-id="${id}">${svgIcon('shield')}Approve as second person & send</button>`; }
  else if (emailStatus === 'Approved') { primary = `<button type="button" class="button button-primary" data-action="send-smtp" data-id="${id}">${svgIcon('send')}Send now</button>`; }
  else if (emailStatus === 'Sent' && !(seq && ['running', 'approved'].includes(seq.status))) { primary = `<button type="button" class="button button-secondary" data-action="follow-up" data-id="${id}">${svgIcon('send')}Write a follow-up</button>`; note = 'Sent. Waiting for a reply.'; }
  else { primary = `<button type="button" class="button button-primary" data-action="wb-send-all" data-id="${id}" ${busy ? 'disabled' : ''}>${svgIcon('eye')}Read & send</button>`; note = 'You see exactly what they get before anything is sent.'; }
  const secondary = [];
  if (emailStatus === 'Sent' && !(seq && seq.status === 'running')) secondary.push(`<button type="button" class="button button-ghost button-small" data-action="mark-replied" data-id="${id}">${svgIcon('reply')}They replied by phone/elsewhere</button>`);
  if (lead.stage !== 'Won') { if (!isMediaLead(lead)) secondary.push(`<button type="button" class="button button-ghost button-small" data-action="mark-won" data-id="${id}">${svgIcon('trophy')}They said yes → Partners</button>`); } else secondary.push(`<span class="stage-pill pill-won">${svgIcon('trophy')}${isMediaLead(lead) ? 'Done' : 'Partner'}</span>`);
  if (!lead.doNotContact) secondary.push(`<button type="button" class="button button-ghost button-small" data-action="opt-out" data-id="${id}">${svgIcon('ban')}Do not contact</button>`);
  const facts = [emailStatus === 'Sent' || seq ? `Sent ${lead.sentAt ? isoDate(lead.sentAt) : ''}`.trim() : '', lead.openCount ? `Opened ${lead.openCount}×` : '', lead.repliedAt ? `Replied ${isoDate(lead.repliedAt)}` : '', booking ? `Briefing ${booking.status.toLowerCase()}` : ''].filter(Boolean);
  const wait = wbReplyPointer(lead);
  return `<section class="wb-card wb-action-card"><div class="wb-action-main"><div><strong>${esc(SIMPLE_META[simpleStatusOf(lead)][0])}</strong><p class="subtle">${esc(note)}</p>${facts.length ? `<p class="subtle wb-action-facts">${facts.map(esc).join(' · ')}</p>` : ''}</div>${primary}</div>${wait}<div class="wb-action-secondary">${secondary.join('')}</div></section>`;
}
// ---------------- Private workspaces (v56): who can see this funder ----------------
const OPENING_LABELS = { figure: 'a number', question: 'a question', priority: 'their stated priority', story: 'one beneficiary', ask: 'the ask itself' };
function wbAccessLine(lead) {
  const a = lead.access; if (!a) return '';
  const me = String(state.auth.userId || '');
  const people = [a.ownerName ? `${a.ownerId === me ? 'You' : a.ownerName} (owner)` : 'No owner yet', ...a.sharedWith.map(u => (String(u.id) === me ? 'you' : u.displayName)), ...a.projectTeam.map(u => `${String(u.id) === me ? 'you' : u.displayName} (project team)`)];
  const seen = new Set(); const names = people.filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const btn = a.canManage ? `<button type="button" class="button button-ghost button-small" data-action="lead-share-open" data-id="${esc(lead.id)}">${svgIcon('users')}Share with…</button>` : '';
  return `<p class="wb-access subtle">${svgIcon('users')} Who can see this: ${esc(names.join(', '))}${state.data.canSeeAll ? ' · admins see everything' : ''} ${btn}</p>`;
}
function leadShareModal(lead) {
  if (!lead || !lead.access) return '';
  const a = lead.access; const me = String(state.auth.userId || '');
  const dir = (state.data.directory || []).filter(u => String(u.id) !== String(a.ownerId));
  const onTeam = new Set(a.projectTeam.map(u => String(u.id))); const shared = new Set(a.sharedWith.map(u => String(u.id)));
  const rows = dir.map(u => `<label class="share-row"><input type="checkbox" name="share" value="${esc(u.id)}" ${shared.has(String(u.id)) ? 'checked' : ''} ${onTeam.has(String(u.id)) ? 'disabled' : ''} /> <span>${esc(u.displayName)}${String(u.id) === me ? ' (you)' : ''}${onTeam.has(String(u.id)) ? ' <small class="subtle">— already on the project team</small>' : u.role === 'admin' ? ' <small class="subtle">— admin, sees everything</small>' : ''}</span></label>`).join('') || '<p class="subtle">No other staff yet. Add people under Settings → Staff.</p>';
  const ownerPick = state.data.canSeeAll ? `<div class="form-group" style="margin-top:14px"><label for="share-owner">Owner (admins only)</label><select class="form-control" id="share-owner" name="owner">${(state.data.directory || []).map(u => `<option value="${esc(u.id)}" ${String(u.id) === String(a.ownerId) ? 'selected' : ''}>${esc(u.displayName)}</option>`).join('')}</select><small class="subtle">Changing the owner hands the funder over. The old owner loses access unless you also tick them above.</small></div>` : '';
  const body = `<form id="lead-share-form" data-form="lead-share" data-id="${esc(lead.id)}"><p class="subtle">People you tick can open ${esc(lead.company)}, read the research, see the emails and replies, and work it with you.</p><div class="share-list">${rows}</div>${ownerPick}</form>`;
  const footer = `<button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" form="lead-share-form" class="button button-primary">Save</button>`;
  return modalFrame('Share this funder', `Owner: ${a.ownerName || '—'}`, body, footer, true);
}
function projectTeamModal(p) {
  if (!p) return '';
  const team = new Set((p.team || []).map(String));
  const rows = (state.data.directory || []).map(u => `<label class="share-row"><input type="checkbox" name="team" value="${esc(u.id)}" ${team.has(String(u.id)) ? 'checked' : ''} /> <span>${esc(u.displayName)}${u.role === 'admin' ? ' <small class="subtle">— admin, sees everything</small>' : ''}</span></label>`).join('') || '<p class="subtle">No staff yet.</p>';
  const body = `<form id="project-team-form" data-form="project-team" data-id="${esc(p.id)}"><p class="subtle">Everyone on the team sees every funder linked to <strong>${esc(p.name)}</strong> — the ones linked today and any linked later.</p><div class="share-list">${rows}</div></form>`;
  const footer = `<button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" form="project-team-form" class="button button-primary">Save</button>`;
  return modalFrame('Team on this project', p.name, body, footer, true);
}
async function leadShareSubmit(form) {
  const id = form.dataset.id; const lead = getLead(id);
  const userIds = [...form.querySelectorAll('input[name="share"]:checked')].map(i => i.value);
  try {
    const ownerSel = form.querySelector('select[name="owner"]');
    if (ownerSel && lead && String(ownerSel.value) !== String(lead.access?.ownerId)) await API(`/api/leads/${encodeURIComponent(id)}/owner`, { method: 'PUT', body: JSON.stringify({ userId: ownerSel.value }) });
    await API(`/api/leads/${encodeURIComponent(id)}/share`, { method: 'PUT', body: JSON.stringify({ userIds }) });
    toast('Sharing saved.'); closeModal(); await refresh();
  } catch (err) { toast(err.message, true); }
}
async function projectTeamSubmit(form) {
  const id = form.dataset.id; const userIds = [...form.querySelectorAll('input[name="team"]:checked')].map(i => i.value);
  try { await API(`/api/projects/${encodeURIComponent(id)}/team`, { method: 'PUT', body: JSON.stringify({ userIds }) }); toast('Team saved.'); closeModal(); await refresh(); }
  catch (err) { toast(err.message, true); }
}
/** R4: Suppliers desk — what they do, where, vetting, and their quotes. */
const TRADE_LABELS = { building: 'Building & classrooms', sanitation: 'Toilets & plumbing', water: 'Water tanks & boreholes', electrical: 'Electrical & solar', ict: 'Computers & ICT', furniture: 'Furniture & fittings', fencing: 'Fencing & security', roofing: 'Roofing & paint', kitchen: 'Kitchens & feeding', landscaping: 'Grounds & sports', other: 'Other' };
function wbSupplierCard(lead) {
  const sp = lead.supplier || {}; const v = sp.vetting || { status: 'pending' }; const id = esc(lead.id); const isAdmin = state.auth.role === 'admin' || state.auth.isRoot || state.auth.demoAccess;
  const loc = sp.location || {}; const acct = lead.account || null;
  const facts = [['Trades', (sp.trades || []).map(t => TRADE_LABELS[t] || t).join(', ')], ['Provinces', (sp.provinces || []).join(', ')], ['Based in', loc.town ? `${loc.town}${loc.postcode ? ` ${loc.postcode}` : ''} · ${loc.source === 'gps' ? 'phone GPS' : loc.source === 'town' ? 'town centre' : 'town not recognised — province only'}` : ''], ['Travels', loc.town ? (loc.radiusKm ? `up to ${loc.radiusKm} km` : 'anywhere in their provinces') : ''], ['Years trading', sp.yearsTrading], ['Website', lead.website], ['Phone', lead.phone], ['Email', lead.email], ['Signed up', sp.signedUpAt ? isoDate(sp.signedUpAt) : '']].filter(([, x]) => x);
  const rand = n => `R ${Math.round(Number(n) || 0).toLocaleString('en-ZA')}`;
  const docState = { received: ['pill-won', 'received'], expiring: ['pill-interested', 'expiring'], expired: ['pill-not-proceeding', 'expired'], declared: ['pill-new', 'number given'], missing: ['pill-not-proceeding', 'missing'] };
  const docs = acct?.documents;
  const docsHtml = docs ? `<div class="wb-needs"><h4>${svgIcon('shield')}Documents · ${docs.received}/${docs.items.length} seen${docs.insured ? ' · insured' : ' · <strong>no insurance seen</strong>'}${docs.expiring ? ` · ${docs.expiring} expiring` : ''}${docs.expired ? ` · ${docs.expired} expired` : ''}</h4>
    <div class="lead-table-wrap"><table class="table sup-docs"><tbody>${docs.items.map(d => `<tr><td><strong>${esc(d.label)}</strong>${d.at && d.by !== 'sign-up' ? `<br><small class="subtle">${esc(d.by)} · ${isoDate(d.at)}</small>` : ''}</td><td><span class="stage-pill ${docState[d.state][0]}">${docState[d.state][1]}${d.expiresAt ? ` · ${d.expiresAt}` : ''}</span></td>${isAdmin ? `<td><select class="form-control">${['missing', 'declared', 'received'].map(x => `<option value="${x}" ${(d.state === 'expiring' || d.state === 'expired' ? 'received' : d.state) === x ? 'selected' : ''}>${x === 'declared' ? 'number given' : x}</option>`).join('')}</select></td><td><input class="form-control" data-ref placeholder="Number / insurer" value="${esc(d.ref)}" /></td><td>${d.hasExpiry ? `<input class="form-control" data-exp type="date" value="${esc(d.expiresAt)}" />` : ''}</td><td><button type="button" class="button button-ghost button-small" data-action="doc-save" data-id="${id}" data-key="${d.key}">Save</button></td>` : `<td colspan="4"><small class="subtle">${esc(d.ref)}</small></td>`}</tr>`).join('')}</tbody></table></div></div>` : '';
  const acctHtml = acct ? `<div class="sup-account"><div><small>Invited</small><strong>${acct.invited}</strong></div><div><small>Quoted</small><strong>${acct.quotes}</strong></div><div><small>Awarded</small><strong>${acct.signed}</strong><span>${rand(acct.awardedValue)}${acct.feesTotal ? `<br>${rand(acct.awardedNet)} after fees` : ''}</span></div><div><small>Completed</small><strong>${acct.done}</strong><span>${rand(acct.doneValue)}</span></div><div><small>Where</small><strong>${acct.places.length ? esc(acct.places.slice(0, 3).join(', ')) : '—'}</strong></div></div>` : '';
  const quotes = (state.data.projects || []).flatMap(p => (p.tender?.quotes || []).filter(q => q.supplierId === lead.id).map(q => ({ ...q, project: p.name, projectId: p.id, where: [p.location?.town, p.location?.district, p.province].filter(Boolean).slice(0, 2).join(', '), done: p.tender.status === 'done' && p.tender.awardedQuoteId === q.id })));
  const pill = v.status === 'approved' ? `<span class="stage-pill pill-won">${svgIcon('check')}Approved ${isoDate(v.at)} by ${esc(v.by || '')}</span>` : v.status === 'rejected' ? `<span class="stage-pill pill-not-proceeding">${svgIcon('ban')}Rejected ${isoDate(v.at)}</span>` : `<span class="stage-pill pill-interested">Vetting pending</span>`;
  return wbCard('shield', 'Supplier', `${acctHtml}<dl class="wb-facts-kv">${facts.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(x))}</dd></div>`).join('')}</dl>${docsHtml}
    ${sp.references ? `<p><strong>References:</strong> ${esc(sp.references)}</p>` : '<p class="subtle">No references given — ask for two before approving.</p>'}
    <div class="wb-vet">${pill}${v.notes ? `<p class="subtle">${esc(v.notes)}</p>` : ''}
      ${isAdmin ? `<input class="form-control" id="vet-notes" placeholder="Vetting notes — who you called, what checked out" /><div class="wb-step-actions">${v.status !== 'approved' ? `<button type="button" class="button button-primary button-small" data-action="vet" data-id="${id}" data-status="approved">${svgIcon('checkCircle')}Approve</button>` : ''}${v.status !== 'rejected' ? `<button type="button" class="button button-ghost button-small" data-action="vet" data-id="${id}" data-status="rejected">${svgIcon('xCircle')}Reject</button>` : ''}${v.status !== 'pending' ? `<button type="button" class="button button-ghost button-small" data-action="vet" data-id="${id}" data-status="pending">Back to pending</button>` : ''}</div>` : '<p class="subtle">An administrator approves or rejects suppliers.</p>'}</div>
    <div class="wb-needs"><h4>${svgIcon('grid')}Quotes (${quotes.length})</h4>${quotes.length ? `<ul class="wb-need-list">${quotes.map(q => `<li><span class="stage-pill ${q.status === 'signed' ? 'pill-won' : q.status === 'declined' ? 'pill-not-proceeding' : 'pill-new'}">${esc(q.done ? 'done' : q.status)}</span> R ${Number(q.amount).toLocaleString('en-ZA')} · ${q.leadTimeDays} days${q.where ? ` · ${esc(q.where)}` : ''} · ${isoDate(q.submittedAt)} · <button type="button" class="link-button" data-action="open-project" data-id="${esc(q.projectId)}">${esc(q.project)}</button></li>`).join('')}</ul>` : '<p class="subtle">No quotes yet. Approved suppliers get an email with a quote link whenever a need in their trade and province goes out.</p>'}</div>`);
}
/** v71: Supporters desk banner — the public sign-up link for individuals; NGOs come through discovery below. */
function supportersBanner() {
  if (!state.sup.supportLink && !state.sup.supportLoading) { state.sup.supportLoading = true; API('/api/supporters/signup-link').then(r => { state.sup.supportLink = r; state.sup.supportLoading = false; renderApp(); }).catch(() => { state.sup.supportLoading = false; }); }
  const l = state.sup.supportLink;
  return `<div class="sch-head" style="margin-bottom:10px"><div><strong>Individuals sign up themselves</strong><p class="subtle">Share the link on social media, in newsletters and at events. People say what they care about; when a matching project is verified, open it → <strong>Tell supporters</strong>.${l ? ` ${l.individuals} supporter${l.individuals === 1 ? '' : 's'} · ${l.ngos} NGO${l.ngos === 1 ? '' : 's'}.` : ''}</p></div>${l ? `<div class="wb-step-actions"><input class="form-control" readonly value="${esc(l.url)}" style="min-width:240px" /><button type="button" class="button button-secondary button-small" data-action="copy-text" data-text="${esc(l.url)}">${svgIcon('copy')}Copy link</button></div>` : ''}</div>`;
}
/** v71: an individual supporter — interests, what they were told about, pledges to confirm. */
function wbSupporterPage(lead) {
  const sp = lead.supporter || {}; const a = lead.account || { pledges: 0, pledged: 0, received: 0, told: 0, items: [] }; const id = esc(lead.id);
  const rand = n => `R ${Math.round(Number(n) || 0).toLocaleString('en-ZA')}`;
  const facts = [['Cares about', (sp.categories || []).map(c => NEED_LABELS[c] || c).join(', ') || 'anything a school needs'], ['Where', (sp.provinces || []).join(', ') || 'anywhere'], ['Usually gives', sp.band ? ({ 250: 'up to R250', 1000: 'R250 – R1 000', 5000: 'R1 000 – R5 000', 25000: 'R5 000 – R25 000', more: 'more than R25 000' })[sp.band] : ''], ['Town', sp.town], ['Why', sp.why], ['Email', lead.email], ['Phone', lead.phone], ['Signed up', sp.signedUpAt ? isoDate(sp.signedUpAt) : '']].filter(([, v]) => v);
  const pill = a.pledged ? `<span class="stage-pill pill-interested">${rand(a.pledged)} to confirm</span>` : a.received ? `<span class="stage-pill pill-won">${rand(a.received)} received</span>` : '<span class="stage-pill pill-new">Supporter</span>';
  return `<div class="panel wb-stepper wb-lead-page"><div class="wb-detail-head">
    <div>${pill}<h2>${esc(lead.contactName || lead.company)}</h2><p class="subtle">Individual supporter · told about ${a.told} project${a.told === 1 ? '' : 's'} · ${a.pledges} pledge${a.pledges === 1 ? '' : 's'}</p></div>
    <div class="wb-detail-actions"><button type="button" class="button button-ghost button-small" data-action="edit-lead" data-id="${id}">${svgIcon('edit')}Edit details</button></div></div>
    ${wbCard('heart', 'Supporter', `<div class="sup-account"><div><small>Told about</small><strong>${a.told}</strong></div><div><small>Pledged</small><strong>${rand(a.pledged)}</strong><span>awaiting payment</span></div><div><small>Received</small><strong>${rand(a.received)}</strong></div></div>
      <dl class="wb-facts-kv">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
      <div class="wb-needs"><h4>${svgIcon('grid')}Pledges</h4>${a.items.length ? `<ul class="wb-need-list">${a.items.map(p => `<li><span class="stage-pill ${p.status === 'received' ? 'pill-won' : p.status === 'withdrawn' ? 'pill-not-proceeding' : 'pill-interested'}">${esc(p.status)}</span> <strong>${rand(p.amount)}</strong> · <button type="button" class="link-button" data-action="open-project" data-id="${esc(p.projectId)}">${esc(p.project)}</button> · ${isoDate(p.at)}${p.message ? `<br><small class="subtle">“${esc(p.message)}”</small>` : ''}${p.status === 'pledged' ? ` <button type="button" class="button button-ghost button-small" data-action="pledge-status" data-id="${id}" data-pledge="${esc(p.id)}" data-status="received">Mark received</button><button type="button" class="button button-ghost button-small" data-action="pledge-status" data-id="${id}" data-pledge="${esc(p.id)}" data-status="withdrawn">Withdrawn</button>` : ''}</li>`).join('')}</ul>` : '<p class="subtle">No pledges yet. Open a verified project → Tell supporters.</p>'}</div>`)}
  </div>`;
}
/** v71: project → matching individuals → one email each with a pledge link. Supporters desk only. */
function projectSupportersSection(p) {
  if (!onSupporters()) return '';
  const id = esc(p.id); const m = state.sup.tell?.projectId === p.id ? state.sup.tell : null; const pl = p.supporterPledges || [];
  const rand = n => `R ${Math.round(Number(n) || 0).toLocaleString('en-ZA')}`; const sum = st => pl.filter(x => x.status === st).reduce((n, x) => n + x.amount, 0);
  return `<div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('heart')}Supporters</span></div>
    <p class="subtle">${pl.length ? `${pl.filter(x => x.status !== 'withdrawn').length} pledge${pl.length === 1 ? '' : 's'}: ${rand(sum('pledged'))} to confirm · ${rand(sum('received'))} received.` : 'No pledges yet.'} Individuals who care about ${esc(NEED_LABELS[p.needCategory] || 'schools')}${p.province ? ` in ${esc(p.province)}` : ''} get one email with a pledge link; nobody is written to twice about the same project.</p>
    <div class="wb-step-actions"><button type="button" class="button button-secondary button-small" data-action="supporters-match" data-id="${id}">${svgIcon('search')}Who would hear?</button>${m ? `<span class="subtle"><strong>${m.fresh}</strong> not yet told of ${m.count} matching${m.supporters.length ? `: ${m.supporters.slice(0, 5).map(x => esc(x.name)).join(', ')}${m.count > 5 ? '…' : ''}` : ''}</span>` : ''}<button type="button" class="button button-primary button-small" data-action="supporters-tell" data-id="${id}" ${m && m.fresh === 0 ? 'disabled title="Everyone matching has been told"' : ''}>${svgIcon('send')}Tell supporters</button></div></div>`;
}
/** v71: find trade businesses by town and invite them to register. Nothing becomes a supplier until they sign up. */
function smeFinder() {
  const f = state.sup.sme || { trade: 'building', town: '', busy: false, results: [], picked: {}, error: '', done: null };
  const rows = f.results.map((o, i) => `<label class="sme-row ${o.alreadyTracked ? 'is-tracked' : ''}"><input type="checkbox" data-sme-pick="${i}" ${f.picked[i] ? 'checked' : ''} ${o.alreadyTracked || !o.mailbox?.email ? 'disabled' : ''} /><span><strong>${esc(o.name)}</strong> ${o.website ? `<a class="source-link" href="${esc(o.website)}" target="_blank" rel="noopener noreferrer">${esc(o.domain || '')}</a>` : ''}<br><small class="subtle">${o.alreadyTracked ? 'already registered / known' : o.mailbox?.email ? esc(o.mailbox.email) : 'no mailbox found'}${o.summary ? ` · ${esc(o.summary.slice(0, 120))}` : ''}</small></span></label>`).join('');
  const n = Object.values(f.picked).filter(Boolean).length;
  return `<details class="sme-finder" ${f.results.length || f.busy ? 'open' : ''}><summary><strong>Find businesses to invite</strong> <span class="subtle">· search the web by trade and town; tick who to invite; they register themselves</span></summary>
    <div class="wb-step-actions"><select class="form-control" id="sme-trade">${Object.entries(TRADE_LABELS).map(([k, v]) => `<option value="${k}" ${f.trade === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input class="form-control" id="sme-town" placeholder="Town, e.g. Tzaneen" value="${esc(f.town)}" style="max-width:220px" /><button type="button" class="button button-secondary button-small" data-action="sme-find" ${f.busy ? 'disabled' : ''}>${svgIcon('search')}${f.busy ? 'Searching…' : 'Find'}</button>${f.results.length ? `<button type="button" class="button button-primary button-small" data-action="sme-invite" ${n ? '' : 'disabled'}>${svgIcon('send')}Invite ${n || ''} selected</button>` : ''}</div>
    ${f.error ? `<p class="form-error">${esc(f.error)}</p>` : ''}${f.done ? `<p class="subtle">${f.done.queued} invitation${f.done.queued === 1 ? '' : 's'} sent${f.done.skipped.length ? ` · skipped: ${f.done.skipped.map(x => `${esc(x.name)} (${esc(x.reason)})`).join(', ')}` : ''}.</p>` : ''}
    ${rows ? `<div class="sme-list">${rows}</div>` : f.busy ? '<p class="subtle">Searching, then checking each business for a working mailbox — up to a minute.</p>' : ''}</details>`;
}
/** R4: intake bar on the Suppliers desk — the sign-up link and the vetting queue. */
function suppliersIntakeBar() {
  if (!state.sup.link && !state.sup.loading) { state.sup.loading = true; API('/api/suppliers/signup-link').then(r => { state.sup.link = r; state.sup.loading = false; renderApp(); }).catch(() => { state.sup.loading = false; }); }
  const l = state.sup.link; const pending = state.data.leads.filter(x => isSupplierLead(x) && (x.supplier?.vetting?.status || 'pending') === 'pending');
  return `<section class="panel wb-intake sch-bar"><div class="sch-head"><div><strong>Suppliers come to Chelo</strong><p class="subtle">Share the sign-up link with contractors, on WhatsApp groups and with district offices. Each sign-up lands here for vetting; approved suppliers get needs in their trades — the nearest to the school first.</p></div>
    ${l ? `<div class="wb-step-actions"><input class="form-control" readonly value="${esc(l.url)}" style="min-width:280px" /><button type="button" class="button button-secondary button-small" data-action="copy-text" data-text="${esc(l.url)}">${svgIcon('copy')}Copy link</button><a class="button button-ghost button-small" href="${esc(l.url)}" target="_blank" rel="noopener">${svgIcon('external')}Open</a></div>` : ''}</div>
    <p class="subtle">${pending.length ? `<strong>${pending.length}</strong> waiting for vetting` : 'No one waiting for vetting'}${l ? ` · ${l.approved} approved` : ''}. To send a need out, open a Verified Project (Projects) → <strong>Ask suppliers to quote</strong>.</p>${smeFinder()}</section>`;
}
/** R3: Schools desk — DBE facts, the call task with its script, and needs that become Verified Projects. */
const NEED_LABELS = { classrooms: 'Classrooms', sanitation: 'Toilets / sanitation', water: 'Water', electricity: 'Electricity', ict: 'Computers / ICT', library: 'Library', sports: 'Sports', furniture: 'Furniture', fencing: 'Fencing / security', kitchen: 'Kitchen / feeding', other: 'Other' };
function wbSchoolCard(lead) {
  const sc = lead.school || {}; const task = lead.callTask; const id = esc(lead.id);
  const facts = [['District', sc.district], ['Circuit', sc.circuit], ['Phase', sc.phase], ['Quintile', sc.quintile ? `${sc.quintile}${sc.noFee ? ' · no-fee' : ''}` : ''], ['Learners', sc.learners ? sc.learners.toLocaleString('en-ZA') : ''], ['Town', sc.town], ['Phone', lead.phone], ['Email', lead.email || 'none published']].filter(([, v]) => v);
  const callBlock = task ? `<div class="wb-call"><h4>${svgIcon('phone')}Call task · ${esc(task.status)}${task.attempts ? ` · ${task.attempts} attempt${task.attempts === 1 ? '' : 's'}` : ''}</h4>
      <ol class="wb-script">${(task.script || []).map(line => `<li>${esc(line)}</li>`).join('')}</ol>
      ${['open', 'call-back', 'booked'].includes(task.status) ? `<div class="wb-call-log"><input class="form-control" id="call-notes" placeholder="Notes (no personal details) — e.g. 'Principal in on Tuesdays'" /><input class="form-control" id="call-when" placeholder="${task.status === 'booked' ? 'Booked for…' : 'Call back / booked for… e.g. Tue 10:00'}" />
        <div class="wb-step-actions"><button type="button" class="button button-primary button-small" data-action="call-log" data-id="${id}" data-outcome="booked">${svgIcon('calendar')}Call booked</button><button type="button" class="button button-secondary button-small" data-action="call-log" data-id="${id}" data-outcome="call-back">${svgIcon('clock')}Call back</button><button type="button" class="button button-ghost button-small" data-action="call-log" data-id="${id}" data-outcome="no-answer">No answer</button><button type="button" class="button button-ghost button-small" data-action="call-log" data-id="${id}" data-outcome="wrong-number">Wrong number</button><button type="button" class="button button-ghost button-small" data-action="call-log" data-id="${id}" data-outcome="declined">${svgIcon('ban')}Declined</button></div></div>` : ''}
      ${(task.history || []).length ? `<ul class="wb-call-history subtle">${task.history.slice(-5).reverse().map(h => `<li>${esc(isoDate(h.at))} · ${esc(h.outcome)}${h.notes ? ` — ${esc(h.notes)}` : ''} <small>(${esc(h.by)})</small></li>`).join('')}</ul>` : ''}</div>` : (lead.email ? '' : `<p class="subtle">Press Run to open the call task.</p>`);
  const needs = lead.needs || [];
  const needsBlock = `<div class="wb-needs"><h4>${svgIcon('grid')}Needs from the principal call</h4>
      ${needs.length ? `<ul class="wb-need-list">${needs.map(n => `<li><span class="stage-pill pill-new">${esc(NEED_LABELS[n.category] || n.category)}</span> ${esc(n.text)}${n.estimate ? ` <small class="subtle">≈ R ${Number(n.estimate).toLocaleString('en-ZA')}</small>` : ''} ${n.projectId ? `<button type="button" class="button button-ghost button-small" data-action="open-project" data-id="${esc(n.projectId)}">${svgIcon('check')}Verified Project</button>` : `<button type="button" class="button button-secondary button-small" data-action="need-project" data-id="${id}" data-need="${esc(n.id)}">${svgIcon('plus')}Make Verified Project</button>`}</li>`).join('')}</ul>` : `<p class="subtle">Nothing captured yet. Write each need as one sentence the moment you hear it.</p>`}
      <form class="wb-need-form" data-form="need" data-id="${id}"><select class="form-control" name="category">${Object.entries(NEED_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><input class="form-control" name="text" placeholder="e.g. Two of five toilet blocks are unusable; 480 learners share the rest." required /><input class="form-control" name="estimate" type="number" min="0" step="1000" placeholder="Estimate R (optional)" /><button type="submit" class="button button-secondary button-small">${svgIcon('plus')}Add need</button></form></div>`;
  return wbCard('building', 'School', `<dl class="wb-facts-kv">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>${callBlock}${needsBlock}`);
}
/** R3: the DBE browser — district first, then circuit, then schools. Replaces "Add or discover" on the Schools desk. */
function schStatus() { if (state.sch.status || state.sch.statusLoading) return; state.sch.statusLoading = true; API('/api/schools/status').then(r => { state.sch.status = r; state.sch.statusLoading = false; renderApp(); }).catch(err => { state.sch.statusLoading = false; toast(err.message, true); }); }
async function schLoadTree() {
  const { province, district } = state.sch; const key = `${province}|${district}`;
  if (state.sch.treeKey === key) return; state.sch.treeKey = key; state.sch.tree = null; state.sch.list = null; renderApp();
  try { state.sch.tree = await API(`/api/schools/tree?province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}`); if (district) await schLoadList(); } catch (err) { toast(err.message, true); }
  renderApp();
}
async function schLoadList() {
  const { province, district, circuit, contact, q } = state.sch;
  state.sch.list = await API(`/api/schools?province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}&circuit=${encodeURIComponent(circuit)}&contact=${encodeURIComponent(contact)}&q=${encodeURIComponent(q)}&limit=120`);
}
function schoolsIntakeBar() {
  schStatus();
  const st = state.sch.status; const sch = state.sch; const isAdmin = state.auth.role === 'admin' || state.auth.isRoot || state.auth.demoAccess;
  if (!st) return `<section class="panel wb-intake"><p class="subtle">Checking the DBE list…</p></section>`;
  const guide = `<details class="sch-guide"><summary>${svgIcon('upload')} Upload a newer DBE list (3 steps)</summary><ol class="settings-steps"><li>Open the DBE EMIS downloads page (education.gov.za → Programmes → EMIS → <strong>EMIS Downloads</strong>) and download the latest <strong>National</strong> master list of schools (Excel).</li><li>Open it in Excel or Google Sheets and <strong>Save as / Download → CSV</strong>. Keep the original column names (NatEmis, Official_Institution_Name, Province, EIDistrict, EICircuit, Email, Telephone…).</li><li>Choose that CSV here. Existing schools are updated, new ones added; a blank email or phone never overwrites a known one.</li></ol>${isAdmin ? `<input type="file" id="dbe-csv" accept=".csv,text/csv" hidden /><button type="button" class="button button-secondary button-small" data-action="dbe-upload" ${sch.busy ? 'disabled' : ''}>${svgIcon('upload')}${sch.busy ? 'Importing…' : 'Choose the CSV'}</button>` : '<p class="subtle">An administrator uploads the file.</p>'}</details>`;
  if (!st.loaded) return `<section class="panel wb-intake sch-bar"><div class="sch-head"><div><strong>DBE list of schools</strong><p class="subtle">Not loaded yet. ${st.bundledAvailable ? `Chelo ships with the ${esc(st.bundledLabel)}.` : 'Upload the DBE CSV below.'}</p></div>${st.bundledAvailable && isAdmin ? `<button type="button" class="button button-primary" data-action="dbe-load" ${sch.busy ? 'disabled' : ''}>${svgIcon('database')}${sch.busy ? 'Loading…' : 'Load the DBE list'}</button>` : ''}</div>${guide}</section>`;
  if (!sch.treeKey) schLoadTree();
  const provinces = sch.tree?.level === 'provinces' ? sch.tree.items : null;
  const crumbs = `<div class="sch-crumbs"><button type="button" class="link-button" data-action="sch-nav" data-province="" data-district="">All provinces</button>${sch.province ? ` › <button type="button" class="link-button" data-action="sch-nav" data-province="${esc(sch.province)}" data-district="">${esc(sch.province)}</button>` : ''}${sch.district ? ` › <strong>${esc(sch.district)}</strong>` : ''}</div>`;
  let body = '';
  if (!sch.province) body = `<p class="subtle">Pick a province, then a district. Work one district at a time: its schools, its circuit offices, its principals.</p><div class="sch-grid">${(provinces || []).map(p => `<button type="button" class="sch-tile" data-action="sch-nav" data-province="${esc(p.name)}" data-district=""><strong>${esc(p.name)}</strong><span>${p.schools.toLocaleString('en-ZA')} schools · ${p.withEmail.toLocaleString('en-ZA')} with email · ${p.withPhone.toLocaleString('en-ZA')} with phone</span></button>`).join('') || '<span class="subtle">Loading…</span>'}</div>`;
  else if (!sch.district) body = `<p class="subtle">Districts in ${esc(sch.province)}, biggest first. Email where published, otherwise a call task with a script.</p><div class="sch-grid">${(sch.tree?.items || []).map(d => `<button type="button" class="sch-tile" data-action="sch-nav" data-province="${esc(sch.province)}" data-district="${esc(d.name || '(no district)')}"><strong>${esc(d.name || '(no district)')}</strong><span>${d.schools} schools · ${d.withEmail} email · ${d.withPhone} phone · ${d.noFee} no-fee</span></button>`).join('') || '<span class="subtle">Loading…</span>'}</div>`;
  else {
    const circuits = sch.tree?.items || []; const list = sch.list;
    body = `<div class="sch-filters">${circuits.length > 1 ? `<select class="form-control" data-sch-filter="circuit"><option value="">All circuits (${circuits.length})</option>${circuits.map(c => `<option value="${esc(c.name)}" ${sch.circuit === c.name ? 'selected' : ''}>${esc(c.name || '(no circuit)')} · ${c.schools}</option>`).join('')}</select>` : ''}
      <select class="form-control" data-sch-filter="contact"><option value="" ${!sch.contact ? 'selected' : ''}>Any contact</option><option value="email" ${sch.contact === 'email' ? 'selected' : ''}>Email published</option><option value="phone" ${sch.contact === 'phone' ? 'selected' : ''}>Phone only</option></select>
      <input class="form-control" data-sch-filter="q" placeholder="School or town" value="${esc(sch.q)}" /></div>
      ${list ? `<p class="subtle">${list.total.toLocaleString('en-ZA')} school${list.total === 1 ? '' : 's'}${list.total > list.items.length ? ` · showing the first ${list.items.length} (email first)` : ''}</p><div class="sch-list">${list.items.map(x => `<div class="sch-row ${x.tracked ? 'is-tracked' : ''}"><div><strong>${esc(x.name)}</strong><span class="subtle"> · ${esc(x.phase || '')}${x.quintile ? ` · ${esc(x.quintile)}` : ''}${x.noFee ? ' · no-fee' : ''}${x.learners ? ` · ${x.learners.toLocaleString('en-ZA')} learners` : ''}${x.town ? ` · ${esc(x.town)}` : ''}</span><br><span class="subtle">${x.email ? `${svgIcon('mail')}${esc(x.email)}` : ''}${x.phone ? ` ${svgIcon('phone')}${esc(x.phone)}` : ''}${!x.email && !x.phone ? 'no contact in the DBE list' : ''}</span></div>${x.tracked ? (x.tracked.visible ? `<button type="button" class="button button-ghost button-small" data-action="wb-select" data-id="${esc(x.tracked.id)}">${svgIcon('eye')}In To do · ${esc(x.tracked.stage)}</button>` : '<span class="subtle">Added by a colleague</span>') : `<button type="button" class="button button-secondary button-small" data-action="sch-add" data-id="${esc(x.natemis)}" ${sch.busy ? 'disabled' : ''}>${svgIcon('plus')}Add & run</button>`}</div>`).join('')}</div>` : '<p class="subtle">Loading schools…</p>'}`;
  }
  return `<section class="panel wb-intake sch-bar"><div class="sch-head"><div><strong>DBE list of schools</strong> <span class="subtle">· ${esc(st.source)} · ${st.total.toLocaleString('en-ZA')} schools</span>${sch.district ? ` <span class="subtle">· ${esc(sch.district)}</span>` : sch.province ? ` <span class="subtle">· ${esc(sch.province)}</span>` : ''}</div><div class="wb-step-actions">${guide}<button type="button" class="button button-ghost button-small" data-action="sch-toggle" title="${state.sch.collapsed ? 'Show the school list' : 'Hide the school list — your To do cards move up'}">${svgIcon(state.sch.collapsed ? 'eye' : 'close')}${state.sch.collapsed ? 'Show list' : 'Hide list'}</button></div></div>${state.sch.collapsed ? '' : `${crumbs}<div class="sch-scroll">${body}</div>`}</section>`;
}
/** R2: Marketing desk — pitch track and outcomes for a media target. */
function wbMediaCard(lead) {
  const track = lead.pitchTrack === 'partnership' ? 'partnership' : 'pr';
  const kit = state.data.mediaKit; const kitOk = kit && kit.status === 'approved' && kit.boilerplate;
  const outcomes = lead.outcomes || {};
  const oc = (key, label, icon) => outcomes[key] ? `<span class="stage-pill pill-won" title="${esc(outcomes[key].at || '')}">${svgIcon(icon)}${label} ${isoDate(outcomes[key].at)}</span><button type="button" class="button button-ghost button-small" data-action="media-outcome" data-id="${esc(lead.id)}" data-outcome="${key}" data-on="false" title="Clear">${svgIcon('close')}</button>` : `<button type="button" class="button button-ghost button-small" data-action="media-outcome" data-id="${esc(lead.id)}" data-outcome="${key}">${svgIcon(icon)}${label}</button>`;
  return wbCard('globe', 'Pitch', `<div class="wb-track"><span class="subtle">Track</span>
      <button type="button" class="desk-tab ${track === 'pr' ? 'is-active' : ''}" data-action="pitch-track" data-id="${esc(lead.id)}" data-track="pr" title="Get a verified-project story covered">PR pitch</button>
      <button type="button" class="desk-tab ${track === 'partnership' ? 'is-active' : ''}" data-action="pitch-track" data-id="${esc(lead.id)}" data-track="partnership" title="Propose an ongoing media partnership">Partnership pitch</button></div>
    <p class="subtle">${track === 'pr' ? 'Story first: pick the Verified Project below; the pitch names it and offers the spokesperson and photos.' : 'Partnership: an ongoing series on verified projects. No single project needed.'}${kitOk ? '' : ` <strong>The media kit is not approved yet.</strong> <button type="button" class="link-button" data-action="open-media-kit">Open media kit</button>`}</p>
    <div class="wb-outcomes"><span class="subtle">Outcome</span>${oc('booked', 'Call booked', 'calendar')}${oc('published', 'Published', 'check')}${oc('signed', 'Partnership signed', 'trophy')}</div>`);
}
/** v70: a supplier is an account, not a prospect — no research, no drafted email, no sequence. */
function wbSupplierPage(lead) {
  const v = lead.supplier?.vetting || { status: 'pending' }; const loc = lead.supplier?.location || {};
  const pill = v.status === 'approved' ? `<span class="stage-pill pill-won">${svgIcon('check')}Approved</span>` : v.status === 'rejected' ? `<span class="stage-pill pill-not-proceeding">Rejected</span>` : `<span class="stage-pill pill-interested">Vetting pending</span>`;
  return `<div class="panel wb-stepper wb-lead-page"><div class="wb-detail-head">
    <div>${pill}<h2>${esc(lead.company)}</h2><p class="subtle">${esc(lead.contactName || 'No contact')}${lead.title ? ` · ${esc(lead.title)}` : ''}${lead.phone ? ` · ${esc(lead.phone)}` : ''}${lead.email ? ` · ${esc(lead.email)}` : ''}${loc.town ? ` · ${esc(loc.town)}` : ''}</p></div>
    <div class="wb-detail-actions"><button type="button" class="button button-ghost button-small" data-action="edit-lead" data-id="${esc(lead.id)}">${svgIcon('edit')}Edit details</button></div></div>
    ${wbSupplierCard(lead)}
  </div>`;
}
function wbLeadPage(lead) {
  if (isSupplierLead(lead)) return wbSupplierPage(lead);
  if (isIndividualLead(lead)) return wbSupporterPage(lead);
  const s = wbStatusOf(lead); const busy = state.wb.busy[lead.id];
  state.wb.openStep = null;
  const header = `<div class="wb-detail-head">
    <div>${stagePill(lead.stage || 'New')}<h2>${esc(lead.company)}</h2><p class="subtle">${esc(lead.contactName || 'No contact')}${lead.title ? ` · ${esc(lead.title)}` : ''}${lead.email ? ` · ${esc(lead.email)}` : ' · no email yet'}${lead.project ? ` · ${esc(lead.project)}` : ''}</p></div>
    <div class="wb-detail-actions">${wbPill(s)}<button type="button" class="button button-ghost button-small" data-action="edit-lead" data-id="${esc(lead.id)}">${svgIcon('edit')}Edit details</button><button type="button" class="button button-ghost button-small" data-action="wb-run" data-id="${esc(lead.id)}" ${busy || s === 'running' ? 'disabled' : ''} title="Check the address, research and draft again">${svgIcon('refresh')}${busy || s === 'running' ? 'Working…' : 'Run again'}</button></div>
  </div>`;
  return `<div class="panel wb-stepper wb-lead-page">${header}
    ${wbAccessLine(lead)}
    ${lead.flow?.error ? `<p class="form-error wb-flow-error">${esc(lead.flow.error)}</p>` : ''}
    ${wbActionCard(lead, s, busy)}
    ${isMediaLead(lead) ? wbMediaCard(lead) : ''}
    ${isSchoolLead(lead) ? wbSchoolCard(lead) : ''}
    ${wbWhoCard(lead, s, busy)}
    ${wbSendCard(lead, s, busy)}
  </div>`;
}

const SEQ_STEP_META = { planned: ['Planned', 'pill-new'], queued: ['Queued', 'pill-researched'], sent: ['Sent', 'pill-won'], skipped: ['Skipped', 'pill-new'], cancelled: ['Cancelled', 'pill-not-proceeding'], failed: ['Failed', 'pill-not-proceeding'] };
const SEQ_STATUS_META = { draft: ['Not sent yet', 'pill-new'], 'pending-approval': ['Waiting for a second approval', 'pill-pending'], approved: ['Approved', 'pill-won'], running: ['Chelo is following up', 'pill-researched'], stopped: ['Stopped', 'pill-not-proceeding'], completed: ['All follow-ups sent', 'pill-won'] };
const TRIAGE_META = { interested: ['Interested', 'trophy', 'Reply personally and offer briefing times'], 'not-now': ['Not now', 'clock', 'Pause and resurface on a date'], 'wrong-person': ['Wrong person', 'users', 'Capture the redirect as a new contact'], 'opt-out': ['Opt-out', 'ban', 'Suppress workspace-wide'], automatic: ['Automatic', 'activity', 'Ignore — not engagement'], unclassified: ['Needs a human look', 'info', 'Read and categorise'] };
function wbTriageLabel(cat) { return (TRIAGE_META[cat] || [cat])[0]; }
function wbSequenceStepStatus(lead, emailStatus) {
  const seq = lead.sequence;
  if (seq) return seq.status === 'running' ? 'running' : seq.status === 'completed' ? 'sent' : seq.status === 'stopped' ? (seq.stoppedReason === 'Human reply received' ? 'sent' : 'error') : seq.status === 'pending-approval' ? 'review' : seq.status === 'approved' ? 'approved' : 'review';
  return emailStatus === 'Sent' ? 'sent' : emailStatus === 'Queued' ? 'running' : String(emailStatus).startsWith('Failed') ? 'error' : emailStatus === 'Approved' ? 'approved' : lead.emailDraft ? 'review' : null;
}
function wbSequenceStepDetail(lead, emailStatus) {
  const seq = lead.sequence; if (!seq) return emailStatus === 'None' ? '' : emailStatus;
  const sent = seq.steps.filter(s => s.status === 'sent').length; const active = seq.steps.filter(s => !['skipped', 'cancelled'].includes(s.status)).length;
  if (seq.status === 'running') { const next = seq.steps.find(s => ['queued', 'planned'].includes(s.status)); return `Step ${sent}/${active} sent${next?.scheduledFor ? ` · next ${wbWhen(next.scheduledFor)}` : ''}`; }
  if (seq.status === 'stopped') return `${seq.stoppedReason || 'Stopped'} · ${sent}/${active} sent`;
  if (seq.status === 'completed') return `All ${sent} steps sent`;
  return SEQ_STATUS_META[seq.status]?.[0] || seq.status;
}
function wbWhen(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`; }
function wbSequencePanel(lead) {
  const seq = lead.sequence; if (!seq || seq.status === 'draft') return '';
  const [statusLabel, statusCls] = SEQ_STATUS_META[seq.status] || [seq.status, 'pill-new'];
  const steps = seq.steps.filter(st => !['skipped'].includes(st.status)).map(st => {
    const [label, cls] = SEQ_STEP_META[st.status] || [st.status, 'pill-new'];
    const when = st.sentAt ? `Sent ${wbWhen(st.sentAt)}` : st.scheduledFor ? `Due ${wbWhen(st.scheduledFor)}` : st.n === 1 ? 'Sends in the next free slot' : `About ${st.offsetDays} working day${st.offsetDays === 1 ? '' : 's'} after the one before`;
    return `<li class="seq-step seq-step-${esc(st.status)}" data-step="${st.n}"><div class="seq-step-rail"><span class="seq-step-dot">${st.status === 'sent' ? svgIcon('check') : st.status === 'failed' || st.status === 'cancelled' ? svgIcon('xCircle') : st.n}</span></div>
      <div class="seq-step-main"><div class="seq-step-head"><strong>${st.n === 1 ? 'First email' : `Follow-up ${st.n - 1}`}</strong><span class="stage-pill ${cls}">${esc(label)}</span><small class="subtle">${esc(when)}</small></div>
        <details class="seq-preview"><summary>${esc(st.subject || '')}</summary><pre class="wb-preview-body">${esc(st.body || '')}</pre></details>${st.error ? `<p class="form-error">${esc(st.error)}</p>` : ''}</div></li>`;
  }).join('');
  const stoppedWhy = seq.status === 'stopped' ? ({ 'Human reply received': 'They replied, so Chelo stopped.', manual: 'Stopped by you.', 'do-not-contact': 'They asked us to stop.', completed: '' })[seq.stoppedReason] || seq.stoppedReason || 'Stopped.' : '';
  return `<div class="wb-seq"><div class="wb-seq-head"><div><h4>${svgIcon('send')}Follow-ups</h4><p class="subtle">${esc(stoppedWhy || 'Same email thread · stops the moment they reply, bounce or opt out.')}</p></div><span class="stage-pill ${statusCls}">${esc(statusLabel)}</span></div>
    <ol class="seq-steps">${steps}</ol></div>`;
}
// ---------------------------------------------------------------------
// Preview before send — "what the funder will receive". One screen: the email exactly as it renders, the PDF beside it,
// a pre-flight checklist, and the single next action. Research-backed pattern: Plan → Preview → Approve; review in the
// order the recipient experiences it (from/to/subject → body → links → attachment).
// ---------------------------------------------------------------------
async function openSendPreview(leadId, step = 0) {
  // Full-width page (not a pop-up). Cached per step so switching First email ↔ Follow-ups never blanks the screen.
  const rv = state.review && state.review.id === leadId ? state.review : { id: leadId, cache: {}, error: '', returnView: state.view === 'review' ? 'workbench' : state.view };
  if (state.view !== 'review') rv.returnView = state.view;
  rv.step = Number(step) || 0; rv.error = ''; rv.loading = !rv.cache[rv.step];
  state.review = rv; state.modal = null; state.view = 'review'; renderApp(); window.scrollTo({ top: 0 });
  try {
    const fresh = await API(`/api/leads/${encodeURIComponent(leadId)}/preview${rv.step ? `?step=${rv.step}` : ''}`);
    const changed = JSON.stringify(fresh) !== JSON.stringify(rv.cache[rv.step] || null);
    rv.cache[rv.step] = fresh;
    if (state.review === rv && state.view === 'review' && (changed || rv.loading)) { rv.loading = false; renderApp(); }
    else rv.loading = false;
  } catch (err) { rv.error = err.message || 'Could not build the preview.'; rv.loading = false; if (state.review === rv && state.view === 'review') renderApp(); }
}
function closeSendPreview() {
  const rv = state.review; const back = rv?.returnView && rv.returnView !== 'review' ? rv.returnView : 'workbench';
  if (back === 'workbench' && rv) { state.wb.selectedId = rv.id; state.wb.filter = 'all'; }
  state.view = back; renderApp(); window.scrollTo({ top: 0 });
}
function reviewView() {
  const rv = state.review; const lead = rv ? getLead(rv.id) : null;
  if (!rv || !lead) return `<div class="panel empty-state"><p>Nothing to read yet.</p><button type="button" class="button button-secondary" data-action="send-preview-close">Back</button></div>`;
  const d = rv.cache[rv.step];
  const head = `<div class="rv-head"><button type="button" class="button button-ghost button-small" data-action="send-preview-close">${svgIcon('back')}Back to ${esc(lead.company)}</button><div class="rv-title"><h1>Read before sending</h1><p class="subtle">Exactly what ${esc(lead.contactName || 'the funder')} at ${esc(lead.company)} will receive.${rv.loading ? ' <span class="rv-loading">Updating…</span>' : ''}</p></div></div>`;
  if (!d) return `<div class="rv-page">${head}<div class="panel panel-empty">${rv.error ? `<p class="form-error">${esc(rv.error)}</p><button type="button" class="button button-secondary" data-action="send-preview" data-id="${esc(lead.id)}" data-step="${rv.step}">Try again</button>` : 'Building the preview…'}</div></div>`;
  const seqTabs = d.steps.length ? `<div class="sp-steps" role="tablist">${[{ n: 0, label: 'First email' }, ...d.steps.filter(x => x.n > 1).map(x => ({ n: x.n, label: `Follow-up ${x.n - 1}`, status: x.status }))].map(t => `<button type="button" role="tab" class="sp-step ${Number(rv.step) === t.n ? 'is-active' : ''}" data-action="send-preview-step" data-id="${esc(lead.id)}" data-step="${t.n}" aria-selected="${Number(rv.step) === t.n}">${esc(t.label)}${t.status && !['planned', 'draft'].includes(t.status) ? ` <small>${esc(t.status)}</small>` : ''}</button>`).join('')}</div>` : '';
  const srcdoc = esc(String(d.html || '').replace('<body', '<base target="_blank" rel="noopener"><body'));
  const emailPane = `<section class="sp-email">
    <div class="sp-head"><div class="sp-row"><span>From</span><strong>${d.from ? `${esc(d.from.name || '')} &lt;${esc(d.from.email)}&gt;` : '<em class="form-error">no sending mailbox yet — add one in Settings</em>'}</strong></div>
      <div class="sp-row"><span>To</span><strong>${esc(d.to.name || '')} &lt;${esc(d.to.email || 'no email')}&gt;</strong></div>
      <div class="sp-row"><span>Subject</span><strong>${esc(d.subject || '(empty)')}</strong></div>
      ${d.attachments.length ? `<div class="sp-row"><span>Attached</span><strong>${d.attachments.map(a => `<a class="sp-attachment" href="${esc(a.url)}" target="_blank" rel="noopener">${svgIcon('paperclip')}${esc(a.name)} · ${a.sizeKb} KB</a>`).join('')}</strong></div>` : (rv.step === 0 ? `<div class="sp-row"><span>Attached</span><strong>${svgIcon('paperclip')}Chelo proposal PDF <small class="subtle">(made when you press Send)</small></strong></div>` : '')}</div>
    <iframe class="sp-frame" title="Email as the funder sees it" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${srcdoc}"></iframe>
    ${d.links.length ? `<div class="sp-links"><span class="subtle">Links in this email</span>${d.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="sp-link sp-link-${esc(l.kind)}">${svgIcon(l.kind === 'cta' ? 'calendar' : l.kind === 'page' ? 'external' : 'link')}${esc(l.kind === 'cta' ? 'Yes — book a briefing (one click)' : l.kind === 'page' ? 'Co-branded project page' : l.kind === 'opt-out' ? 'Opt-out' : l.url.replace(/^https?:\/\//, '').slice(0, 60))}</a>`).join('')}</div>` : ''}
  </section>`;
  const pdfPane = d.proposal ? `<section class="sp-pdf"><div class="sp-pdf-head"><strong>${svgIcon('proposals')}Proposal PDF</strong><span>${d.attachments.length ? 'attached to this email' : rv.step > 0 ? 'sent with the first email' : 'will be attached'}</span><a class="button button-ghost button-small" href="${esc(d.proposal.url)}" target="_blank" rel="noopener">${svgIcon('external')}Open full size</a><a class="button button-ghost button-small" href="${esc(d.proposal.download)}" download>${svgIcon('download')}Download</a></div><iframe class="sp-pdf-frame" title="Proposal PDF" src="${esc(d.proposal.url)}#toolbar=1&view=FitH"></iframe></section>`
    : `<section class="sp-pdf sp-pdf-empty"><strong>${svgIcon('proposals')}No proposal PDF yet</strong><p class="subtle">Chelo makes the PDF from the chosen project when you press Send. Make it now if you want to read it first.</p><button type="button" class="button button-secondary button-small" data-action="rv-make-pdf" data-id="${esc(lead.id)}">${svgIcon('proposals')}Make the PDF now</button></section>`;
  const checks = `<ul class="sp-checks">${d.checks.map(c => `<li class="${c.ok ? 'is-ok' : 'is-bad'}">${svgIcon(c.ok ? 'checkCircle' : 'xCircle')}<span><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></span></li>`).join('')}</ul>`;
  const st = d.status; const seq = lead.sequence; const emailStatus = st.email;
  let primary = '';
  if (seq && seq.status === 'draft') primary = `<button type="button" class="button button-primary" data-action="seq-approve" data-id="${esc(lead.id)}" ${d.ready ? '' : 'disabled title="Fix the red checks first"'}>${svgIcon('send')}${st.approvalPolicy === 'four-eyes' ? 'Approve (1 of 2)' : 'Send & follow up'}</button>`;
  else if (seq && seq.status === 'pending-approval') primary = `<button type="button" class="button button-primary" data-action="seq-countersign" data-id="${esc(lead.id)}">${svgIcon('shield')}Approve as second person & send</button>`;
  else if (seq && ['running', 'approved'].includes(seq.status)) primary = lead.sendSlot ? wbSendSlot(lead) : `<span class="stage-pill pill-won">${svgIcon('check')}Sending — Chelo follows up for you</span>`;
  else if (['Draft', 'None'].includes(emailStatus)) primary = `<button type="button" class="button button-primary" data-action="email-approve" data-id="${esc(lead.id)}" ${d.ready ? '' : 'disabled title="Fix the red checks first"'}>${svgIcon('checkCircle')}Approve this email</button>`;
  else if (emailStatus === 'Pending second approval') primary = `<button type="button" class="button button-primary" data-action="email-countersign" data-id="${esc(lead.id)}">${svgIcon('shield')}Approve as second person</button>`;
  else if (emailStatus === 'Approved') primary = `<button type="button" class="button button-primary" data-action="send-smtp" data-id="${esc(lead.id)}">${svgIcon('send')}Send now</button>`;
  else if (emailStatus === 'Queued') primary = lead.sendSlot ? wbSendSlot(lead) : `<span class="stage-pill pill-researched">Scheduled — sends in the next free slot</span>`;
  else if (String(emailStatus).startsWith('Sent')) primary = `<span class="stage-pill pill-won">${svgIcon('check')}Sent</span>`;
  const blockers = d.ready ? [] : d.checks.filter(c => !c.ok);
  const blockNote = blockers.length && /disabled/.test(primary) ? `<p class="rv-blocked form-error">Can't send yet — fix: ${esc(blockers.map(c => c.label).join(', '))}.</p>` : '';
  const footer = `<div class="rv-footer"><div class="rv-footer-left">${checks}</div><div class="rv-footer-right">${blockNote}<button type="button" class="button button-secondary" data-action="send-preview-edit" data-id="${esc(lead.id)}">${svgIcon('edit')}Edit email</button>${primary}</div></div>`;
  return `<div class="rv-page ${rv.loading ? 'is-loading' : ''}">${head}${seqTabs}<div class="sp-layout">${emailPane}${pdfPane}</div>${footer}</div>`;
}
function wbReplyPointer(lead) {
  const t = lead.triage; if (!t) return '';
  if (t.handled) return `<div class="wb-triage is-handled"><span class="stage-pill pill-won">${svgIcon('check')}Triaged: ${esc(wbTriageLabel(t.outcome?.category || t.category))}</span><small class="subtle">${esc(t.handledBy || '')} · ${isoDate(t.handledAt)}</small></div>`;
  const overdue = t.dueAt && Date.parse(t.dueAt) < Date.now();
  return `<div class="wb-triage"><div class="wb-triage-head"><div><h4>${svgIcon('reply')}Reply received — sequence stopped</h4><p class="subtle">Suggested: ${esc(wbTriageLabel(t.category))} (${esc(t.confidence || 'low')} confidence)${t.dueAt ? ` · ${overdue ? 'overdue, was due' : 'respond by'} ${wbWhen(t.dueAt)}` : ''}</p></div><button type="button" class="button button-primary button-small" data-action="ix-open-lead" data-lead="${esc(lead.id)}">${svgIcon('reply')} Handle in Inbox</button></div>${t.excerpt ? `<blockquote class="triage-excerpt">${esc(t.excerpt)}</blockquote>` : ''}</div>`;
}
function wbTriageCard(lead) {
  const t = lead.triage; if (!t) return '';
  const [label, icon, action] = TRIAGE_META[t.category] || TRIAGE_META.unclassified;
  if (t.handled) return `<div class="wb-triage is-handled"><span class="stage-pill pill-won">${svgIcon('check')}Triaged: ${esc(wbTriageLabel(t.outcome?.category || t.category))}</span><small class="subtle">${esc(t.handledBy || '')} · ${isoDate(t.handledAt)}${t.outcome?.resumeOn ? ` · resurfaces ${esc(t.outcome.resumeOn)}` : ''}${t.outcome?.redirect?.name ? ` · redirect → ${esc(t.outcome.redirect.name)}` : ''}</small></div>`;
  const overdue = t.dueAt && Date.parse(t.dueAt) < Date.now();
  const redirect = t.hints?.redirect || {}; const resumeOn = t.hints?.resumeOn || '';
  const sla = t.dueAt ? `<span class="triage-sla ${overdue ? 'is-overdue' : ''}">${svgIcon('clock')}${overdue ? 'Overdue — was due' : 'Respond by'} ${wbWhen(t.dueAt)}</span>` : '';
  return `<div class="wb-triage" data-lead="${esc(lead.id)}">
    <div class="wb-triage-head"><div><p class="subtle">Human reply · sequence stopped</p><h4>${svgIcon(icon)}Suggested: ${esc(label)} <small class="subtle">(${esc(t.confidence || 'low')} confidence)</small></h4><p class="subtle">${esc(action)}${t.reasons?.length ? ` · ${esc(t.reasons.slice(0, 2).join('; '))}` : ''}</p></div>${sla}</div>
    ${t.excerpt ? `<blockquote class="triage-excerpt">${esc(t.excerpt)}</blockquote>` : ''}
    <div class="triage-inputs">
      <label class="form-group"><span>Redirect name (wrong person)</span><input class="form-control" id="triage-redirect-name" value="${esc(redirect.name || '')}" placeholder="e.g. Naledi Mokoena" /></label>
      <label class="form-group"><span>Redirect title</span><input class="form-control" id="triage-redirect-title" value="${esc(redirect.title || '')}" placeholder="Head of CSI" /></label>
      <label class="form-group"><span>Resurface on (not now)</span><input class="form-control" type="date" id="triage-resume-on" value="${esc(resumeOn)}" /></label>
      <label class="form-group"><span>Note</span><input class="form-control" id="triage-note" placeholder="Optional context for the timeline" /></label>
    </div>
    <div class="triage-actions">${['interested', 'not-now', 'wrong-person', 'opt-out', 'automatic'].map(cat => `<button type="button" class="button ${cat === t.category ? 'button-primary' : 'button-secondary'} button-small" data-action="triage-apply" data-id="${esc(lead.id)}" data-category="${cat}">${svgIcon(TRIAGE_META[cat][1])}${esc(TRIAGE_META[cat][0])}</button>`).join('')}</div>
  </div>`;
}
function wbCollectSequenceEdits() {
  const steps = {};
  document.querySelectorAll('[data-seq-toggle]').forEach(el => { steps[el.dataset.seqToggle] = { ...(steps[el.dataset.seqToggle] || {}), n: Number(el.dataset.seqToggle), enabled: el.checked }; });
  document.querySelectorAll('[data-seq-offset]').forEach(el => { steps[el.dataset.seqOffset] = { ...(steps[el.dataset.seqOffset] || {}), n: Number(el.dataset.seqOffset), offsetDays: Number(el.value) || 1 }; });
  document.querySelectorAll('[data-seq-subject]').forEach(el => { if (!el.readOnly) steps[el.dataset.seqSubject] = { ...(steps[el.dataset.seqSubject] || {}), n: Number(el.dataset.seqSubject), subject: el.value }; });
  document.querySelectorAll('[data-seq-body]').forEach(el => { if (!el.readOnly) steps[el.dataset.seqBody] = { ...(steps[el.dataset.seqBody] || {}), n: Number(el.dataset.seqBody), body: el.value }; });
  return Object.values(steps);
}
async function wbSequenceAction(action, button) {
  const id = button.dataset.id; const url = act => `/api/leads/${encodeURIComponent(id)}/${act}`;
  const run = async (fn, okMsg) => { state.wb.busy[id] = true; renderApp(); try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); } catch (err) { toast(err.message, true); } finally { delete state.wb.busy[id]; await refresh(); } };
  if (action === 'wb-send-all') {
    const lead = getLead(id); if (!lead) return true;
    if (!lead.sequence || ['stopped', 'completed'].includes(lead.sequence.status)) {
      state.wb.busy[id] = true; renderApp();
      try { await API(url('sequence/build'), { method: 'POST', body: JSON.stringify({ force: true }) }); }
      catch (err) { toast(err.message, true); delete state.wb.busy[id]; await refresh(); return true; }
      delete state.wb.busy[id]; await refresh();
    }
    await openSendPreview(id); return true;
  }
  if (action === 'seq-build') { await run(() => API(url('sequence/build'), { method: 'POST', body: JSON.stringify({ force: button.dataset.force === 'true' }) }), 'Sequence plan built — review each step, then approve once.'); return true; }
  if (action === 'seq-save') { await run(() => API(url('sequence'), { method: 'PATCH', body: JSON.stringify({ steps: wbCollectSequenceEdits() }) }), 'Plan saved.'); return true; }
  if (action === 'seq-approve') { const steps = wbCollectSequenceEdits(); await run(() => API(url('sequence/approve'), { method: 'POST', body: JSON.stringify({ steps }) }), r => r.sequence.status === 'running' ? 'Sending. Chelo will follow up for you unless they reply.' : 'Approved by you. A second person must approve before it goes.'); return true; }
  if (action === 'seq-countersign') { await run(() => API(url('sequence/approve'), { method: 'POST', body: JSON.stringify({ confirmSecond: true }) }), 'Approved by a second person — Chelo will send it and follow up.'); return true; }
  if (action === 'seq-stop') { if (!confirm('Stop this sequence? Remaining follow-ups will be cancelled.')) return true; await run(() => API(url('sequence/stop'), { method: 'POST', body: '{}' }), 'Sequence stopped.'); return true; }
  if (action === 'triage-apply') {
    const body = { category: button.dataset.category, redirectName: $('#triage-redirect-name')?.value || '', redirectTitle: $('#triage-redirect-title')?.value || '', resumeOn: $('#triage-resume-on')?.value || '', note: $('#triage-note')?.value || '' };
    if (body.category === 'wrong-person' && !body.redirectName) { toast('Add the redirect name first so it can be captured as a candidate.', true); return true; }
    if (body.category === 'opt-out' && !confirm('Suppress this contact workspace-wide? This cannot be undone from the UI.')) return true;
    await run(() => API(url('triage'), { method: 'POST', body: JSON.stringify(body) }), r => `Triaged as ${wbTriageLabel(r.triage.category)}${r.queue ? ` · ${r.queue} left in queue` : ' · queue clear'}`);
    return true;
  }
  return false;
}

// ---- Batch 3: data quality + contact waterfall ----
const DQ_GRADE_CLS = { A: 'pill-won', B: 'pill-researched', C: 'pill-pending', D: 'pill-not-proceeding' };
function dqGradePill(q) { if (!q) return ''; return `<span class="stage-pill ${DQ_GRADE_CLS[q.grade] || 'pill-new'}" title="Freshness ${q.freshness?.score ?? '–'} · completeness ${q.completeness?.score ?? '–'} · verification ${esc(q.verifyStatus || '')}">${svgIcon('database')}Data ${esc(q.grade)} · ${q.score}</span>`; }
function wbQualityRow(lead) {
  const q = lead.dataQuality; if (!q) return '';
  const reasons = [...(q.freshness?.reasons || []), ...(q.completeness?.missing?.length ? [`missing ${q.completeness.missing.slice(0, 4).join(', ')}`] : [])];
  return `<div class="wb-quality">${dqGradePill(q)}${q.reverifyDue ? `<span class="stage-pill pill-pending">${svgIcon('clock')}Re-verify due</span>` : ''}${lead.contactSource?.kind === 'waterfall' ? `<span class="stage-pill pill-new">${svgIcon('users')}Contact via ${esc(lead.contactSource.hops.join(' + '))}</span>` : ''}${reasons.length ? `<small class="subtle">${esc(reasons.join(' · '))}</small>` : '<small class="subtle">Verified, complete and fresh.</small>'}</div>`;
}
const HOP_STATUS = { done: ['pill-won', 'checked'], empty: ['pill-new', 'nothing found'], skipped: ['pill-pending', 'skipped'] };
function wbMailboxPanel(lead) {
  const ms = lead.mailboxSearch; if (!ms) return '';
  const statusLabel = { published: 'Published mailbox found', 'pattern-verified': 'Pattern mailbox confirmed by mail server', unconfirmed: 'No published mailbox — pattern guesses unconfirmed', 'none-published': 'Site reachable, no generic mailbox published', unreachable: 'Website unreachable' }[ms.status] || ms.status;
  const rows = (ms.candidates || []).map(c => `<li class="wf-row"><div><strong>${esc(c.email)}</strong><small class="subtle">${esc(c.kind)}${c.pattern ? '' : ` · seen on ${esc((c.sources || []).map(u => u.replace(/^https?:\/\/(www\.)?/, '')).join(', ') || 'site')}`} · ${esc(c.verification?.status || 'unverified')}${c.verification?.reason ? ` — ${esc(c.verification.reason)}` : ''}</small></div>${lead.email === c.email ? `<span class="stage-pill pill-won">${svgIcon('checkCircle')}In use</span>` : ['invalid', 'undeliverable'].includes(c.verification?.status) ? `<span class="stage-pill pill-lost">${svgIcon('xCircle')}Dead</span>` : `<button type="button" class="button button-ghost button-small" data-action="wb-use-mailbox" data-id="${esc(lead.id)}" data-email="${esc(c.email)}">${svgIcon('check')}Use this</button>`}</li>`).join('');
  return `<div class="wb-waterfall"><div class="wb-waterfall-head"><h4>${svgIcon('mail')}Published generic mailbox <small class="subtle">${esc(statusLabel)} · ${(ms.pages || []).length} page(s) checked · ${isoDate(ms.ranAt)}</small></h4></div>${rows ? `<ul class="wf-list">${rows}</ul>` : '<p class="subtle">No candidates.</p>'}<p class="subtle wf-note">Only role-based addresses on the organisation's own domain (csi@, foundation@, info@…) are captured — never personal addresses. Pattern guesses are only auto-used when the mail server confirms them.</p></div>`;
}
function wbWaterfallPanel(lead) {
  const wf = lead.contactLeads; if (!wf) return '';
  const hops = wf.hops.map(h => { const [cls, word] = HOP_STATUS[h.status] || HOP_STATUS.empty; return `<span class="stage-pill ${cls}" title="${esc(h.reason || (h.urls || []).join('\n') || '')}">${esc(h.label)} · ${h.status === 'done' ? `${h.people} found` : esc(h.reason || word)}</span>`; }).join('');
  const rows = wf.contacts.length ? wf.contacts.map(c => `<li class="wf-contact wf-${esc(c.status)}">
      <div class="wf-main"><strong>${esc(c.name)}</strong><span class="subtle">${esc(c.title || 'title not stated')}</span><small class="subtle">${c.hops.map(h => esc(h)).join(' + ')} · ${Math.round(c.confidence * 100)}% ${esc(c.level)}${c.sources[0] ? ` · <a class="text-link" href="${esc(c.sources[0])}" target="_blank" rel="noopener noreferrer">source ${svgIcon('external')}</a>` : ''}</small></div>
      <div class="wf-actions">${c.status === 'pending' ? `<button type="button" class="button button-primary button-small" data-action="wb-wf-decide" data-id="${esc(lead.id)}" data-contact="${esc(c.id)}" data-decision="accept">${svgIcon('check')}${lead.contactName ? 'Replace contact' : 'Set as contact'}</button><button type="button" class="button button-secondary button-small" data-action="wb-wf-decide" data-id="${esc(lead.id)}" data-contact="${esc(c.id)}" data-decision="candidate">${svgIcon('plus')}Candidate</button><button type="button" class="button button-ghost button-small" data-action="wb-wf-decide" data-id="${esc(lead.id)}" data-contact="${esc(c.id)}" data-decision="reject">${svgIcon('xCircle')}Not relevant</button>` : `<span class="stage-pill ${c.status === 'accepted' ? 'pill-won' : 'pill-new'}">${esc(c.status)}</span>`}</div>
    </li>`).join('') : '<li class="subtle">No publicly listed CSI / foundation / transformation people were found. Try adding the website in Edit details, or configure a search provider in Settings to climb the report and leadership rungs.</li>';
  return `<div class="wb-waterfall"><div class="wb-waterfall-head"><h4>${svgIcon('users')}Public contact leads <small class="subtle">names & titles only · ran ${isoDate(wf.ranAt)} in ${wf.durationMs}ms</small></h4><div class="chip-row">${hops}</div></div><ul class="wf-list">${rows}</ul><p class="subtle wf-note">POPIA: emails and phone numbers are never harvested. Add a public work address yourself once the right person is confirmed.</p></div>`;
}
async function loadDataQuality(force = false) {
  if (state.dq.loading) return;
  if (state.dq.data && !force) return;
  state.dq.loading = true; renderApp();
  try { state.dq.data = await API('/api/data'); state.dq.error = ''; }
  catch (err) { state.dq.error = err.message; }
  finally { state.dq.loading = false; renderApp(); }
}
function dataQualityView(embedded = false) {
  const d = state.dq.data;
  const head = embedded ? '' : pageHead('Data quality', 'Data engine', 'Identity resolution at ingest, a merge-review queue instead of silent duplicates, freshness scoring with automatic re-verification after 90 days, and a public-contact waterfall with per-hop confidence.', `<button type="button" class="button button-secondary" data-action="dq-refresh">${svgIcon('refresh')}Refresh</button><button type="button" class="button button-primary" data-action="dq-reverify" ${state.dq.busy ? 'disabled' : ''}>${svgIcon('checkCircle')}${state.dq.busy ? 'Re-verifying…' : 'Re-verify stale now'}</button>`);
  if (!d) { loadDataQuality(); return `${head}<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('database')}</div><p>${state.dq.error ? esc(state.dq.error) : 'Scoring records…'}</p></div>`; }
  const tiles = metricCard('Average data score', String(d.averageScore), `${d.totals.leads} pipeline records · A ${d.gradeCounts.A || 0} · B ${d.gradeCounts.B || 0} · C ${d.gradeCounts.C || 0} · D ${d.gradeCounts.D || 0}`, 'database')
    + metricCard('Re-verify due', String(d.reverifyDue), `mailboxes older than ${d.reverifyAfterDays} days`, 'checkCircle', d.reverifyDue ? 'weekly sweep + button' : '', d.reverifyDue > 0)
    + metricCard('Stale or incomplete', String(d.stale + d.incomplete), `${d.stale} stale · ${d.incomplete} missing key fields`, 'clock', '', (d.stale + d.incomplete) > 0)
    + metricCard('Merge reviews', String(d.openMergeReviews), 'possible duplicates waiting for a human', 'users', d.openMergeReviews ? 'decide below' : '', d.openMergeReviews > 0);
  const reviews = d.mergeReviews.length ? d.mergeReviews.map(r => `<li class="dq-review">
      <div class="dq-review-main"><div class="dq-pair"><strong>${esc(r.recordCompany)}</strong><span class="subtle">${esc(r.recordType)}</span><span class="dq-vs">≈</span><strong>${esc(r.matchCompany)}</strong><span class="subtle">${esc(r.matchType)}</span></div><small class="subtle">${Math.round(r.score * 100)}% · ${esc(r.reasons.join('; '))} · opened ${isoDate(r.createdAt)} by ${esc(r.createdBy || 'system')}</small></div>
      <div class="dq-review-actions"><button type="button" class="button button-primary button-small" data-action="dq-merge" data-id="${esc(r.id)}" data-primary="${esc(r.matchType === 'leads' ? r.matchId : r.recordType === 'leads' ? r.recordId : r.matchId)}">${svgIcon('check')}Merge</button><button type="button" class="button button-secondary button-small" data-action="dq-keep" data-id="${esc(r.id)}">${svgIcon('users')}Keep both</button><button type="button" class="button button-ghost button-small" data-action="dq-dismiss" data-id="${esc(r.id)}">${svgIcon('xCircle')}Dismiss</button></div>
    </li>`).join('') : `<li class="subtle">No open merge reviews. New records are compared by registrable domain, email and fuzzy organisation name at the moment they enter.</li>`;
  const attention = d.attention.length ? d.attention.map(a => `<li class="dq-att"><span class="stage-pill ${DQ_GRADE_CLS[a.grade] || 'pill-new'}">${esc(a.grade)} · ${a.score}</span><div><strong>${esc(a.company)}</strong><small class="subtle">${esc(a.contactName || 'no contact')}${a.email ? ` · ${esc(a.email)}` : ''} · ${esc(a.reasons.join(' · '))}</small></div><button type="button" class="button button-ghost button-small" data-action="open-lead" data-id="${esc(a.id)}">${svgIcon('eye')}Open</button></li>`).join('') : '<li class="subtle">Everything is verified, complete and fresh.</li>';
  return `${head}
  <section class="metric-grid dlv-tiles">${tiles}</section>
  <div class="dlv-grid">
    <section class="panel"><div class="panel-head"><h3>${svgIcon('users')}Merge reviews</h3><span class="subtle">Merging keeps the worked record, fills its empty fields from the duplicate, re-points events and bookings, then removes the duplicate.</span></div><ul class="dq-list">${reviews}</ul></section>
    <section class="panel"><div class="panel-head"><h3>${svgIcon('clock')}Needs attention</h3><span class="subtle">Lowest scores first · re-verification runs weekly (Mon 06:30 SAST) and on demand.</span></div><ul class="dq-list">${attention}</ul></section>
  </div>`;
}
async function dqAction(action, button) {
  const id = button.dataset.id;
  if (action === 'dq-refresh') { await loadDataQuality(true); return true; }
  if (action === 'dq-reverify') { state.dq.busy = true; renderApp(); try { const r = await API('/api/data/reverify', { method: 'POST', body: JSON.stringify({ limit: 10 }) }); toast(`Re-verified ${r.checked} mailbox(es)${r.remaining ? ` · ${r.remaining} still due` : ''}.`); } catch (err) { toast(err.message, true); } finally { state.dq.busy = false; await loadDataQuality(true); await refresh(); } return true; }
  if (['dq-merge', 'dq-keep', 'dq-dismiss'].includes(action)) {
    const body = { action: action.slice(3) }; if (body.action === 'merge') { body.primaryId = button.dataset.primary; if (!confirm('Merge these records? The duplicate will be removed after its empty-field values are copied across.')) return true; }
    try { const r = await API(`/api/data/merge-reviews/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) }); state.dq.data = r.summary; toast(body.action === 'merge' ? `Merged · filled ${r.review.resolution.filled.length ? r.review.resolution.filled.join(', ') : 'no fields'}.` : 'Kept as separate records.'); await refresh(); }
    catch (err) { toast(err.message, true); }
    return true;
  }
  return false;
}

// ---- Batch 4: signals + fit ----
const FYE_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FIT_BAND_CLS = { strong: 'pill-won', good: 'pill-researched', fair: 'pill-pending', weak: 'pill-not-proceeding' };
const WINDOW_CLS = { budgeting: 'win-budgeting', allocation: 'win-allocation', closing: 'win-closing', 'mid-year': 'win-mid', 'grant-window': 'win-budgeting', outside: 'win-mid', unknown: 'win-unknown' };
function fitPill(fit) { if (!fit) return ''; return `<span class="fit-pill ${FIT_BAND_CLS[fit.band] || 'pill-new'}" title="${esc(fit.weakest ? `Weakest: ${fit.weakest.key} — ${fit.weakest.reason}` : '')}">${svgIcon('target')}${fit.score}</span>${fit.window?.known || fit.window?.phase === 'grant-window' ? `<span class="win-chip ${WINDOW_CLS[fit.window.phase] || ''}" title="${esc(fit.window.detail || '')}">${esc(fit.window.label)}</span>` : ''}`; }
const FIT_LABELS = { sector: 'Sector match', province: 'Province', sed: 'B-BBEE SED', window: 'Approach window', warmth: 'Warmth' };
function wbFitPanel(lead) {
  const fit = lead.fit; if (!fit) return '';
  const w = fit.window || {};
  const bars = Object.entries(fit.components).map(([k, c]) => `<div class="fit-row"><span class="fit-label">${esc(FIT_LABELS[k] || k)}</span><span class="fit-bar"><span class="fit-bar-fill fit-${c.score >= 80 ? 'hi' : c.score >= 55 ? 'mid' : 'lo'}" style="width:${c.score}%"></span></span><span class="fit-val">${c.score}</span><small class="subtle">${esc(c.reason)}</small></div>`).join('');
  const fyeSel = `<label class="form-group fit-fye"><span>Financial year-end ${lead.fyeSource === 'research' ? `<small class="subtle">· inferred from research${lead.fyeEvidence?.text ? ` (“${esc(lead.fyeEvidence.text)}”)` : ''} — confirm or correct</small>` : lead.fyeSource === 'staff' ? '<small class="subtle">· set by staff</small>' : ''}</span><select class="form-control" data-wb-fye="${esc(lead.id)}"><option value="">Unknown</option>${FYE_MONTHS.map((m, i) => `<option value="${i + 1}" ${Number(lead.financialYearEnd) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>`;
  const timeline = w.known && w.budgeting && w.allocation ? `<div class="fit-window ${WINDOW_CLS[w.phase] || ''}"><strong>${esc(w.label)}</strong><span>${esc(w.detail || '')}</span><small class="subtle">Budgeting ${esc(w.budgeting.from)} → ${esc(w.budgeting.to)} · Allocation ${esc(w.allocation.from)} → ${esc(w.allocation.to)}${w.daysToNextBudgeting > 0 ? ` · next budgeting window opens in ${w.daysToNextBudgeting} days` : ''}</small></div>` : w.phase === 'grant-window' || w.phase === 'outside' ? `<div class="fit-window ${WINDOW_CLS[w.phase] || ''}"><strong>${esc(w.label)}</strong><span>Using the grant window months set on this record.</span></div>` : `<div class="fit-window win-unknown"><strong>Approach timing unknown</strong><span>Add the financial year-end: SA CSI budgets (≈1% NPAT for B-BBEE SED) are planned 2–5 months before year-end and allocated in the first quarter after it.</span></div>`;
  return `<div class="wb-fit"><div class="wb-fit-head"><h4>${svgIcon('target')}Fit score <span class="fit-pill ${FIT_BAND_CLS[fit.band]}">${fit.score} · ${esc(fit.band)}</span></h4><small class="subtle">weighted geometric mean · sector 30% · window 25% · warmth 20% · province 15% · SED 10% — a weak factor drags the whole score</small></div>${bars}<div class="fit-timing">${fyeSel}${timeline}</div></div>`;
}

function signalsPanel() {
  const leads = (state.data.leads || []).filter(l => l.fit && !l.doNotContact && l.stage !== 'Won');
  const inWindow = leads.filter(l => ['budgeting', 'allocation', 'grant-window'].includes(l.fit.window?.phase)).sort((a, b) => b.fit.score - a.fit.score).slice(0, 6);
  const soon = leads.filter(l => l.fit.window?.known && l.fit.window.phase !== 'budgeting' && l.fit.window.daysToNextBudgeting <= 45).sort((a, b) => a.fit.window.daysToNextBudgeting - b.fit.window.daysToNextBudgeting).slice(0, 4);
  const missing = leads.filter(l => !l.fit.window?.known && l.fit.window?.phase !== 'grant-window').length;
  const row = l => `<li class="sig-row"><div><strong>${esc(l.company)}</strong><small class="subtle">${esc(l.project || 'no project yet')}${l.fit.window?.known ? ` · FYE ${esc(l.fit.window.monthLabel)}` : ''}</small></div>${fitPill(l.fit)}<button type="button" class="button button-ghost button-small" data-action="open-lead" data-id="${esc(l.id)}">${svgIcon('eye')}Open</button></li>`;
  return `<section class="panel sig-panel"><div class="panel-head"><h3>${svgIcon('target')}Approach windows</h3><span class="subtle">Deterministic from each company's financial year-end — budgets are set 2–5 months before FYE and allocated in the quarter after.${missing ? ` ${missing} record(s) still need an FYE.` : ''}</span></div>
    <div class="sig-grid"><div><h4>In window now</h4><ul class="sig-list">${inWindow.length ? inWindow.map(row).join('') : '<li class="subtle">No funders are in a budgeting or allocation window right now.</li>'}</ul></div>
    <div><h4>Opening within 45 days</h4><ul class="sig-list">${soon.length ? soon.map(l => `<li class="sig-row"><div><strong>${esc(l.company)}</strong><small class="subtle">budgeting opens ${esc(l.fit.window.nextBudgetingOpens)} · in ${l.fit.window.daysToNextBudgeting} days</small></div>${fitPill(l.fit)}<button type="button" class="button button-ghost button-small" data-action="open-lead" data-id="${esc(l.id)}">${svgIcon('eye')}Open</button></li>`).join('') : '<li class="subtle">Nothing opening in the next 45 days.</li>'}</ul></div></div></section>`;
}

// ---- Batch 5: relationship memory + stewardship ----
const HEALTH_CLS = { warm: 'pill-won', cooling: 'pill-interested', cold: 'pill-new', 'at-risk': 'pill-lost' };
const TL_ICON = { created: 'plus', research: 'search', 'email-out': 'send', 'email-in': 'mail', signal: 'eye', meeting: 'calendar', call: 'phone', 'site-visit': 'building', event: 'calendar', 'report-sent': 'upload', 'thank-you': 'check', note: 'edit', pledge: 'trend', stewardship: 'checkCircle', won: 'partners', activity: 'activity' };
function healthPill(h) { if (!h) return ''; return `<span class="stage-pill ${HEALTH_CLS[h.status] || 'pill-new'}" title="${esc((h.reasons || []).join(' · '))}">${esc(h.status)}</span>`; }
function relDate(v) { return v ? new Date(v).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
function dueLabel(iso) { if (!iso) return '—'; const d = Math.ceil((new Date(iso) - Date.now()) / 86400000); return d < 0 ? `<span class="rel-overdue">${-d}d overdue</span>` : d === 0 ? 'today' : `in ${d}d`; }
async function loadRelationships(force = false) {
  if (state.rel.loading) return; if (state.rel.summary && !force) return;
  state.rel.loading = true; if (!state.rel.summary) renderApp();
  try { state.rel.summary = await API('/api/relationships'); state.rel.error = ''; } catch (err) { state.rel.error = err.message; } finally { state.rel.loading = false; renderApp(); }
}
async function openRelationship(id, tab = 'timeline') {
  state.rel.viewId = id; state.rel.view = null; state.rel.tab = tab; state.modal = { type: 'relationship', id }; renderApp();
  try { state.rel.view = await API(`/api/relationships/${encodeURIComponent(id)}`); } catch (err) { toast(err.message, true); state.modal = null; }
  renderApp();
}
function relationshipsView() {
  const r = state.rel.summary;
  const head = pageHead('Partners', 'Partners', 'Who already funds us — their people, pledges and when to be in touch next.', `<button type="button" class="button button-secondary" data-action="rel-refresh">${svgIcon('refresh')}Refresh</button><button type="button" class="button button-primary" data-action="rel-tick" ${state.rel.busy ? 'disabled' : ''}>${svgIcon('calendar')}${state.rel.busy ? 'Scheduling…' : 'Schedule stewardship'}</button>`);
  if (!r) { loadRelationships(); return `${head}<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('partners')}</div><p>${state.rel.error ? esc(state.rel.error) : 'Loading relationships…'}</p></div>`; }
  const q = state.query.trim().toLowerCase();
  const partners = r.partners.filter(p => !q || [p.company, p.owner, p.introducer].join(' ').toLowerCase().includes(q));
  const queue = r.stewardship.queue.slice(0, 12);
  const taskRow = t => `<li class="rel-task ${t.overdue ? 'is-overdue' : ''}"><span class="rel-task-icon">${svgIcon(TL_ICON[t.kind] || 'clock')}</span><div class="rel-task-main"><strong>${esc(t.title)}</strong><small class="subtle">${esc(t.company)} · due ${relDate(t.dueAt)} (${dueLabel(t.dueAt)})${t.detail ? ` · ${esc(t.detail)}` : ''}</small>${t.why ? `<small class="rel-why">${esc(t.why)}</small>` : ''}</div><div class="rel-task-actions"><button type="button" class="button button-primary button-small" data-action="rel-task" data-id="${esc(t.id)}" data-op="done">${svgIcon('check')}Done</button><button type="button" class="button button-ghost button-small" data-action="rel-task" data-id="${esc(t.id)}" data-op="snooze">${svgIcon('clock')}+7d</button><button type="button" class="button button-ghost button-small" data-action="rel-task" data-id="${esc(t.id)}" data-op="skip">${svgIcon('close')}Skip</button><button type="button" class="button button-ghost button-small" data-action="rel-open" data-id="${esc(t.partnerId)}">${svgIcon('eye')}</button></div></li>`;
  const cards = partners.map(p => `<article class="partner-card rel-card"><div class="partner-card-head"><div class="partner-logo">${initials(p.company)}</div><div><h3>${esc(p.company)}</h3><span>${esc(p.status || 'Active')} · since ${relDate(p.partnerSince)}</span></div><div class="rel-card-pills">${healthPill(p.health)}</div></div>
    <div class="rel-card-grid"><div><small>Last touch</small><strong>${p.lastTouch ? esc(relDate(p.lastTouch.at)) : 'never'}</strong><span class="subtle">${p.lastTouch ? esc(p.lastTouch.title) : 'log a call, meeting or note'}</span></div><div><small>Next due</small><strong>${p.nextDue ? dueLabel(p.nextDue) : '—'}</strong><span class="subtle">${p.openTasks} open task${p.openTasks === 1 ? '' : 's'}</span></div><div><small>Renewal</small><strong>${p.renewal ? esc(relDate(p.renewal.at)) : '—'}</strong><span class="subtle">${p.renewal ? esc(p.renewal.basis) : 'add FYE or renewal date'}</span></div><div><small>Pledged · received</small><strong>${shortMoney(p.pledgeTotals.pledged || p.amount)} · ${shortMoney(p.pledgeTotals.received)}</strong><span class="subtle">${p.pledgeTotals.overdue ? `<span class="rel-overdue">${shortMoney(p.pledgeTotals.overdue)} overdue</span>` : p.pledgeTotals.outstanding ? `${shortMoney(p.pledgeTotals.outstanding)} outstanding` : 'nothing outstanding'}</span></div></div>
    <div class="rel-card-foot"><span class="subtle">${svgIcon('users')}${p.people} ${p.people === 1 ? 'person' : 'people'} · owner ${esc(p.owner || 'unassigned')}${p.introducer ? ` · via ${esc(p.introducer)}` : ''}</span><div><button type="button" class="button button-secondary button-small" data-action="rel-open" data-id="${esc(p.id)}">${svgIcon('activity')}Open</button><button type="button" class="button button-ghost button-small" data-action="edit-partner" data-id="${esc(p.id)}">${svgIcon('edit')}Edit</button></div></div></article>`).join('');
  return `${head}
    <section class="metric-grid">${metricCard('Partners', String(r.totals.partners), `${r.totals.warm} warm · ${r.totals.cooling} cooling · ${r.totals.cold} cold${r.totals.atRisk ? ` · ${r.totals.atRisk} at risk` : ''}`, 'partners')}${metricCard('Stewardship due', String(r.stewardship.dueThisWeek + r.stewardship.overdue), `${r.stewardship.overdue} overdue · ${r.stewardship.dueThisWeek} this week · ${r.stewardship.open} open`, 'calendar')}${metricCard('Pledged · received', `${shortMoney(r.pledges.pledged)} · ${shortMoney(r.pledges.received)}`, r.pledges.overdue ? `${shortMoney(r.pledges.overdue)} overdue` : `${shortMoney(r.pledges.outstanding)} outstanding`, 'trend')}${metricCard('Org graph', `${r.graph.orgs} orgs`, `${r.graph.linkedFoundations} foundation links · ${r.graph.people} people · ${r.graph.edges} edges`, 'link')}</section>
    <section class="panel rel-queue"><div class="panel-head"><div><h3>Stewardship queue</h3><p class="subtle">Cadence: thank-you +2d · impact plan +14d · site visit +60d · quarterly updates · annual report · renewal at FYE −4 months · pledge follow-ups. Completing a task logs a touch on the timeline.</p></div>${r.renewals.length ? `<span class="pill-new stage-pill">${r.renewals.length} renewal${r.renewals.length === 1 ? '' : 's'} within 120 days</span>` : ''}</div>${queue.length ? `<ul class="rel-task-list">${queue.map(taskRow).join('')}</ul>${r.stewardship.open > queue.length ? `<p class="subtle">+${r.stewardship.open - queue.length} more scheduled.</p>` : ''}` : `<div class="empty-state small"><p>Nothing due. New partners get a plan the moment a prospect is marked Won.</p></div>`}</section>
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="lead-search" type="search" placeholder="Search partners, owners or introducers…" value="${esc(state.query)}" /></label></div><div class="control-right"><span class="subtle">${partners.length} partner${partners.length === 1 ? '' : 's'} · sorted by health, then next due</span></div></div>
    ${partners.length ? `<div class="partners-grid">${cards}</div>` : `<div class="empty-state"><div class="empty-state-icon">${svgIcon('partners')}</div><strong>No partner records yet</strong><p>Move a prospect to Won and Chelo creates the partner profile, carries the introducer and foundation links across, and schedules the stewardship cadence.</p><button class="button button-primary" data-view="pipeline">${svgIcon('pipeline')} Open board</button></div>`}`;
}
function relationshipModal() {
  const v = state.rel.view;
  if (!v) return modalFrame('Relationship', 'Loading…', `<div class="empty-state small"><p>Loading timeline, people and pledges…</p></div>`, '', false, 'modal-wide');
  const tab = state.rel.tab; const tabs = [['timeline', 'Timeline', v.timeline.length, 'activity'], ['people', 'People', v.people.length, 'users'], ['pledges', 'Pledges', v.pledges.length, 'trend'], ['stewardship', 'Stewardship', v.tasks.filter(t => t.status === 'open').length, 'calendar'], ['graph', 'Org graph', (v.graph?.foundations?.length || 0) + (v.graph?.projects?.length || 0), 'link']];
  const tabBar = `<div class="rel-tabs">${tabs.map(([k, l, n, ic]) => `<button type="button" class="rel-tab ${tab === k ? 'active' : ''}" data-action="rel-tab" data-tab="${k}">${svgIcon(ic)}${l}<span>${n}</span></button>`).join('')}</div>`;
  const summary = `<div class="rel-summary"><div>${healthPill(v.health)}<small class="subtle">${esc((v.health.reasons || []).join(' · '))}</small></div><div><small>Last touch</small><strong>${v.lastTouch ? `${esc(relDate(v.lastTouch.at))} · ${esc(v.lastTouch.title)}` : 'none recorded'}</strong></div><div><small>Next due</small><strong>${v.nextDue ? `${esc(relDate(v.nextDue))} (${dueLabel(v.nextDue)})` : '—'}</strong></div><div><small>Renewal</small><strong>${v.renewal ? `${esc(relDate(v.renewal.at))} · ${esc(v.renewal.basis)}` : 'add FYE or renewal date'}</strong></div><div><small>Introduced by</small><strong>${esc(v.introducer || '—')}${v.introducedVia ? ` <span class="subtle">· ${esc(v.introducedVia)}</span>` : ''}</strong></div></div>`;
  let body = '';
  if (tab === 'timeline') {
    body = `<form class="rel-inline-form" data-form="rel-touch" data-id="${esc(v.id)}"><select class="form-control" name="kind">${['call', 'meeting', 'site-visit', 'event', 'report-sent', 'thank-you', 'note'].map(k => `<option value="${k}">${k.replace('-', ' ')}</option>`).join('')}</select><input class="form-control" name="summary" placeholder="What happened? (e.g. Call with Sipho — wants Q4 report before renewal)" required /><input class="form-control" name="personName" placeholder="With whom" /><input class="form-control" name="nextDueAt" type="date" title="Agreed next step date" /><input class="form-control" name="nextAction" placeholder="Agreed next step" /><button type="submit" class="button button-primary button-small">${svgIcon('plus')}Log touch</button></form>
      <ol class="rel-timeline">${v.timeline.length ? v.timeline.map(r => `<li class="tl-row tl-${esc(r.kind)}"><span class="tl-icon">${svgIcon(TL_ICON[r.kind] || 'activity')}</span><div><strong>${esc(r.title)}</strong>${r.detail ? `<span>${esc(r.detail)}</span>` : ''}<small class="subtle">${esc(relDate(r.at))} ${new Date(r.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}${r.actor ? ` · ${esc(r.actor)}` : ''}</small></div></li>`).join('') : '<li class="subtle">No events yet.</li>'}</ol>`;
  } else if (tab === 'people') {
    body = `<form class="rel-inline-form" data-form="rel-person" data-id="${esc(v.id)}"><input class="form-control" name="name" placeholder="Full name" required /><input class="form-control" name="title" placeholder="Title" /><select class="form-control" name="role">${['csi-lead', 'decision-maker', 'champion', 'introducer', 'finance', 'communications', 'other'].map(k => `<option value="${k}">${k.replace('-', ' ')}</option>`).join('')}</select><input class="form-control" name="email" type="email" placeholder="Email (kept private, never sent to AI)" /><button type="submit" class="button button-primary button-small">${svgIcon('plus')}Add person</button></form>
      ${v.people.length ? `<ul class="rel-people">${v.people.map(p => `<li><span class="avatar">${initials(p.name)}</span><div><strong>${esc(p.name)}</strong><span class="subtle">${esc(p.title || '')}${p.email ? ` · ${esc(p.email)}` : ''}</span></div><span class="stage-pill pill-new">${esc(p.role.replace('-', ' '))}</span><button type="button" class="button button-ghost button-small" data-action="rel-person-remove" data-id="${esc(p.id)}">${svgIcon('close')}</button></li>`).join('')}</ul>` : '<p class="subtle">No people recorded yet. Capture the CSI lead, the decision-maker and whoever opened the door — this is the memory that survives staff turnover.</p>'}`;
  } else if (tab === 'pledges') {
    const t = v.pledgeTotals;
    body = `<div class="rel-pledge-totals"><div><small>Pledged</small><strong>${money(t.pledged)}</strong></div><div><small>Received</small><strong>${money(t.received)}</strong></div><div><small>Outstanding</small><strong>${money(t.outstanding)}</strong></div><div><small>Overdue</small><strong class="${t.overdue ? 'rel-overdue' : ''}">${money(t.overdue)}</strong></div></div>
      <form class="rel-inline-form" data-form="rel-pledge" data-id="${esc(v.id)}"><input class="form-control" name="amount" type="number" min="0" step="1000" placeholder="Amount (ZAR)" required /><select class="form-control" name="period"><option value="once">once-off</option><option value="annual">annual</option><option value="multi-year">multi-year</option></select><select class="form-control" name="projectId"><option value="">Project…</option>${(state.data.projects || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><input class="form-control" name="pledgedAt" type="date" title="Pledged on" /><input class="form-control" name="dueAt" type="date" title="Payment due" /><input class="form-control" name="renewalAt" type="date" title="Renewal date" /><input class="form-control" name="reference" placeholder="PO / reference" /><button type="submit" class="button button-primary button-small">${svgIcon('plus')}Record pledge</button></form>
      ${v.pledges.length ? `<table class="table rel-table"><thead><tr><th>Pledge</th><th>Project</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${v.pledges.map(p => `<tr><td><strong>${money(p.amount)}</strong><br><small class="subtle">${esc(p.period)} · pledged ${esc(relDate(p.pledgedAt))}${p.reference ? ` · ${esc(p.reference)}` : ''}</small></td><td>${esc(p.project || '—')}</td><td>${p.dueAt ? esc(relDate(p.dueAt)) : '—'}${p.renewalAt ? `<br><small class="subtle">renews ${esc(relDate(p.renewalAt))}</small>` : ''}</td><td><span class="stage-pill ${p.status === 'received' ? 'pill-won' : p.status === 'overdue' ? 'pill-lost' : p.status === 'cancelled' ? 'pill-new' : 'pill-interested'}">${esc(p.status)}</span>${p.receivedAt ? `<br><small class="subtle">${esc(relDate(p.receivedAt))}</small>` : ''}</td><td class="rel-row-actions">${['received', 'cancelled'].includes(p.status) ? '' : `<button type="button" class="button button-primary button-small" data-action="rel-pledge" data-id="${esc(p.id)}" data-status="received">${svgIcon('check')}Received</button><button type="button" class="button button-ghost button-small" data-action="rel-pledge" data-id="${esc(p.id)}" data-status="invoiced">${svgIcon('upload')}Invoiced</button><button type="button" class="button button-ghost button-small" data-action="rel-pledge" data-id="${esc(p.id)}" data-status="cancelled">${svgIcon('close')}Cancel</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="subtle">No pledges recorded. Recording a pledge with a due date arms the payment follow-up and the renewal conversation automatically.</p>'}`;
  } else if (tab === 'stewardship') {
    const open = v.tasks.filter(t => t.status === 'open'); const closed = v.tasks.filter(t => t.status !== 'open').slice(-8).reverse();
    body = `${v.isPartner ? '' : '<div class="note-callout"><span class="note-callout-icon">' + svgIcon('info') + '</span><span>Stewardship cadences start when this prospect is marked <strong>Won</strong>.</span></div>'}
      <ul class="rel-task-list">${open.length ? open.map(t => `<li class="rel-task ${new Date(t.dueAt) < Date.now() ? 'is-overdue' : ''}"><span class="rel-task-icon">${svgIcon(TL_ICON[t.kind] || 'clock')}</span><div class="rel-task-main"><strong>${esc(t.title)}</strong><small class="subtle">due ${esc(relDate(t.dueAt))} (${dueLabel(t.dueAt)})${t.detail ? ` · ${esc(t.detail)}` : ''}</small>${t.why ? `<small class="rel-why">${esc(t.why)}</small>` : ''}</div><div class="rel-task-actions"><button type="button" class="button button-primary button-small" data-action="rel-task" data-id="${esc(t.id)}" data-op="done">${svgIcon('check')}Done</button><button type="button" class="button button-ghost button-small" data-action="rel-task" data-id="${esc(t.id)}" data-op="snooze">${svgIcon('clock')}+7d</button><button type="button" class="button button-ghost button-small" data-action="rel-task" data-id="${esc(t.id)}" data-op="skip">${svgIcon('close')}Skip</button></div></li>`).join('') : '<li class="subtle">No open stewardship tasks.</li>'}</ul>
      ${closed.length ? `<h4 class="rel-subhead">Recently completed</h4><ul class="rel-task-list muted">${closed.map(t => `<li class="rel-task"><span class="rel-task-icon">${svgIcon(t.status === 'done' ? 'checkCircle' : 'close')}</span><div class="rel-task-main"><strong>${esc(t.title)}</strong><small class="subtle">${esc(t.status)} ${esc(relDate(t.doneAt))}${t.doneBy ? ` · ${esc(t.doneBy)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</small></div></li>`).join('')}</ul>` : ''}`;
  } else {
    const g = v.graph;
    body = g ? `<div class="org-graph"><div class="og-node og-org ${g.org.kind === 'foundation' ? 'is-foundation' : ''}"><small>${g.org.kind === 'foundation' ? 'Foundation / trust' : 'Company'}</small><strong>${esc(g.org.label)}</strong><span class="subtle">${esc(g.org.sector || '')}${g.org.province ? ` · ${esc(g.org.province)}` : ''} · ${g.org.records.length} record${g.org.records.length === 1 ? '' : 's'} merged</span></div>
      <div class="og-branches">
        <div class="og-branch"><h4>${svgIcon('building')}Foundations & parents</h4>${g.foundations.length ? g.foundations.map(f => `<div class="og-node"><small>${f.direction === 'child' ? 'operates' : 'parent company'}</small><strong>${esc(f.label)}</strong></div>`).join('') : `<p class="subtle">${v.foundationName || v.parentCompany ? `“${esc(v.foundationName || v.parentCompany)}” named but not yet a record — add it as a prospect to link.` : 'Add the linked foundation on the record to connect the graph.'}</p>`}</div>
        <div class="og-branch"><h4>${svgIcon('users')}People</h4>${g.people.length ? g.people.map(p => `<div class="og-node"><small>${esc(p.role.replace('-', ' '))}</small><strong>${esc(p.label)}</strong><span class="subtle">${esc(p.title || '')}</span></div>`).join('') : '<p class="subtle">No people linked.</p>'}</div>
        <div class="og-branch"><h4>${svgIcon('target')}Projects</h4>${g.projects.length ? g.projects.map(p => `<div class="og-node"><small>${esc(p.relation || 'linked')}</small><strong>${esc(p.label)}</strong></div>`).join('') : '<p class="subtle">No project linked.</p>'}</div>
        <div class="og-branch"><h4>${svgIcon('trend')}Pledges</h4>${g.pledges.length ? g.pledges.map(p => `<div class="og-node"><small>${esc(p.status)}</small><strong>${money(p.amount)}</strong><span class="subtle">${esc(p.label)}</span></div>`).join('') : '<p class="subtle">No pledges.</p>'}</div>
      </div></div>` : '<p class="subtle">Graph unavailable.</p>';
  }
  const footer = `<div class="modal-footer-left"><a class="button button-ghost button-small" href="/api/relationships/${encodeURIComponent(v.id)}/timeline.csv" download>${svgIcon('download')}Export timeline (CSV)</a>${v.leadId ? `<button type="button" class="button button-ghost button-small" data-action="open-lead" data-id="${esc(v.leadId)}">${svgIcon('eye')}Prospect record</button>` : ''}</div><div class="modal-footer-right">${v.partnerId ? `<button type="button" class="button button-secondary" data-action="edit-partner" data-id="${esc(v.partnerId)}">${svgIcon('edit')}Edit partner</button>` : ''}<button type="button" class="button button-primary" data-action="close-modal">${svgIcon('check')}Done</button></div>`;
  return modalFrame(v.company, v.isPartner ? `Partner · owner ${v.owner || 'unassigned'}` : 'Prospect · relationship memory', `${summary}${tabBar}<div class="rel-body">${body}</div>`, footer, false, 'modal-wide');
}
async function relAction(action, button) {
  const id = button.dataset.id;
  if (action === 'rel-refresh') { await loadRelationships(true); return true; }
  if (action === 'rel-open') { await openRelationship(id); return true; }
  if (action === 'rel-tab') { state.rel.tab = button.dataset.tab; renderApp(); return true; }
  if (action === 'rel-tick') { state.rel.busy = true; renderApp(); try { const r = await API('/api/stewardship/tick', { method: 'POST', body: '{}' }); toast(r.created ? `${r.created} stewardship task${r.created === 1 ? '' : 's'} scheduled.` : 'Stewardship plans are up to date.'); } catch (err) { toast(err.message, true); } finally { state.rel.busy = false; await loadRelationships(true); } return true; }
  if (action === 'rel-task') {
    const op = button.dataset.op; let note = '';
    if (op === 'done') { note = prompt('Optional note for the timeline (what was sent / discussed):', '') ?? null; if (note === null) return true; }
    try { await API(`/api/stewardship/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(op === 'snooze' ? { action: 'snooze', days: 7 } : { action: op, note }) }); toast(op === 'done' ? 'Logged as a touch.' : op === 'snooze' ? 'Snoozed 7 days.' : 'Skipped.'); } catch (err) { toast(err.message, true); }
    if (state.modal?.type === 'relationship' && state.rel.viewId) { try { state.rel.view = await API(`/api/relationships/${encodeURIComponent(state.rel.viewId)}`); } catch {} }
    state.rel.summary = null; await loadRelationships(true); return true;
  }
  if (action === 'rel-pledge') {
    const status = button.dataset.status; const relId = state.rel.viewId; if (!relId) return true;
    if (status === 'cancelled' && !confirm('Cancel this pledge?')) return true;
    try { state.rel.view = await API(`/api/relationships/${encodeURIComponent(relId)}/pledges/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast(`Pledge marked ${status}.`); } catch (err) { toast(err.message, true); }
    state.rel.summary = null; renderApp(); loadRelationships(true); return true;
  }
  if (action === 'rel-person-remove') {
    const relId = state.rel.viewId; if (!relId || !confirm('Remove this person from the relationship?')) return true;
    try { state.rel.view = await API(`/api/relationships/${encodeURIComponent(relId)}/people/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (err) { toast(err.message, true); }
    renderApp(); return true;
  }
  return false;
}

// ---- Discovered funders catalogue ----
function orgPill(check) {
  if (!check) return '';
  const cls = check.status === 'verified' ? 'pill-won' : check.status === 'invalid' ? 'pill-lost' : 'pill-new';
  const label = check.status === 'verified' ? 'Org verified' : check.status === 'invalid' ? 'Domain dead' : 'Org check pending';
  return `<span class="stage-pill org-pill ${cls}" title="${esc(check.reason || '')}${check.domain ? ` (${esc(check.domain)})` : ''}">${svgIcon(check.status === 'verified' ? 'checkCircle' : check.status === 'invalid' ? 'xCircle' : 'clock')}${label}</span>`;
}
async function loadCatalogue(force = false) {
  if (state.cat.loading || (state.cat.status && !force)) return;
  state.cat.loading = true;
  try { const [status, storage] = await Promise.all([API('/api/leads/catalogue'), API('/api/storage').catch(() => null)]); state.cat.status = status; state.cat.storage = storage; } catch (err) { toast(err.message, true); } finally { state.cat.loading = false; renderApp(); }
}
function cataloguePanel() {
  const c = state.cat.status;
  if (!c) return `<section class="panel cat-panel"><p class="subtle">Loading the discovered-funders catalogue…</p></section>`;
  const pct = c.total ? Math.round((c.imported / c.total) * 100) : 0;
  const projects = Object.entries(c.byProject || {}).map(([name, n]) => `<span class="cat-chip">${esc(name)} <b>${n}</b></span>`).join('');
  return `<section class="panel cat-panel"><div class="cat-head"><div><h3>${svgIcon('globe')}Discovered funders · SA CSI catalogue</h3><p class="subtle">${c.total} South African companies, corporate foundations, trusts and IPPs with active CSI / SED programmes — organisation-level only (no personal data), each mapped to one of your six verified projects with CSI focus, likely financial year-end and a suggested ask. On load, every organisation's domain is verified (MX/DNS) and duplicates against your existing records are linked, not copied. Then <b>Find mailboxes</b> crawls each organisation's own contact / CSI / foundation pages for its <i>published generic</i> mailbox (csi@, foundation@, info@…), verifies it and sets it on the record — personal addresses are never captured. <b>Only organisations with an email enter the pipeline</b>; the rest wait in a hidden "awaiting contact" bucket that the weekly cron keeps working through.</p>${state.cat.storage ? `<p class="subtle cat-storage">${state.cat.storage.durable ? `${svgIcon('shield')} Durable storage on: synced to Supabase (v${state.cat.storage.sync?.version || 0}${state.cat.storage.sync?.lastPushAt ? `, last push ${relDate(state.cat.storage.sync.lastPushAt)}` : ''}).` : state.cat.storage.ephemeralHost ? `${svgIcon('info')} <b>Demo host:</b> this Vercel instance has no durable storage — loaded funders and found mailboxes vanish on restart. Set SUPABASE_URL + SUPABASE_SERVICE_KEY to keep them.` : `${svgIcon('shield')} Local SQLite storage.`}</p>` : ''}</div>
      <div class="cat-actions"><button type="button" class="button button-primary" data-action="cat-import" ${state.cat.busy || !c.remaining ? 'disabled' : ''}>${svgIcon('download')}${state.cat.task === 'import' ? (state.cat.progress || 'Loading…') : c.remaining ? `Load ${c.remaining} discovered funders` : 'All loaded'}</button>${c.mailboxes?.toSearch ? `<button type="button" class="button button-secondary" data-action="cat-mailboxes" ${state.cat.busy ? 'disabled' : ''}>${svgIcon('mail')}${state.cat.task === 'mailboxes' ? state.cat.progress : `Find mailboxes (${c.mailboxes.toSearch})`}</button>` : ''}${c.verification.pending ? `<button type="button" class="button button-secondary" data-action="cat-verify" ${state.cat.busy ? 'disabled' : ''}>${svgIcon('refresh')}Verify ${c.verification.pending} pending</button>` : ''}<button type="button" class="button button-ghost" data-view="workbench">${svgIcon('wand')}Open workbench</button></div></div>
    <div class="cat-progress"><span style="width:${pct}%"></span></div>
    <div class="cat-stats"><div><small>Loaded</small><strong>${c.imported} / ${c.total}</strong></div><div><small>In pipeline (has email)</small><strong class="ok">${c.visible || 0}</strong></div><div><small>Awaiting contact (hidden)</small><strong>${c.awaitingContact || 0}</strong></div><div><small>Organisation verified</small><strong class="ok">${c.verification.verified}</strong></div><div><small>Domain dead / unreachable</small><strong class="${c.verification.failed ? 'bad' : ''}">${c.verification.failed}</strong></div><div><small>Check pending</small><strong>${c.verification.pending}</strong></div><div><small>Mailbox found</small><strong class="ok">${c.mailboxes?.found || 0}</strong></div><div><small>No mailbox published</small><strong>${c.mailboxes?.nonePublished || 0}</strong></div><div><small>Still to search</small><strong>${c.mailboxes?.toSearch || 0}</strong></div></div>
    <div class="cat-chips">${projects}</div></section>`;
}
async function catAction(action) {
  if (action === 'cat-import') {
    state.cat.busy = true; state.cat.task = 'import'; let created = 0, skipped = 0, verified = 0;
    try {
      for (let i = 0; i < 12; i++) {
        state.cat.progress = `Loading… ${created} added`; renderApp();
        const r = await API('/api/import', { method: 'POST', body: JSON.stringify({ source: 'catalogue', limit: 40, verify: true }) });
        created += r.created; skipped += r.skippedExisting; verified += r.verification?.verified || 0; state.cat.status = r.status;
        if (!r.status.remaining || (r.created === 0 && r.skippedExisting === 0)) break;
      }
      toast(`${created} discovered funders loaded · ${verified} organisations verified${skipped ? ` · ${skipped} linked to existing records` : ''}.`);
    } catch (err) { toast(err.message, true); }
    finally { state.cat.busy = false; state.cat.task = ''; state.cat.progress = ''; await refresh(); await loadCatalogue(true); }
    return true;
  }
  if (action === 'cat-mailboxes') {
    state.cat.busy = true; state.cat.task = 'mailboxes'; let searched = 0, found = 0, batches = 0, idle = 0;
    try {
      state.cat.progress = 'Checking websites…'; renderApp();
      for (let i = 0; i < 60; i++) {
        let r;
        try { r = await API('/api/leads/catalogue/mailboxes', { method: 'POST', body: JSON.stringify({ limit: 6 }) }); }
        catch (err) {
          // A gateway timeout (504) means the host cut the batch short — the server keeps whatever it finished; ask again.
          if ([502, 503, 504].includes(err.status) && idle < 3) { idle += 1; continue; }
          throw err;
        }
        batches += 1; searched += r.searched; found += r.found || 0; state.cat.status = r.status;
        state.cat.progress = `Checked ${searched} · found ${found} · ${r.status.mailboxes.toSearch} still to search`; renderApp();
        if (!r.status.mailboxes.toSearch) break;
        if (!r.searched || r.cutShort >= r.searched) { idle += 1; if (idle >= 3) break; } else idle = 0; // only slow sites left
      }
      toast(searched ? `Checked ${searched} organisations: ${found} published mailbox${found === 1 ? '' : 'es'} found — ${found} now in the pipeline. ${state.cat.status?.mailboxes?.toSearch || 0} still to search; press again to continue.` : 'No organisations could be checked right now. Try again in a minute.', !searched);
    } catch (err) { toast(`Mailbox finder stopped: ${err.message}. Progress so far is saved — press the button again to continue.`, true); }
    finally { state.cat.busy = false; state.cat.task = ''; state.cat.progress = ''; await refresh(); await loadCatalogue(true); }
    return true;
  }
  if (action === 'cat-verify') {
    state.cat.busy = true; state.cat.task = 'verify'; state.cat.progress = 'Verifying…'; renderApp();
    try { const r = await API('/api/leads/catalogue/verify', { method: 'POST', body: JSON.stringify({ limit: 80 }) }); state.cat.status = r.status; toast(`Checked ${r.checked} organisations: ${r.results.verified || 0} verified, ${r.results.invalid || 0} dead, ${r.results.retry || 0} to retry.`); }
    catch (err) { toast(err.message, true); } finally { state.cat.busy = false; state.cat.task = ''; state.cat.progress = ''; await refresh(); await loadCatalogue(true); }
    return true;
  }
  return false;
}

// ---- Batch 6: Ops dashboard ----
async function loadOps(force = false) {
  if (state.ops.loading || (state.ops.data && !force)) return;
  state.ops.loading = true; state.ops.error = ''; renderApp();
  try { state.ops.data = await API('/api/ops'); } catch (err) { state.ops.error = err.message; } finally { state.ops.loading = false; renderApp(); }
}
const OPS_STATUS = { critical: ['Needs action now', 'ops-critical', 'xCircle'], attention: ['Attention', 'ops-warn', 'info'], healthy: ['All systems healthy', 'ops-ok', 'checkCircle'] };
const OPS_AREAS = [['all', 'Everything'], ['deliverability', 'Sending'], ['sequences', 'Sequences'], ['replies', 'Replies'], ['data', 'Data'], ['platform', 'Platform']];
function opsCheck(c) {
  const cls = c.status === 'critical' ? 'ops-critical' : c.status === 'warn' ? 'ops-warn' : 'ops-info';
  return `<li class="ops-check ${cls}"><span class="ops-dot" aria-hidden="true"></span><div class="ops-check-body"><strong>${esc(c.title)}</strong>${c.detail ? `<p>${esc(c.detail)}</p>` : ''}<p class="ops-fix">${svgIcon('wand')}<span><b>Fix:</b> ${esc(c.fix)}</span></p></div>${c.view ? `<button type="button" class="button button-ghost button-small" data-view="${esc(c.view)}">${svgIcon('arrow')}Open</button>` : ''}</li>`;
}
function opsKpi(label, value, sub = '', tone = '') { return `<div class="ops-kpi ${tone}"><small>${esc(label)}</small><strong>${value}</strong>${sub ? `<span class="subtle">${esc(sub)}</span>` : ''}</div>`; }
const OPS_TABS = [['health', 'Health', 'activity'], ['deliverability', 'Email delivery', 'shield'], ['analytics', 'Results', 'analytics'], ['data', 'Data quality', 'database']];
function opsVisibleTabs() { return OPS_TABS.filter(([k]) => isRoot() || !ROOT_ONLY_OPS_TABS.includes(k)); }
function opsCurrentTab() { const allowed = opsVisibleTabs(); const t = allowed.some(([k]) => k === state.ops.tab) ? state.ops.tab : allowed[0][0]; state.ops.tab = t; return t; }
function opsTabs() {
  const tab = opsCurrentTab();
  const badge = { health: state.ops.data ? (state.ops.data.counts.critical + state.ops.data.counts.warn) : 0, deliverability: (state.data.mailboxes || []).filter(m => m.status === 'paused').length, analytics: 0, data: state.dq.data ? (state.dq.data.openMergeReviews || 0) : 0 };
  return `<div class="settings-tabs ops-tabs" role="tablist">${opsVisibleTabs().map(([k, label, icon]) => `<button type="button" role="tab" class="settings-tab ${tab === k ? 'active' : ''}" data-action="ops-tab" data-tab="${k}" aria-selected="${tab === k}">${svgIcon(icon)} ${label}${badge[k] ? ` <span class="nav-count">${badge[k]}</span>` : ''}</button>`).join('')}</div>`;
}
function opsView() {
  const tab = opsCurrentTab();
  const head = pageHead('Health', isRoot() ? 'Health' : 'Results', isRoot() ? 'Is the engine OK? Problems first, then numbers.' : 'How the outreach is doing.', tab === 'health' ? `<button type="button" class="button button-secondary" data-action="ops-refresh">${svgIcon('refresh')} Refresh</button>` : '') + (opsVisibleTabs().length > 1 ? opsTabs() : '');
  if (tab === 'deliverability') return head + deliverabilityView(true);
  if (tab === 'analytics') return head + analyticsView(true);
  if (tab === 'data') return head + dataQualityView(true);
  return head + opsHealthView();
}
function opsHealthView() {
  const o = state.ops.data;
  const head = '';
  void pageHead('Observability', 'Ops dashboard', 'One screen for the whole engine: what is broken, what it costs you, and the exact next click. Checks are ranked by severity; every one carries its fix.', `<button type="button" class="button button-secondary" data-action="ops-refresh" ${state.ops.loading ? 'disabled' : ''}>${svgIcon('refresh')}${state.ops.loading ? 'Refreshing…' : 'Refresh'}</button><a class="button button-ghost" href="/api/ops" target="_blank" rel="noopener">${svgIcon('external')}JSON</a>`);
  if (!o) return `${head}<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('activity')}</div><p>${state.ops.error ? esc(state.ops.error) : 'Reading engine state…'}</p></div>`;
  const [label, cls, icon] = OPS_STATUS[o.status] || OPS_STATUS.healthy;
  const k = o.kpis;
  const checks = o.checks.filter(c => state.ops.area === 'all' || c.area === state.ops.area);
  const maxSent = Math.max(1, ...o.series.map(d => (d.sent || 0) + (d.dead || 0)));
  const bars = o.series.length ? o.series.map(d => `<div class="ops-bar" title="${esc(d.day)}: ${d.sent || 0} sent, ${d.dead || 0} dead"><span class="ops-bar-dead" style="height:${Math.round(((d.dead || 0) / maxSent) * 100)}%"></span><span class="ops-bar-sent" style="height:${Math.round(((d.sent || 0) / maxSent) * 100)}%"></span></div>`).join('') : '<p class="subtle">No sends in the last 14 days.</p>';
  const topN = o.funnel[0].n || 1;
  const funnel = o.funnel.map(st => `<li class="ops-funnel-row"><span class="ops-funnel-label">${esc(st.label)}</span><span class="ops-funnel-track"><span style="width:${Math.max(2, Math.round((st.n / topN) * 100))}%"></span></span><strong>${st.n}</strong><small class="subtle">${st.ofPrev}% of prev</small></li>`).join('');
  const p = o.areas.platform;
  return `${head}
    <section class="ops-banner ${cls}"><span class="ops-banner-icon">${svgIcon(icon)}</span><div><h3>${esc(label)}</h3><p>${o.counts.critical} critical · ${o.counts.warn} warnings · ${o.counts.info} notes · generated ${esc(new Date(o.generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }))}</p></div></section>
    <section class="ops-kpis">
      ${opsKpi('Sent · 14d', k.sent14d, `${k.bounce14dPct}% dead/bounced`, k.bounce14dPct > 2 ? 'bad' : 'ok')}
      ${opsKpi('Reply rate · 30d', `${k.replyRatePct}%`, 'human replies / first touches', k.replyRatePct >= 8 ? 'ok' : '')}
      ${opsKpi('Interested · 30d', `${k.interestedRatePct}%`, 'of first touches')}
      ${opsKpi('Meetings · 30d', `${k.meetingRatePct}%`, 'booked / first touches')}
      ${opsKpi('Replies waiting', k.repliesOpen, k.repliesOverdue ? `${k.repliesOverdue} past SLA` : 'all within SLA', k.repliesOverdue ? 'bad' : 'ok')}
      ${opsKpi('Median reply handling', k.medianReplyHours === null ? '—' : `${k.medianReplyHours}h`, 'funder reply → staff action')}
      ${opsKpi('Sequences running', k.activeSequences, `${k.stoppedByReply} stopped by a reply`)}
      ${opsKpi('Mailboxes', `${k.mailboxesActive} active`, k.mailboxesPaused ? `${k.mailboxesPaused} paused` : `${k.queued} queued · ${k.dead} dead`, k.mailboxesPaused ? 'bad' : '')}
      ${opsKpi('Pipeline leads', k.pipelineLeads, `${k.awaitingContact} hidden awaiting contact`)}
      ${opsKpi('Data grade A', `${k.dataGradeA}/${k.dataGradeTotal}`, 'verified · complete · fresh')}
    </section>
    <div class="ops-grid">
      <section class="panel ops-checks"><div class="ops-panel-head"><h3>${svgIcon('shield')}Health checks</h3><div class="chip-row">${OPS_AREAS.map(([id, l]) => `<button type="button" class="chip ${state.ops.area === id ? 'chip-active' : ''}" data-action="ops-area" data-area="${id}">${svgIcon(id === 'all' ? 'grid' : id === 'deliverability' ? 'send' : id === 'sequences' ? 'reply' : id === 'replies' ? 'mail' : id === 'data' ? 'database' : 'shield')}${esc(l)}</button>`).join('')}</div></div>
        ${checks.length ? `<ul class="ops-check-list">${checks.map(opsCheck).join('')}</ul>` : `<p class="subtle">Nothing to report${state.ops.area !== 'all' ? ' in this area' : ''}.</p>`}</section>
      <div class="ops-side">
        <section class="panel"><h3>${svgIcon('trendingUp')}Sends vs dead · 14 days</h3><div class="ops-bars">${bars}</div><p class="subtle">Target: bounces &lt;2%, complaints &lt;0.1%. The breaker pauses a mailbox automatically before providers do.</p></section>
        <section class="panel"><h3>${svgIcon('target')}Funnel · last 30 days</h3><ul class="ops-funnel">${funnel}</ul></section>
        <section class="panel ops-platform"><h3>${svgIcon('database')}Platform</h3><dl>
          <dt>Storage</dt><dd>${p.durable ? `Durable (Supabase v${p.sync?.version || 0}${p.sync?.lastPushAt ? `, pushed ${esc(relDate(p.sync.lastPushAt))}` : ''})` : p.ephemeralHost ? '<b>Ephemeral — data lost on restart</b>' : 'Local SQLite (WAL)'}</dd>
          <dt>Send worker</dt><dd>${p.serverless ? 'Serverless · cron-driven' : 'In-process worker'}</dd>
          <dt>Cron send-tick</dt><dd>${p.cron['send-tick']?.at ? esc(relDate(p.cron['send-tick'].at)) : 'never'}</dd>
          <dt>Cron data-tick</dt><dd>${p.cron['data-tick']?.at ? esc(relDate(p.cron['data-tick'].at)) : 'never'}</dd>
          <dt>Approval</dt><dd>${p.approvalPolicy === 'four-eyes' ? '4-eyes' : 'single approver'}</dd>
          <dt>Inbound sync</dt><dd>${p.inboundConfigured ? 'configured' : 'not configured'}</dd>
          <dt>AI</dt><dd>${p.aiConfigured ? 'configured (cherry on top)' : 'off — templates'}</dd>
        </dl></section>
      </div>
    </div>`;
}
async function wbRunFlow(id, { force = false, redraft = false } = {}) {
  state.wb.busy[id] = true; renderApp();
  try { await API(`/api/leads/${encodeURIComponent(id)}/flow`, { method: 'POST', body: JSON.stringify({ force, redraft }) }); }
  catch (err) { toast(err.message, true); }
  finally { delete state.wb.busy[id]; await refresh(); }
}
// After a background run starts (pool / CSV), poll until the engine finishes so the row flips from Working to Your turn by itself.
const flowPolls = new Set();
function wbPollFlow(id, attempt = 0) {
  if (flowPolls.has(id) && attempt === 0) return; flowPolls.add(id);
  setTimeout(async () => {
    try { const r = await API(`/api/leads/${encodeURIComponent(id)}/flow`); if (r.running || r.flow?.status === 'running') { if (attempt < 60) return wbPollFlow(id, attempt + 1); } }
    catch { /* lead may have been removed */ }
    flowPolls.delete(id); await refresh();
  }, attempt === 0 ? 2500 : 4000);
}
async function wbRunPending() {
  if (state.wb.pendingRan) return; state.wb.pendingRan = true;
  try { const r = await API('/api/flow/run-pending', { method: 'POST', body: JSON.stringify({ limit: 3 }) }); if (r.ran.length) { await refresh(); if (r.remaining > 0) { state.wb.pendingRan = false; wbRunPending(); } } }
  catch { /* silent: pending runs are best-effort */ }
}
async function wbAction(action, button) {
  const id = button.dataset.id;
  if (action === 'wb-focus-add') { $('#wb-add-form input[name="company"]')?.focus(); return true; }
  if (action === 'wb-filter') { state.wb.filter = button.dataset.filter; state.wb.selectedId = null; renderApp(); return true; }
  if (action === 'wb-sort') { state.wb.sort = button.dataset.sort; renderApp(); return true; }
  if (action === 'wb-select') { state.wb.selectedId = id; renderApp(); return true; }
  if (action === 'wb-send-now') {
    button.disabled = true; button.textContent = 'Sending…';
    try { const r = await API(`/api/leads/${encodeURIComponent(id)}/send-now`, { method: 'POST', body: '{}' }); toast(r.ok ? 'Sent.' : r.error || 'Not sent.', !r.ok); }
    catch (err) { toast(err.message, true); }
    await refresh(); if (state.view === 'review' && state.review) { state.review.cache = {}; await openSendPreview(id, state.review.step || 0); }
    return true;
  }
  if (action.startsWith('seq-') || action === 'triage-apply' || action === 'wb-send-all') return wbSequenceAction(action, button);
  if (action === 'wb-mailbox') { state.wb.busy[id] = true; renderApp(); try { const r = await API(`/api/leads/${encodeURIComponent(id)}/find-mailbox`, { method: 'POST', body: '{}' }); const ms = r.mailboxSearch; toast(ms.status === 'published' || ms.status === 'pattern-verified' ? `Mailbox found and set: ${r.lead.email}` : ms.status === 'unconfirmed' ? 'No published mailbox; pattern guesses listed for you to confirm.' : ms.status === 'unreachable' ? 'Website unreachable from the server.' : 'No generic mailbox published on the pages checked.'); } catch (err) { toast(err.message, true); } finally { delete state.wb.busy[id]; await refresh(); } return true; }
  if (action === 'wb-use-mailbox') { try { const r = await API(`/api/leads/${encodeURIComponent(id)}/use-mailbox`, { method: 'POST', body: JSON.stringify({ email: button.dataset.email }) }); toast(`Using ${r.lead.email}.`); } catch (err) { toast(err.message, true); } await refresh(); return true; }
  if (action === 'wb-waterfall') { state.wb.busy[id] = true; renderApp(); try { const r = await API(`/api/leads/${encodeURIComponent(id)}/waterfall`, { method: 'POST', body: '{}' }); toast(r.contactLeads.contacts.length ? `${r.contactLeads.contacts.length} public contact lead(s) found — review them in step 1.` : 'No publicly listed CSI people found on the rungs available.'); } catch (err) { toast(err.message, true); } finally { delete state.wb.busy[id]; await refresh(); } return true; }
  if (action === 'wb-wf-decide') { const decision = button.dataset.decision; const lead = getLead(id); const replace = decision === 'accept' && lead?.contactName ? confirm(`Replace ${lead.contactName} with this person as the primary contact?`) : false; if (decision === 'accept' && lead?.contactName && !replace) return true; try { const r = await API(`/api/leads/${encodeURIComponent(id)}/contact-leads`, { method: 'POST', body: JSON.stringify({ id: button.dataset.contact, action: decision, replace }) }); toast(decision === 'accept' ? 'Contact set — add their public work email in Edit details, then re-run the flow.' : decision === 'candidate' ? 'Captured in Discover as a candidate.' : 'Marked not relevant.'); await refresh(); } catch (err) { toast(err.message, true); } return true; }
  if (action === 'wb-run') { await wbRunFlow(id, { force: button.dataset.force === 'true' }); return true; }
  if (action === 'wb-redraft') { await wbRunFlow(id, { redraft: true }); return true; }
  if (action === 'wb-verify') { state.wb.busy[id] = true; renderApp(); try { const r = await API(`/api/leads/${encodeURIComponent(id)}/verify-mailbox`, { method: 'POST', body: '{}' }); toast(`Mailbox: ${r.mailbox.status} — ${r.mailbox.reason}`, ['invalid', 'undeliverable'].includes(r.mailbox.status)); } catch (err) { toast(err.message, true); } finally { delete state.wb.busy[id]; await refresh(); } return true; }
  if (action === 'wb-delete') { if (!confirm('Remove this dead lead from the database?')) return true; await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.wb.selectedId = null; await refresh(); toast('Dead lead removed.'); return true; }
  if (action === 'wb-discover') {
    const q = $('#wb-discover-q')?.value?.trim() || ''; if (!q) return toast('Describe the organisations you want to find.', true) || true;
    state.wb.discovery = { ...state.wb.discovery, query: q, busy: true, error: '' }; renderApp();
    try { const r = await API(`/api/discovery/search?q=${encodeURIComponent(q)}`); state.wb.discovery = { query: q, busy: false, results: r.organisations || [], withoutEmail: r.withoutEmail || [], read: r.read || null, warnings: r.warnings || [], error: r.warnings?.length && !r.organisations?.length ? r.warnings.join(' ') : '' }; }
    catch (err) { state.wb.discovery = { ...state.wb.discovery, busy: false, results: [], error: err.message }; }
    renderApp(); return true;
  }
  if (action === 'wb-discover-open') {
    try {
      if (button.dataset.hidden) await API(`/api/leads/${encodeURIComponent(id)}/reveal`, { method: 'POST', body: '{}' });
      state.wb.selectedId = id; state.wb.filter = 'all'; state.wb.intake = 'add'; await refresh();
      if (!getLead(id)) toast('This funder is in Chelo but not in your list. Ask an admin to share it with you.', true);
    } catch (err) { toast(err.message, true); }
    return true;
  }
  if (action === 'wb-discover-add') {
    const org = state.wb.discovery.results.find(o => (o.domain || o.name) === button.dataset.domain); if (!org) return true;
    button.disabled = true;
    try { const r = await API('/api/discovery/add', { method: 'POST', body: JSON.stringify({ ...org, query: state.wb.discovery.query }) }); org.alreadyTracked = true; state.wb.selectedId = r.lead.id; state.wb.filter = 'all'; await refresh(); toast(org.mailbox?.email ? `${org.name} added with its published mailbox. Press Run.` : `${org.name} added. Press Run — Chelo will look for their published mailbox.`); }
    catch (err) { toast(err.message, true); button.disabled = false; }
    return true;
  }
  return false;
}
async function wbAddSubmit(form) {
  const data = formDataObject(form);
  if (!data.company) return toast('Organisation name is required.', true);
  state.wb.busy.add = true; renderApp();
  try {
    const payload = { ...data, sourceName: data.sourceUrl ? 'Website' : 'Manual entry', stage: 'New' };
    let lead;
    try { lead = await API('/api/leads', { method: 'POST', body: JSON.stringify(payload) }); }
    catch (err) {
      if (err.code !== 'duplicate' || !err.duplicates?.length) throw err;
      const d = err.duplicates[0];
      if (!confirm(`${d.company} already exists (${d.reasons[0]}). Add anyway? It will be queued for a merge review.`)) { delete state.wb.busy.add; state.wb.selectedId = d.type === 'leads' ? d.id : state.wb.selectedId; renderApp(); return; }
      lead = await API('/api/leads', { method: 'POST', body: JSON.stringify({ ...payload, allowDuplicate: true }) });
    }
    state.wb.selectedId = lead.id; state.wb.filter = 'all';
    delete state.wb.busy.add;
    await refresh();
    toast(`${lead.company} added — verifying, researching and drafting…`);
    await wbRunFlow(lead.id);
  } catch (err) { delete state.wb.busy.add; renderApp(); toast(err.message, true); }
}
document.addEventListener('change', async event => {
  const smePick = event.target.closest('[data-sme-pick]');
  if (smePick && state.sup.sme) { state.sup.sme.picked[smePick.dataset.smePick] = smePick.checked; renderApp(); return; }
  const photoTheme = event.target.closest('[data-photo-theme]');
  if (photoTheme) { state.photos.theme[photoTheme.dataset.photoTheme] = photoTheme.value; renderApp(); return; }
  const schFilter = event.target.closest('[data-sch-filter]');
  if (schFilter) { state.sch[schFilter.dataset.schFilter] = schFilter.value; try { await schLoadList(); } catch (err) { toast(err.message, true); } renderApp(); return; }
  const dbeFile = event.target.closest('#dbe-csv');
  if (dbeFile && dbeFile.files?.[0]) {
    const file = dbeFile.files[0]; state.sch.busy = true; renderApp();
    try { const text = await file.text(); const r = await API('/api/schools/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text }); state.sch.status = r.status; state.sch.treeKey = ''; toast(`Imported ${r.imported.toLocaleString('en-ZA')} schools (${r.skipped} rows skipped).`); }
    catch (err) { toast(err.message, true); } finally { state.sch.busy = false; dbeFile.value = ''; renderApp(); }
    return;
  }
  const deskSel = event.target.closest('[data-change="dlv-desk"]');
  if (deskSel) { try { await API(`/api/deliverability/mailboxes/${encodeURIComponent(deskSel.dataset.id)}/desk`, { method: 'PUT', body: JSON.stringify({ desk: deskSel.value }) }); toast(deskSel.value ? `Mailbox now sends for the ${deskSel.options[deskSel.selectedIndex].text} desk only.` : 'Mailbox can send for any desk.'); await loadDeliverability(true); } catch (err) { toast(err.message, true); } return; }
  const pick = event.target.closest('[data-pool-pick]');
  if (pick) { const id = pick.dataset.poolPick; const set = new Set(state.wb.poolPicks || []); if (pick.checked) set.add(id); else set.delete(id); state.wb.poolPicks = Array.from(set); renderApp(); return; }
  const fye = event.target.closest('[data-wb-fye]');
  if (fye) { try { await API(`/api/leads/${encodeURIComponent(fye.dataset.wbFye)}`, { method: 'PATCH', body: JSON.stringify({ financialYearEnd: fye.value ? Number(fye.value) : null }) }); toast(fye.value ? `Financial year-end set to ${FYE_MONTHS[Number(fye.value) - 1]} — approach window updated.` : 'Financial year-end cleared.'); await refresh(); } catch (err) { toast(err.message, true); } return; }
  const sel = event.target.closest('[data-wb-project]');
  if (!sel) return;
  const id = sel.dataset.wbProject;
  try { await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ projectId: sel.value }) }); toast('Project linked — redrafting the email…'); await wbRunFlow(id, { redraft: true }); }
  catch (err) { toast(err.message, true); }
});

// =====================================================================
// Deliverability — mailboxes, domain authentication, sending policy, queue, circuit breaker
// =====================================================================
const DLV_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
async function loadDeliverability(force = false) {
  if (state.dlv.loading) return;
  if (state.dlv.data && !force) return;
  state.dlv.loading = true; renderApp();
  try { state.dlv.data = await API('/api/deliverability'); state.dlv.error = ''; }
  catch (err) { state.dlv.error = err.message; }
  finally { state.dlv.loading = false; renderApp(); }
}
function dlvHealthPill(health) {
  const s = health?.status || 'unknown';
  const map = { pass: ['Authenticated', 'pill-won'], 'needs-work': ['Needs work', 'pill-pending'], fail: ['Failing', 'pill-not-proceeding'], unknown: ['Not checked', 'pill-new'] };
  const [label, cls] = map[s] || map.unknown; return `<span class="stage-pill ${cls}">${esc(label)}</span>`;
}
function dlvJobPill(status) {
  const map = { queued: 'pill-researched', sending: 'pill-interested', sent: 'pill-won', held: 'pill-pending', failed: 'pill-pending', dead: 'pill-not-proceeding', cancelled: 'pill-new' };
  return `<span class="stage-pill ${map[status] || 'pill-new'}">${esc(status)}</span>`;
}
function dlvWhen(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }); }
function deliverabilityView(embedded = false) {
  const data = state.dlv.data;
  const head = embedded ? '' : pageHead('Deliverability', 'Sending engine', 'Your own mailboxes, authenticated domains, slow ramps, business-hours windows and a circuit breaker — the plumbing that decides whether emails land.', `<button type="button" class="button button-secondary" data-action="dlv-refresh">${svgIcon('refresh')}Refresh</button><button type="button" class="button button-secondary" data-action="dlv-tick">${svgIcon('send')}Process queue now</button><button type="button" class="button button-primary" data-action="dlv-new-mailbox">${svgIcon('plus')}Add mailbox</button>`);
  if (!data) { loadDeliverability(); return `${head}<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('activity')}</div><p>${state.dlv.error ? esc(state.dlv.error) : 'Loading sending engine…'}</p></div>`; }
  const boxes = data.mailboxes || [];
  const queue = data.queue || {};
  const paused = boxes.filter(m => m.status === 'paused').length;
  const tiles = metricCard('Active mailboxes', String(boxes.filter(m => m.status === 'active').length), `${boxes.length} registered`, 'mail', paused ? `${paused} paused` : '', paused > 0)
    + metricCard('Capacity left today', String(boxes.filter(m => m.status === 'active').reduce((a, m) => a + m.today.remaining, 0)), `of ${boxes.reduce((a, m) => a + m.today.cap, 0)} across caps`, 'trendingUp')
    + metricCard('In queue', String((queue.queued || 0) + (queue.sending || 0)), `${queue.held || 0} held · ${queue.dead || 0} rejected`, 'send', queue.held ? 'needs attention' : '', Boolean(queue.held))
    + metricCard('Sent · 14 days', String(data.series.reduce((a, d) => a + (d.sent || 0), 0)), `${data.series.reduce((a, d) => a + (d.dead || 0), 0)} rejected by receivers`, 'checkCircle');
  return `${head}
  ${data.serverless ? (() => {
    const ageH = data.cronLastRun ? (Date.now() - Date.parse(data.cronLastRun)) / 3600e3 : null; const ok = ageH !== null && ageH < 30;
    return `<div class="notice ${ok ? 'notice-ok' : 'notice-warn'}">${svgIcon(ok ? 'checkCircle' : 'info')}<div><strong>${ok ? 'Scheduled sending is working.' : 'Scheduled sending depends on the cron.'}</strong> ${ok ? `The send-tick cron last ran ${ageH < 1 ? 'under an hour ago' : `${Math.round(ageH)} h ago`} (Vercel schedule: 07:00 UTC, Mon–Fri). ` : data.cronLastRun ? `It last ran ${Math.round(ageH)} h ago — check the Vercel Cron Jobs tab. ` : `It has never run on this host${data.cronSecretSet ? '' : ' and <code>CRON_SECRET</code> is not set in Vercel → Environment Variables'}. `}This host has no background worker: due emails also go out on the next page load and on “Process queue now”. For sends within minutes rather than the next morning, call <code>/api/cron/send-tick</code> every 10–15 min from an external scheduler (cron-job.org, UptimeRobot) with <code>Authorization: Bearer &lt;CRON_SECRET&gt;</code>, or upgrade the Vercel cron schedule on Pro.</div></div>`;
  })() : `<p class="subtle">Background worker checks the queue every ${data.workerIntervalSeconds}s. Domain authentication is re-checked every 12 hours.</p>`}
  <section class="metric-grid dlv-tiles">${tiles}</section>
  <section class="dlv-mailboxes">${boxes.length ? boxes.map(dlvMailboxCard).join('') : `<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('mail')}</div><p>No sending mailbox yet. Add the Google Workspace / Microsoft 365 / Zoho mailbox your team sends from — Chelo sends through it over SMTP, never through a shared relay.</p><button type="button" class="button button-primary" data-action="dlv-new-mailbox">${svgIcon('plus')}Add mailbox</button></div>`}</section>
  ${state.dlv.editing ? dlvMailboxForm(state.dlv.editing) : ''}
  <div class="dlv-grid">
    ${dlvPolicyPanel(data.policy)}
    ${dlvQueuePanel(data.jobs || [])}
  </div>`;
}
function dlvMailboxCard(m) {
  const h = m.health || {}; const b = m.breaker || {};
  const pct = m.today.cap ? Math.min(100, Math.round(m.today.used / m.today.cap * 100)) : 0;
  const checks = h.checks || {};
  return `<article class="panel dlv-mailbox ${m.status === 'paused' ? 'is-paused' : ''}">
    <header class="dlv-mailbox-head">
      <div><strong>${esc(m.label)}</strong><small>${esc(m.fromName)} &lt;${esc(m.fromEmail)}&gt; · ${m.authType === 'google' ? 'connected with Google — sends through Gmail' : `sends via ${esc(m.host)}:${m.port}${m.secure ? ' TLS' : ' STARTTLS'}`}</small><small>${m.imap ? `${svgIcon('mail')} Reads replies via ${m.authType === 'google' ? 'Gmail (read-only)' : `${esc(m.imap.host)}:${m.imap.port}`}${m.imap.lastSyncAt ? ` · last read ${dlvWhen(m.imap.lastSyncAt)}${m.imap.lastSync && m.imap.lastSync.ok === false ? ` — failed: ${esc(m.imap.lastSync.error || '')}` : m.imap.lastSync ? ` · ${m.imap.lastSync.checked} new, ${m.imap.lastSync.matched} matched` : ''}` : ' · not read yet'}` : `${svgIcon('info')} Replies are not read for this mailbox — edit it and add the reply server.`}</small></div>
      <div class="dlv-mailbox-status">${m.status === 'paused' ? `<span class="stage-pill pill-not-proceeding">${svgIcon('ban')}Paused</span>` : `<span class="stage-pill pill-won">${svgIcon('check')}Active</span>`}${dlvHealthPill(h)}</div>
    </header>
    ${m.status === 'paused' ? `<p class="form-error">${esc(m.pausedReason || 'Paused')}${m.pausedAt ? ` · ${dlvWhen(m.pausedAt)}` : ''}</p>` : ''}
    <div class="dlv-cap"><div class="dlv-cap-bar"><span style="width:${pct}%"></span></div><small>${m.today.used}/${m.today.cap} today${m.rampWeek && m.rampEnabled ? ` · ramp week ${m.rampWeek} (full cap ${m.dailyCap})` : ` · cap ${m.dailyCap}`}</small></div>
    <div class="dlv-auth">${['spf', 'dkim', 'dmarc', 'mx'].map(k => { const c = checks[k]; return `<span class="dlv-auth-chip ${c ? c.ok ? 'ok' : 'bad' : ''}" title="${esc(c?.note || 'not checked')}">${svgIcon(c ? c.ok ? 'check' : 'xCircle' : 'info')}${k.toUpperCase()}</span>`; }).join('')}<small class="subtle">${h.checkedAt ? `checked ${dlvWhen(h.checkedAt)}` : 'not checked yet'}</small></div>
    ${(h.issues || []).length ? `<ul class="dlv-issues">${h.issues.map(i => `<li class="sev-${i.severity}"><strong>${esc(i.title)}</strong> ${esc(i.detail)}<br><span class="subtle">Fix: ${esc(i.fix)}</span></li>`).join('')}</ul>` : ''}
    <div class="dlv-breaker ${b.level || 'ok'}"><span>${svgIcon(b.level === 'tripped' ? 'xCircle' : b.level === 'warning' ? 'info' : 'shield')}</span><div><strong>Circuit breaker · ${esc(b.level || 'ok')}</strong><small>${b.windowDays}d: ${b.sent || 0} sent · ${b.hardBounces || 0} hard bounces (${((b.rates?.hardBounce || 0) * 100).toFixed(1)}%) · ${b.complaints || 0} complaints/unsubscribes${b.reason ? ` — ${esc(b.reason)}` : ''}</small></div></div>
    <div class="wb-step-actions">
      <button type="button" class="button button-secondary button-small" data-action="dlv-check" data-id="${esc(m.id)}">${svgIcon('refresh')}Re-check domain</button>
      <button type="button" class="button button-secondary button-small" data-action="dlv-test" data-id="${esc(m.id)}">${svgIcon('activity')}Test login</button>
      ${m.imap ? `<button type="button" class="button button-secondary button-small" data-action="dlv-sync-inbox" data-id="${esc(m.id)}">${svgIcon('mail')}Read replies now</button>` : ''}
      ${m.status === 'paused' ? `<button type="button" class="button button-primary button-small" data-action="dlv-resume" data-id="${esc(m.id)}">${svgIcon('play')}Resume</button>` : `<button type="button" class="button button-ghost button-small" data-action="dlv-pause" data-id="${esc(m.id)}">${svgIcon('ban')}Pause</button>`}
      ${m.authType === 'google' ? `<button type="button" class="button ${m.status === 'paused' && /google/i.test(m.pausedReason || '') ? 'button-primary' : 'button-ghost'} button-small" data-action="google-connect" data-mailbox="${esc(m.id)}">${svgIcon('key')}Reconnect Google</button>` : ''}
      <button type="button" class="button button-ghost button-small" data-action="dlv-edit" data-id="${esc(m.id)}">${svgIcon('edit')}Edit</button>
      <button type="button" class="button button-ghost button-small" data-action="dlv-restart-ramp" data-id="${esc(m.id)}">${svgIcon('trendingUp')}Restart ramp</button>
      <label class="dlv-desk subtle">Desk <select class="form-control form-control-small" data-change="dlv-desk" data-id="${esc(m.id)}"><option value="">Any desk</option>${(state.auth?.deskCatalogue || []).map(d => `<option value="${esc(d.id)}" ${m.desk === d.id ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>
      <button type="button" class="button button-ghost button-small" data-action="dlv-delete" data-id="${esc(m.id)}">${svgIcon('trash')}Remove</button>
    </div>
  </article>`;
}
function dlvMailboxForm(m) {
  const edit = Boolean(m.id);
  const adv = Boolean(state.dlv.showServerDetails || (edit && !m.imap));
  const found = state.dlv.found; // last autodiscover result (new mailbox only)
  const ramp = (state.dlv.data?.policy?.ramp || []).join(' → ');
  if (!edit) {
    const google = state.data?.settings?.googleConfigured || state.googleStatus?.configured;
    return `<section class="panel dlv-form"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>Add a mailbox</h2><p>${google ? 'For a company Google mailbox, press Connect with Google — no password needed. For anything else, type the email address and its password.' : 'Type the email address and its password. Chelo finds the sending and reply-reading servers itself and proves the login before saving.'}</p></div></div>
    ${google ? `<div class="dlv-google-connect"><button type="button" class="button button-primary" data-action="google-connect">${svgIcon('key')}Connect with Google</button><span class="subtle">Google asks you to sign in to the mailbox and tick two boxes: send email, read email (read-only). Nothing is stored except Google's connection token, encrypted.</span><button type="button" class="button button-ghost button-small" data-action="google-setup-toggle">${svgIcon('settings')}Google settings</button></div>` : `<div class="dlv-google-connect"><span class="subtle">Company Google mailbox? Set up Google once (two values from the Google Cloud console) and staff can connect mailboxes without passwords.</span><button type="button" class="button button-secondary" data-action="google-setup-toggle">${svgIcon('key')}Set up Google</button></div>`}
    ${state.dlv.googleSetupOpen ? googleSettingsCard(state.data?.settings || {}) : ''}
    <div class="dlv-or"><span>${google ? 'or use a password' : 'add with email + password'}</span></div>
    <form data-form="dlv-mailbox-connect" class="settings-form">
      <div class="settings-fields">
        <div class="form-group"><label>Email address</label><input class="form-control" name="email" type="email" required autocomplete="username" value="${esc(found?.email || '')}" placeholder="partnerships@cheloapp.com" /></div>
        <div class="form-group"><label>Password</label><input class="form-control" name="password" type="password" required autocomplete="new-password" /><span class="form-hint">Google Workspace and Microsoft 365 need an <strong>app password</strong>, not the normal login. Google: Account → Security → 2-Step Verification → App passwords.</span></div>
        <div class="form-group"><label>Name shown to funders</label><input class="form-control" name="fromName" value="${esc(m.fromName || 'Chelo Partnerships')}" /></div>
        <label class="check-row"><input type="checkbox" name="rampEnabled" checked /> Start slowly (${ramp} emails a day, week by week)</label>
      </div>
      ${found ? dlvFoundSummary(found) : ''}
      <details class="dlv-advanced" ${adv ? 'open' : ''}><summary>Server details (only if the automatic search fails)</summary>
        <div class="settings-fields">
          <div class="form-group"><label>Sending server (SMTP)</label><input class="form-control" name="host" value="${esc(found?.smtp?.host || '')}" placeholder="smtp.gmail.com" /></div>
          <div class="form-group"><label>Sending port</label><input class="form-control" name="port" type="number" min="1" max="65535" value="${found?.smtp?.port || ''}" placeholder="465" /></div>
          <div class="form-group"><label>Reply server (IMAP)</label><input class="form-control" name="imapHost" value="${esc(found?.imap?.host || '')}" placeholder="imap.gmail.com" /></div>
          <div class="form-group"><label>Reply port</label><input class="form-control" name="imapPort" type="number" min="1" max="65535" value="${found?.imap?.port || ''}" placeholder="993" /></div>
        </div></details>
      <div class="settings-card-actions"><button type="button" class="button button-ghost" data-action="dlv-cancel-edit">${svgIcon('xCircle')}Cancel</button><button type="button" class="button button-secondary" data-action="dlv-autodiscover">${svgIcon('search')}Find settings</button><button type="submit" class="button button-primary">${svgIcon('check')}Connect mailbox</button></div>
    </form></section>`;
  }
  return `<section class="panel dlv-form"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>Edit mailbox</h2><p>Passwords are encrypted and never shown again. Leave the password blank to keep the stored one.</p></div></div>
    <form data-form="dlv-mailbox" class="settings-form"><input type="hidden" name="id" value="${esc(m.id)}" />
      <div class="settings-fields">
        <div class="form-group"><label>Label</label><input class="form-control" name="label" value="${esc(m.label || '')}" placeholder="Partnerships inbox" /></div>
        <div class="form-group"><label>Name shown to funders</label><input class="form-control" name="fromName" value="${esc(m.fromName || 'Chelo Partnerships')}" /></div>
        <div class="form-group"><label>Email address</label><input class="form-control" name="fromEmail" type="email" required value="${esc(m.fromEmail || '')}" /></div>
        <div class="form-group"><label>Password</label><input class="form-control" name="password" type="password" autocomplete="new-password" placeholder="${m.hasPassword ? 'Stored — leave blank to keep' : ''}" /></div>
        <div class="form-group"><label>Emails a day (full, after the slow start)</label><input class="form-control" name="dailyCap" type="number" min="1" max="500" value="${m.dailyCap || (state.dlv.data?.policy?.defaultDailyCap || 25)}" /><span class="form-hint">20–40 a day keeps a mailbox trusted. Add another mailbox rather than raising this.</span></div>
        <label class="check-row"><input type="checkbox" name="rampEnabled" ${m.rampEnabled === false ? '' : 'checked'} /> Start slowly (${ramp} a day, week by week)</label>
      </div>
      <details class="dlv-advanced" ${adv ? 'open' : ''}><summary>Server details</summary>
        <div class="settings-fields">
          <div class="form-group"><label>Sending server (SMTP)</label><input class="form-control" name="host" required value="${esc(m.host || '')}" /></div>
          <div class="form-group"><label>Sending port</label><input class="form-control" name="port" type="number" min="1" max="65535" value="${m.port || 587}" /></div>
          <div class="form-group"><label>Login name</label><input class="form-control" name="username" autocomplete="username" value="${esc(m.username || '')}" /></div>
          <div class="form-group"><label>DKIM selector <span class="optional">(optional)</span></label><input class="form-control" name="dkimSelector" value="${esc(m.dkimSelector || '')}" placeholder="google / selector1" /></div>
          <div class="form-group"><label>Reply server (IMAP)</label><input class="form-control" name="imapHost" value="${esc(m.imap?.host || '')}" placeholder="imap.gmail.com" /></div>
          <div class="form-group"><label>Reply port</label><input class="form-control" name="imapPort" type="number" min="1" max="65535" value="${m.imap?.port || 993}" /></div>
          <label class="check-row"><input type="checkbox" name="secure" ${m.secure ? 'checked' : ''} /> Encrypted from the start (port 465)</label>
        </div></details>
      <div class="settings-card-actions"><button type="button" class="button button-ghost" data-action="dlv-cancel-edit">${svgIcon('xCircle')}Cancel</button><button type="submit" class="button button-primary">${svgIcon('check')}Save mailbox</button></div>
    </form></section>`;
}
function dlvFoundSummary(f) {
  const row = (label, ok, text) => `<li class="${ok ? 'ok' : 'bad'}">${svgIcon(ok ? 'check' : 'xCircle')}<span><strong>${label}</strong> ${esc(text)}</span></li>`;
  return `<div class="dlv-found ${f.smtp ? 'is-ok' : 'is-bad'}"><p>${esc(f.summary)}</p><ul class="dlv-found-list">
    ${row('Provider', true, f.providerLabel)}
    ${row('Sending', Boolean(f.smtp), f.smtp ? `${f.smtp.host}:${f.smtp.port} — login works` : f.authRefused ? 'password refused' : 'no server answered')}
    ${row('Replies', Boolean(f.imap), f.imap ? `${f.imap.host}:${f.imap.port} — Chelo will read replies and bounces here` : 'not found; replies will not stop follow-ups automatically')}
  </ul>${f.passwordHint && !f.smtp ? `<p class="form-hint">${esc(f.passwordHint)}</p>` : ''}${f.dns ? dlvDnsAdvice(f.dns) : ''}</div>`;
}
function dlvDnsAdvice(d) {
  if (!d || !d.records?.length) return '';
  return `<details class="dlv-advanced"><summary>DNS records for ${esc(d.domain)} (so emails land in the inbox)</summary><p class="form-hint">${esc(d.note || '')}</p><table class="dlv-dns"><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>${d.records.map(r => `<tr><td>${esc(r.type)}</td><td><code>${esc(r.name)}</code></td><td><code>${esc(r.value)}</code>${r.note ? `<br><span class="subtle">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table></details>`;
}
function dlvPolicyPanel(p) {
  return `<section class="panel"><div class="settings-section-head"><span class="settings-section-icon gold">${svgIcon('clock')}</span><div><h2>Sending policy</h2><p>Applies to every mailbox. Emails are spaced with a minimum gap plus random jitter inside the window; nothing goes out on excluded days.</p></div></div>
    <form data-form="dlv-policy" class="settings-form"><div class="settings-fields">
      <div class="form-group"><label>Window start</label><input class="form-control" name="windowStart" type="time" value="${esc(p.windowStart)}" /></div>
      <div class="form-group"><label>Window end</label><input class="form-control" name="windowEnd" type="time" value="${esc(p.windowEnd)}" /></div>
      <div class="form-group"><label>Timezone</label><input class="form-control" name="timezone" value="${esc(p.timezone)}" /></div>
      <div class="form-group"><label>Default daily cap</label><input class="form-control" name="defaultDailyCap" type="number" min="1" max="500" value="${p.defaultDailyCap}" /></div>
      <div class="form-group"><label>Minimum gap (s)</label><input class="form-control" name="minGapSeconds" type="number" min="20" max="900" value="${p.minGapSeconds}" /></div>
      <div class="form-group"><label>Jitter (s)</label><input class="form-control" name="jitterSeconds" type="number" min="0" max="1800" value="${p.jitterSeconds}" /></div>
      <div class="form-group full"><label>Ramp (per-day caps for week 1, 2, 3…)</label><input class="form-control" name="ramp" value="${esc(p.ramp.join(', '))}" /></div>
      <div class="form-group full"><label>Send days</label><div class="chip-row">${DLV_DAY_NAMES.map((d, i) => `<label class="dlv-day"><input type="checkbox" name="sendDays" value="${i}" ${p.sendDays.includes(i) ? 'checked' : ''} /> ${d}</label>`).join('')}</div></div>
      <div class="form-group"><label>Hard-bounce trip (%)</label><input class="form-control" name="hardBounceRate" type="number" step="0.1" min="0.1" max="20" value="${(p.breaker.hardBounceRate * 100).toFixed(1)}" /></div>
      <div class="form-group"><label>Complaint trip (%)</label><input class="form-control" name="complaintRate" type="number" step="0.01" min="0.01" max="5" value="${(p.breaker.complaintRate * 100).toFixed(2)}" /></div>
    </div><div class="settings-card-actions"><button type="submit" class="button button-primary">${svgIcon('check')}Save policy</button></div></form></section>`;
}
function dlvQueuePanel(jobs) {
  const rows = jobs.slice(0, 60);
  return `<section class="panel"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('send')}</span><div><h2>Send queue</h2><p>Every approved email passes through here: suppression gate → mailbox cap → window → SMTP. Rejected addresses are quarantined automatically.</p></div><button type="button" class="button button-secondary button-small" data-action="dlv-tick">${svgIcon('play')}Send what is due</button></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table dlv-queue"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(j => `<tr><td>${dlvWhen(j.status === 'sent' ? j.sentAt : j.scheduledAt)}</td><td><strong>${esc(j.meta?.company || '')}</strong><br><small>${esc(j.to)}</small></td><td>${esc(j.subject)}${j.lastError ? `<br><small class="form-error">${esc(j.lastError.slice(0, 120))}</small>` : ''}</td><td>${dlvJobPill(j.status)}${j.attempts > 1 ? `<small class="subtle"> ×${j.attempts}</small>` : ''}</td><td class="dlv-queue-actions">${j.status === 'queued' ? `<button type="button" class="button button-secondary button-small" data-action="dlv-send-now" data-id="${esc(j.id)}">${svgIcon('send')}Send now</button>` : ''}${['queued', 'held', 'failed'].includes(j.status) ? `<button type="button" class="button button-ghost button-small" data-action="dlv-cancel-job" data-id="${esc(j.id)}">${svgIcon('xCircle')}Cancel</button>` : ''}${['held', 'failed', 'dead'].includes(j.status) ? `<button type="button" class="button button-ghost button-small" data-action="dlv-retry-job" data-id="${esc(j.id)}">${svgIcon('refresh')}Retry</button>` : ''}${j.leadId ? `<button type="button" class="button button-ghost button-small" data-action="wb-open" data-id="${esc(j.leadId)}">${svgIcon('external')}Lead</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="subtle">Queue is empty.</p>`}</section>`;
}
async function dlvAction(action, button) {
  const id = button.dataset.id;
  const call = async (url, body = {}, method = 'POST') => API(url, { method, body: method === 'DELETE' ? undefined : JSON.stringify(body) });
  try {
    if (action === 'dlv-refresh') { await loadDeliverability(true); return true; }
    if (action === 'dlv-new-mailbox') { state.dlv.editing = {}; renderApp(); document.querySelector('.dlv-form')?.scrollIntoView({ behavior: 'smooth' }); return true; }
    if (action === 'dlv-cancel-edit') { state.dlv.editing = null; state.dlv.found = null; state.dlv.showServerDetails = false; renderApp(); return true; }
    if (action === 'dlv-edit') { state.dlv.editing = (state.dlv.data.mailboxes || []).find(m => m.id === id) || {}; renderApp(); return true; }
    if (action === 'dlv-tick') { const r = await call('/api/deliverability/tick'); toast(r.ran ? `Processed ${r.ran} queued email(s).` : 'Nothing is due right now.'); await loadDeliverability(true); await refresh(); return true; }
    if (action === 'dlv-check') { const r = await call(`/api/deliverability/mailboxes/${id}/check`); toast(`Domain ${r.health.domain}: ${r.health.status}${r.health.issues.length ? ` — ${r.health.issues.map(i => i.title).join(', ')} need attention` : ''}`, r.health.status === 'fail'); await loadDeliverability(true); return true; }
    if (action === 'dlv-test') { const r = await call(`/api/deliverability/mailboxes/${id}/test`); toast(r.message); return true; }
    if (action === 'dlv-sync-inbox') { button.disabled = true; try { const r = await call(`/api/deliverability/mailboxes/${id}/sync-inbox`); toast(r.ok ? `Read ${r.checked} new message(s); ${r.matched} matched funders.` : `Could not read replies: ${r.error}`, !r.ok); } finally { button.disabled = false; } await loadDeliverability(true); await refresh(); return true; }
    if (action === 'dlv-autodiscover') {
      const form = button.closest('form'); const email = form.querySelector('[name="email"]').value.trim(); const password = form.querySelector('[name="password"]').value;
      if (!email || !password) { toast('Type the email address and password first.', true); return true; }
      button.disabled = true; button.textContent = 'Looking… (up to a minute)';
      try { const r = await call('/api/deliverability/mailboxes/autodiscover', { email, password }); state.dlv.found = r; state.dlv.showServerDetails = !r.smtp; renderApp(); toast(r.summary, !r.smtp); }
      catch (err) { toast(err.message, true); button.disabled = false; button.textContent = 'Find settings'; }
      return true;
    }
    if (action === 'dlv-pause') { await call(`/api/deliverability/mailboxes/${id}/pause`, { reason: 'paused by staff' }); await loadDeliverability(true); return true; }
    if (action === 'dlv-resume') { const r = await call(`/api/deliverability/mailboxes/${id}/resume`); toast(r.warning || 'Mailbox resumed.', Boolean(r.warning)); await loadDeliverability(true); return true; }
    if (action === 'dlv-restart-ramp') { await call(`/api/deliverability/mailboxes/${id}/restart-ramp`); toast('Ramp restarted from week 1.'); await loadDeliverability(true); return true; }
    if (action === 'dlv-delete') { if (!confirm('Remove this mailbox? Queued emails on it will be held.')) return true; await call(`/api/deliverability/mailboxes/${id}`, {}, 'DELETE'); await loadDeliverability(true); return true; }
    if (action === 'dlv-send-now') { button.disabled = true; try { const r = await call(`/api/deliverability/jobs/${id}/send-now`); toast(r.ok ? 'Sent.' : r.error, !r.ok); } catch (err) { toast(err.message, true); } await loadDeliverability(true); await refresh(); return true; }
    if (action === 'dlv-cancel-job') { await call(`/api/deliverability/jobs/${id}/cancel`); await loadDeliverability(true); await refresh(); return true; }
    if (action === 'dlv-retry-job') { await call(`/api/deliverability/jobs/${id}/retry`); toast('Re-queued in the next free slot.'); await loadDeliverability(true); await refresh(); return true; }
    if (action === 'wb-open') { state.wb.selectedId = id; state.wb.filter = 'all'; setView('workbench'); return true; }
  } catch (err) { toast(err.message, true); return true; }
  return false;
}
async function dlvMailboxConnect(form) {
  const data = formDataObject(form);
  data.rampEnabled = form.querySelector('[name="rampEnabled"]').checked;
  if (!data.host) { delete data.host; delete data.port; } else data.port = Number(data.port) || 465;
  if (!data.imapHost) { delete data.imapHost; delete data.imapPort; } else data.imapPort = Number(data.imapPort) || 993;
  const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Connecting… (up to a minute)';
  try {
    const r = await API('/api/deliverability/mailboxes/connect', { method: 'POST', body: JSON.stringify(data) });
    state.dlv.editing = null; state.dlv.found = null; state.dlv.showServerDetails = false; state.dlv.lastDns = r.dns;
    toast(`${r.mailbox.fromEmail} connected. ${r.repliesRead ? 'Replies will be read automatically.' : 'Replies are not read yet.'} Domain: ${r.mailbox.health?.status || 'checked'}.`, r.mailbox.health?.status === 'fail');
    await loadDeliverability(true); await refresh();
  } catch (err) {
    toast(err.message, true); submit.disabled = false; submit.textContent = 'Connect mailbox';
    if (err.payload?.found) { state.dlv.found = { ...err.payload.found, dns: null }; state.dlv.showServerDetails = true; renderApp(); }
  }
}
async function dlvMailboxSubmit(form) {
  const data = formDataObject(form);
  data.secure = form.querySelector('[name="secure"]').checked; data.rampEnabled = form.querySelector('[name="rampEnabled"]').checked;
  data.port = Number(data.port); data.dailyCap = Number(data.dailyCap);
  if (!data.password) delete data.password;
  const imapHost = data.imapHost, imapPort = Number(data.imapPort) || 993; delete data.imapHost; delete data.imapPort;
  try {
    const r = await API('/api/deliverability/mailboxes', { method: 'POST', body: JSON.stringify(data) });
    const prevImap = state.dlv.editing?.imap;
    if (imapHost && (imapHost !== prevImap?.host || imapPort !== prevImap?.port || data.password)) await API(`/api/deliverability/mailboxes/${r.mailbox.id}/imap`, { method: 'POST', body: JSON.stringify({ host: imapHost, port: imapPort, username: data.username || data.fromEmail, password: data.password || '' }) });
    else if (!imapHost && prevImap) await API(`/api/deliverability/mailboxes/${r.mailbox.id}/imap`, { method: 'POST', body: JSON.stringify({ clear: true }) });
    state.dlv.editing = null; toast(`Mailbox saved. Domain ${r.mailbox.domain}: ${r.mailbox.health?.status || 'checked'}.`, r.mailbox.health?.status === 'fail'); await loadDeliverability(true); await refresh();
  }
  catch (err) { toast(err.message, true); }
}
async function dlvPolicySubmit(form) {
  const data = formDataObject(form);
  const body = { windowStart: data.windowStart, windowEnd: data.windowEnd, timezone: data.timezone, defaultDailyCap: Number(data.defaultDailyCap), minGapSeconds: Number(data.minGapSeconds), jitterSeconds: Number(data.jitterSeconds), ramp: String(data.ramp || '').split(/[,\s]+/).map(Number).filter(n => n > 0), sendDays: [...form.querySelectorAll('[name="sendDays"]:checked')].map(i => Number(i.value)), breaker: { hardBounceRate: Number(data.hardBounceRate) / 100, complaintRate: Number(data.complaintRate) / 100 } };
  try { await API('/api/deliverability/policy', { method: 'POST', body: JSON.stringify(body) }); toast('Sending policy saved.'); await loadDeliverability(true); }
  catch (err) { toast(err.message, true); }
}
