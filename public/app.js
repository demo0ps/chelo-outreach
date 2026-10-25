const API = async (url, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.auth?.csrfToken && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = state.auth.csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, method, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) { const error = new Error(payload?.error || `Request failed (${response.status})`); error.status = response.status; error.code = payload?.code || ''; error.duplicates = payload?.duplicates || null; throw error; }
  return payload;
};

const state = {
  palette: null,
  dlv: { data: null, loading: false, error: '', editing: null },
  dq: { data: null, loading: false, error: '', busy: false },
  wb: { selectedId: null, sort: 'fit', filter: 'all', discovery: { query: '', results: [], busy: false, error: '' }, busy: {}, pendingRan: false },
  data: { leads: [], candidates: [], partners: [], bookings: [], activities: [], messages: [], emailEvents: [], projects: [], provinces: [], videoPlatforms: [], staff: [], currentUser: null, stages: [], aiConfigured: false, aiModel: '', emailProviderConfigured: false, settings: {}, analytics: null, radar: null },
  auth: { authenticated: false, setupRequired: false, username: '', csrfToken: '' }, authError: '',
  view: 'workbench', query: '', stageFilter: 'All stages', candidateFilter: 'All candidates', modal: null,
  settingsSection: 'integrations', auditLogs: null, auditQuery: '', analyticsRange: 30, analyticsLoading: false,
  bookingInfo: null, bookingLoading: false, bookingSubmitted: false, bookingError: '',
  optOutInfo: null, optOutDone: false,
  importInput: null, importReport: null, csvImportPreview: null, currentDate: new Date(), mobileMoreOpen: false,
  projectFilter: 'All provinces', copilot: null, copilotBusy: false, projectImportPreview: null, researchBusy: false, researchError: '', copilotTab: 'web'
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
// .icon-accent (small luminous dot: gradient + glow). Classless paths inherit the stroke defaults of .icon-svg.
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

function navItem(view, title, icon, count = null) {
  return `<button type="button" class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" aria-label="${esc(title)}" title="${esc(title)}">
    <span class="nav-icon">${svgIcon(icon)}</span><span class="nav-label">${esc(title)}</span>${count != null && count > 0 ? `<span class="nav-count">${count}</span>` : ''}
  </button>`;
}
function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); }
function settingsSectionLabel(section) { return ({ integrations: 'Integrations', team: 'Team & governance', briefings: 'Briefings', audit: 'Audit trail', research: 'Research', general: 'General' })[section] || (section ? section.charAt(0).toUpperCase() + section.slice(1) : ''); }

// ---- Command palette (⌘K / Ctrl+K) ----
const VIEW_META = [
  ['workbench', 'Outreach workbench', 'wand'], ['deliverability', 'Deliverability & sending engine', 'shield'], ['data', 'Data quality & merge reviews', 'database'], ['overview', 'Overview', 'overview'], ['discover', 'Discover candidates', 'globe'], ['projects', 'Verified projects', 'grid'], ['prospects', 'Prospects', 'prospects'],
  ['pipeline', 'Pipeline', 'pipeline'], ['briefings', 'Briefings', 'briefings'], ['sent', 'Sent outreach', 'mail'], ['partners', 'Partners', 'partners'],
  ['proposals', 'Proposals', 'proposals'], ['analytics', 'Analytics', 'analytics'], ['settings', 'Settings', 'settings']
];
function paletteItems(query) {
  const q = (query || '').trim().toLowerCase();
  const match = text => !q || text.toLowerCase().includes(q);
  const groups = [];
  const nav = VIEW_META.filter(([, title]) => match(title)).map(([view, title, icon]) => ({ id: 'view:' + view, group: 'Go to', icon, title, hint: 'View', run: () => setView(view) }));
  if (nav.length) groups.push(['Go to', nav]);
  const actions = [
    { id: 'act:new-lead', icon: 'plus', title: 'Add prospect', hint: 'Action', run: () => openModal('lead-form') },
    { id: 'act:import', icon: 'upload', title: 'Import candidates from CSV', hint: 'Action', run: () => { setView('discover'); setTimeout(() => $('#candidate-csv')?.click(), 50); } },
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
  const label = ({ workbench: 'Workbench', deliverability: 'Deliverability', data: 'Data quality', overview: 'Overview', discover: 'Discover', projects: 'Verified Projects', prospects: 'Prospects', pipeline: 'Pipeline', briefings: 'Briefings', sent: 'Sent', partners: 'Partners', proposals: 'Proposals', analytics: 'Analytics', settings: 'Settings' })[state.view] || 'Overview';
  const pending = state.data.bookings.filter(b => b.status === 'Requested').length;
  return `<header class="topbar">
    <div class="breadcrumb"><button type="button" class="icon-button mobile-menu" data-action="mobile-menu" aria-label="Toggle navigation">${svgIcon('menu')}</button><button type="button" class="crumb-root" data-view="overview">${svgIcon('overview')}Workspace</button><span class="crumb-sep">/</span><strong>${label}</strong>${state.settingsSection && state.view === 'settings' ? `<span class="crumb-sep">/</span><span>${esc(settingsSectionLabel(state.settingsSection))}</span>` : ''}</div>
    <div class="topbar-right">
      <label class="top-search">${svgIcon('search')}<input id="global-search" type="search" placeholder="Search or jump to…" value="${esc(state.query)}" aria-label="Search" /><kbd class="kbd" title="Command palette">${isMac() ? '⌘' : 'Ctrl'} K</kbd></label>
      <span class="top-separator"></span>
      <button type="button" class="icon-button" aria-label="Briefing requests" title="Briefing requests" data-view="briefings">${svgIcon('bell')}${pending ? '<span class="notification-dot"></span>' : ''}</button>
      ${state.auth.demoAccess ? '<span class="demo-access-badge">DEMO ADMIN</span>' : ''}<span class="avatar top-avatar top-avatar-wrap" title="${esc(state.auth.displayName || state.auth.username || 'Administrator')} · ${esc(roleLabel(state.auth.role))}">${initials(state.auth.displayName || state.auth.username || 'Administrator')}</span>
      ${state.auth.openAccessDemo ? '' : `<button type="button" class="icon-button sign-out-button" data-action="logout" aria-label="Sign out" title="Sign out">${svgIcon('logout')}</button>`}
    </div>
  </header>`;
}
function shellSidebar() {
  const pending = state.data.bookings.filter(b => b.status === 'Requested').length;
  return `<aside class="sidebar">
    <a class="brand" href="#" data-view="overview"><span class="brand-symbol">${svgIcon('target')}</span><span class="brand-copy"><span class="brand-name">Chelo</span><span class="brand-tag">impact partnerships</span></span></a>
    <div class="nav-caption">Workspace</div>
    <nav class="nav-list" aria-label="Main navigation">
      ${navItem('workbench', 'Workbench', 'wand', state.data.leads.filter(l => ['replied', 'needs-review', 'ready', 'approved'].includes(wbStatusOf(l))).length)}
      ${navItem('overview', 'Overview', 'overview')}
      ${navItem('discover', 'Discover', 'globe', state.data.candidates.filter(c => c.status === 'New candidate').length)}
      ${navItem('projects', 'Projects', 'grid', state.data.projects.filter(p => p.funding?.fundingGap > 0).length)}
      ${navItem('prospects', 'Prospects', 'prospects')}
      ${navItem('pipeline', 'Pipeline', 'pipeline')}
      ${navItem('briefings', 'Briefings', 'briefings', pending)}
      ${navItem('sent', 'Sent', 'mail')}
      ${navItem('partners', 'Partners', 'partners')}
      ${navItem('proposals', 'Proposals', 'proposals')}
      ${navItem('analytics', 'Analytics', 'analytics')}
      ${navItem('deliverability', 'Deliverability', 'shield', (state.data.mailboxes || []).filter(m => m.status === 'paused').length || null)}
      ${navItem('data', 'Data quality', 'database', state.dq.data ? (state.dq.data.openMergeReviews || 0) : null)}
      ${navItem('settings', 'Settings', 'settings')}
      <button type="button" class="nav-item mobile-more-button ${['projects','prospects','pipeline','briefings','sent','partners','proposals','settings'].includes(state.view) ? 'active' : ''}" data-action="mobile-more" aria-label="More sections" aria-haspopup="dialog" aria-expanded="${state.mobileMoreOpen ? 'true' : 'false'}" title="More sections"><span class="nav-icon">${svgIcon('dots')}</span><span class="nav-label">More</span></button>
    </nav>
    <div class="sidebar-spacer"></div>
    <div class="sidebar-card"><span class="tiny-label">Outreach workflow</span><strong>Source · personalise · connect</strong><p>Review local and CSV candidates, keep source details, then build considered partnerships.</p><div class="sidebar-progress"><span></span></div></div>
    <div class="user-mini"><span class="avatar">${initials(state.auth.displayName || state.auth.username || 'Admin')}</span><span class="user-copy"><strong>${esc(state.auth.displayName || state.auth.username || 'Administrator')}</strong><small>${state.auth.demoAccess ? 'Demo administrator · full access' : `${esc(roleLabel(state.auth.role))} · ${state.auth.approvalPolicy === 'four-eyes' ? '4-eyes approvals' : 'Single approver'}`}</small></span></div>
  </aside>`;
}
function renderMobileMoreMenu() {
  if (!state.mobileMoreOpen) return '';
  const items = [
    ['projects', 'Projects', 'grid'], ['prospects', 'Prospects', 'prospects'], ['pipeline', 'Pipeline', 'pipeline'],
    ['briefings', 'Briefings', 'briefings'], ['sent', 'Sent', 'mail'],
    ['partners', 'Partners', 'partners'], ['proposals', 'Proposals', 'proposals'],
    ['settings', 'Settings', 'settings']
  ];
  return `<div class="mobile-more-backdrop" id="mobile-more-backdrop"><section class="mobile-more-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title"><div class="mobile-more-heading"><div><span class="eyebrow">Workspace</span><h2 id="mobile-more-title">More sections</h2></div><button type="button" class="close-button" data-action="mobile-more-close" aria-label="Close navigation">${svgIcon('close')}</button></div><div class="mobile-more-grid">${items.map(([view, label, icon]) => `<button type="button" class="mobile-more-link ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}><span class="mobile-more-icon">${svgIcon(icon)}</span><span>${label}</span>${state.view === view ? '<span class="mobile-more-current">Current</span>' : ''}</button>`).join('')}</div></section></div>`;
}
function renderApp() {
  const app = $('#app');
  const demoWarning = state.auth.demoAccess ? `<div class="demo-admin-warning"><strong>${state.auth.openAccessDemo ? 'Open-access demo · full admin privileges.' : 'Demo admin · full access.'}</strong> Use only fictional sample data; do not enter real contacts, AI keys or SMTP credentials.</div>` : '';
  app.innerHTML = `<div class="app-shell">${shellSidebar()}<div class="main-shell">${shellHeader()}<main class="main-content">${demoWarning}${renderView()}</main></div>${renderMobileMoreMenu()}</div>`;
  $('#modal-root').innerHTML = renderModal();
}

function pageHead(eyebrow, title, subtitle, actions = '', variant = '') {
  const variantClass = variant ? ` page-head-${variant}` : '';
  return `<div class="page-head${variantClass}"><div><div class="eyebrow"><span class="eyebrow-dot"></span>${esc(eyebrow)}</div><h1>${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div><div class="head-actions">${actions}</div></div>`;
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
  return `${pageHead('Partnerships workspace', 'Make impact easier to fund.', `${today} · Manage outreach, briefings and long-term partners.`, `<button class="button button-secondary" data-view="discover">${svgIcon('globe')} Discover candidates</button><button class="button button-primary" data-action="new-lead">${svgIcon('plus')} Add prospect</button>`, 'overview')}
    ${state.dismissDemo ? '' : demoBanner()}
    <section class="metric-grid">
      ${metricCard('Open prospects', String(active.length), 'in active pipeline', 'prospects', `${leads.length} total`, false)}
      ${metricCard('Potential pipeline', shortMoney(getPipelineValue()), 'estimated ask value', 'trend', 'ZAR', false)}
      ${metricCard('Briefing requests', String(requests.length), 'awaiting confirmation', 'calendar', requests.length ? 'Needs review' : 'All clear', Boolean(requests.length))}
      ${metricCard('Active partners', String(state.data.partners.filter(p => p.status !== 'Inactive').length), 'won relationships', 'partners', `${money(state.data.partners.reduce((s, p) => s + Number(p.amount || 0), 0))} total`, false)}
    </section>
    <section class="dashboard-grid">
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('activity')}Pipeline pulse</h2><p class="panel-description">A quick view of prospects moving toward a briefing</p></div><button class="panel-action" data-view="pipeline">${svgIcon('kanban')}Open Kanban →</button></div>
        <div class="pipeline-summary">${stageHighlights.map(([name, count, target]) => `<div class="pipeline-stat"><span class="stage-name">${name}</span><strong>${count}</strong><div class="mini-bar"><span style="width:${Math.max(10, Math.min(100, (count / Math.max(1, leads.length)) * 100))}%"></span></div></div>`).join('')}</div>
        <div class="pipeline-list">${pipelineStages.map(s => { const count = leads.filter(l => l.stage === s).length; const val = leads.filter(l => l.stage === s).reduce((a, l) => a + Number(l.amount || 0), 0); return `<div class="pipeline-list-row"><span class="row-stage">${esc(s)}</span><div class="row-bar"><span style="width:${Math.max(2, Math.round((count / max) * 100))}%"></span></div><strong>${count} · ${shortMoney(val)}</strong></div>`; }).join('')}</div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('clock')}Follow-up queue</h2><p class="panel-description">Tasks surfaced from approved outreach</p></div><button class="panel-action" data-view="prospects">${svgIcon('prospects')}View prospects</button></div><div class="shortcut-list">${followupRows || `<div class="panel-empty"><strong>You're up to date</strong>No follow-up tasks are due yet.</div>`}</div></div>
    </section>
    <section class="bottom-grid">
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('prospects')}Recently updated prospects</h2><p class="panel-description">Source-backed relationships, not just names on a list</p></div><button class="panel-action" data-view="prospects">${svgIcon('arrow')}See all →</button></div><div class="lead-table-wrap"><table class="table"><thead><tr><th>Organisation / contact</th><th>Stage</th><th>Potential ask</th><th>Fit</th><th></th></tr></thead><tbody>${leadRows || `<tr><td colspan="5" class="panel-empty">No prospects yet.</td></tr>`}</tbody></table></div></div>
      <div class="panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('calendar')}Upcoming briefings</h2><p class="panel-description">Requests and confirmed conversations</p></div><button class="panel-action" data-view="briefings">${svgIcon('settings')}Manage →</button></div><div class="booking-list">${bookingRows || `<div class="panel-empty"><strong>No briefings scheduled</strong>When a donor requests a time, it will appear here.</div>`}</div></div>
    </section>${radarPanel}${signalsPanel()}`;
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
  return `${pageHead('Donor development', 'Prospects', 'Manage reviewed organisations in your outreach pipeline.', `<button class="button button-secondary" data-view="discover">${svgIcon('globe')} Discover leads</button><button class="button button-primary" data-action="new-lead">${svgIcon('plus')} Add prospect</button>`)}
    <div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>Human-reviewed sourcing:</strong> prospects enter the pipeline only after a team member reviews and adds them from Discover. CSV imports are held separately until approved.</span><a class="button button-ghost button-small" href="/sample-leads.csv" download>${svgIcon('download')}CSV template</a></div>
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="lead-search" type="search" placeholder="Search organisation, contact, project…" value="${esc(state.query)}" /></label><select class="select-control" id="stage-filter">${stages.map(s => `<option value="${esc(s)}" ${state.stageFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div><div class="control-right"><span class="subtle">${leads.length} prospect${leads.length === 1 ? '' : 's'}</span></div></div>
    <div class="panel lead-table-panel"><div class="lead-table-wrap"><table class="table"><thead><tr><th>Organisation / point of contact</th><th>Pipeline stage</th><th>Impact focus</th><th>Potential ask</th><th>Fit</th><th>Actions</th></tr></thead><tbody>${leadTableRows(leads) || `<tr><td colspan="6"><div class="panel-empty"><strong>No prospects found</strong>Change filters or add a new source-backed lead.</div></td></tr>`}</tbody></table></div></div>`;
}
function discoverView() {
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
    const intakeAction = check.status === 'ready'
      ? `<button class="button button-primary button-small" data-action="promote-candidate" data-id="${esc(c.id)}">${svgIcon('plus')}Add to pipeline</button>`
      : check.status === 'retry-required' || check.status === 'unchecked'
        ? `<button class="button button-secondary button-small" data-action="candidate-recheck" data-id="${esc(c.id)}">${svgIcon('refresh')}${check.status === 'unchecked' ? 'Run contact check' : 'Retry contact check'}</button>`
        : `<button class="button button-secondary button-small" data-action="candidate-review" data-id="${esc(c.id)}">${svgIcon('edit')}Complete details</button>`;
    return `<article class="candidate-card"><div class="candidate-card-main"><div class="candidate-org"><span class="candidate-avatar">${initials(c.company)}</span><div><h3>${esc(c.company)}</h3><span class="candidate-contact">${esc(c.contactName || 'Contact to verify')} · ${esc(c.title || c.sector || 'Prospective funder')}</span></div></div><div class="candidate-badges"><span class="fit-score"><span class="fit-dot"></span>${Number(c.fitScore || 0)}% fit</span>${wasAdded ? `<span class="status-pill status-confirmed">${esc(c.status)}</span>` : `<span class="status-pill status-requested">Review needed</span>`}</div><span class="candidate-health ${healthClass}">${esc(healthLabel)}</span><div class="verification-row"><span class="freshness-tag ${contactFreshness.className}">${esc(contactFreshness.text)}</span><span class="freshness-tag ${sourceFreshness.className}">${esc(sourceFreshness.text)}</span></div><p class="candidate-summary">${esc(c.notes || 'Review the source and confirm fit before adding this organisation.')}</p>${c.relationshipContext ? `<div class="candidate-context"><strong>Warm introduction:</strong> ${esc(c.relationshipContext)}</div>` : ''}${c.partnerPriorities ? `<div class="candidate-context"><strong>Partner priorities:</strong> ${esc(c.partnerPriorities)}</div>` : ''}<div class="candidate-meta"><span>${svgIcon('grid')}${esc(c.sector || 'Sector not set')}</span><span>${svgIcon('target')}${esc(c.project || 'Project not selected')}</span><span>${svgIcon('building')}${esc(c.sourceName || 'Source not supplied')}</span></div></div><div class="candidate-card-side"><div><small>Suggested ask · staff to confirm</small><strong>${money(c.amount)}</strong></div><div class="candidate-links">${source ? `<a class="text-link" href="${esc(source)}" target="_blank" rel="noopener noreferrer">View source ${svgIcon('external')}</a>` : `<span class="subtle">No source URL provided</span>`}${c.email ? `<a class="text-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</div>${wasAdded && c.promotedLeadId ? `<button class="button button-secondary button-small" data-action="open-lead" data-id="${esc(c.promotedLeadId)}">${svgIcon('eye')}Open pipeline record</button>` : wasAdded ? `<span class="subtle">Already in pipeline</span>` : `<div class="candidate-card-actions"><button class="button button-ghost button-small" data-action="candidate-review" data-id="${esc(c.id)}">${svgIcon('edit')}Edit details</button>${intakeAction}</div>`}</div></article>`;
  }).join('');
  return `${pageHead('Source · review · add', 'Discover', 'Review candidates from Chelo’s local prospect pool and CSV imports. Add each organisation to the pipeline individually.', `<button class="button button-secondary" data-action="candidate-import">${svgIcon('download')} Import CSV</button><a class="button button-ghost button-small" href="/sample-leads.csv" download>${svgIcon('download')}CSV template</a>`)}
    <div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>Human-reviewed discovery:</strong> CSV imports open a preview with column mapping, row-level warnings and exact-match duplicate suggestions. Server intake checks email syntax/domain, duplicates and opt-outs. Staff contact dates are separate from DNS/MX checks; a passing domain does not verify a mailbox.</span></div>
    <section class="metric-grid discover-metrics">${metricCard('Awaiting review', String(pending), 'candidates not yet added', 'globe')}${metricCard('Added to pipeline', String(added), 'human-approved prospects', 'checkCircle')}${metricCard('CSV imports', String(state.data.candidates.filter(c => c.sourceKind === 'CSV import' || /csv/i.test(c.sourceName || '')).length), 'local database records', 'download')}${metricCard('Web search', 'Not connected', 'intentional MVP boundary', 'search')}</section>
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="candidate-search" type="search" placeholder="Search candidates, contacts, projects…" value="${esc(state.query)}" /></label><select class="select-control" id="candidate-filter"><option value="All candidates" ${state.candidateFilter === 'All candidates' ? 'selected' : ''}>All candidates</option><option value="New candidate" ${state.candidateFilter === 'New candidate' ? 'selected' : ''}>Awaiting review</option><option value="Added to pipeline" ${state.candidateFilter === 'Added to pipeline' ? 'selected' : ''}>Added to pipeline</option><option value="Already in pipeline" ${state.candidateFilter === 'Already in pipeline' ? 'selected' : ''}>Already in pipeline</option></select></div><div class="control-right"><span class="subtle">${candidates.length} candidate${candidates.length === 1 ? '' : 's'}</span></div></div>
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
  return `${pageHead('Outreach activity', 'Sent', 'Track confirmed handoffs, first-party link clicks, manually recorded replies and briefing requests.', `<button class="button button-secondary" data-view="prospects">${svgIcon('prospects')} Open prospects</button>`)}
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
      return `<tr><td><span class="company-name">${esc(lead.company)}</span><span class="company-secondary">${esc(lead.contactName || lead.email || 'Contact')}</span></td><td>${isoDate(first.sentAt)}<span class="company-secondary">${esc(lead.emailStatus || 'Handoff confirmed')}</span></td><td>${leadMessages.length}<span class="company-secondary">${initialCount} initial · ${followUpCount} follow-up${followUpCount === 1 ? '' : 's'}</span></td><td>${clicked ? `<span class="event-count">${clicked}</span> link type${clicked === 1 ? '' : 's'}` : '—'}</td><td>${replied ? `<span class="event-positive">Recorded</span>` : '—'}</td><td>${booked ? `<span class="event-positive">Requested</span>` : '—'}</td><td>${esc(follow)}</td><td class="sent-actions">${!replied && !lead.doNotContact ? `<button class="table-action" type="button" data-action="mark-replied" data-id="${esc(lead.id)}">${svgIcon('reply')}Mark reply</button>` : ''}<button class="table-action" type="button" data-action="open-lead" data-id="${esc(lead.id)}">${svgIcon('eye')}Details</button></td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty-state"><div class="empty-state-icon">${svgIcon('mail')}</div><strong>No outreach confirmed yet</strong><p>Prepare and approve the text-only introductory email, hand it off to your email client, then confirm the handoff to start follow-up tracking.</p><button class="button button-primary" data-view="discover">${svgIcon('discover')}Review candidates</button></div>`}</div>`;
}
function pipelineView() {
  const visibleStages = (state.data.stages || []).filter(s => s !== 'Not proceeding');
  const query = state.query.toLowerCase().trim();
  return `${pageHead('Opportunity management', 'Pipeline', 'Drag a prospect across stages as the relationship develops.', `<button class="button button-secondary" data-action="new-lead">${svgIcon('plus')} Add prospect</button>`)}
    <div class="board-note"><span class="grip">⠿</span> Drag cards between stages. Marking a lead <strong>Won</strong> automatically creates a partner profile with its point of contact.</div>
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
  return `${pageHead('Donor conversations', 'Briefings', 'A “Yes” from a prospect becomes a time preference for Chelo to review and confirm.', '')}
    <div class="booking-grid"><div><div class="metric-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:480px">${metricCard('Awaiting confirmation', String(requested), 'date/time requests', 'clock', requested ? 'Review now' : 'All clear', Boolean(requested))}${metricCard('Confirmed briefings', String(confirmed), 'on the calendar manually', 'calendar', 'Calendar sync later', false)}</div><div class="booking-cards">${cards || `<div class="empty-state"><div class="empty-state-icon">${svgIcon('calendar')}</div><strong>No briefing requests yet</strong><p>When a donor follows the booking link in an approved email, their preferred date and time will be added here.</p></div>`}</div></div>
    <aside class="briefing-aside"><div class="aside-card dark"><h3 class="h-icon">${svgIcon('bell')}Booking requests</h3><p>The prospect chooses a preferred slot and leaves a phone number. Your team confirms the actual meeting time.</p><span class="aside-number">${requested}</span><p>need a team response</p></div><div class="aside-card"><h3 class="h-icon">${svgIcon('calendar')}Calendar invites</h3><p>Confirming a request emails an RFC 5545 .ics invite (Africa/Johannesburg) with the Google Meet, Microsoft Teams or Zoom link. Set default room links under Settings → Briefings.</p></div><div class="aside-card"><h3 class="h-icon">${svgIcon('video')}Default platform</h3><p>${esc(platformLabel(state.data.settings?.defaultPlatform))}${state.data.settings?.smtpConfigured ? ' · SMTP ready' : ' · SMTP not configured: download .ics and send manually'}</p></div></aside></div>`;
}
function partnersView() {
  const q = state.query.trim().toLowerCase();
  const partners = state.data.partners.filter(p => !q || [p.company, p.contactName, p.project, p.email, p.relationshipContext, p.partnerPriorities].join(' ').toLowerCase().includes(q));
  const total = state.data.partners.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const cards = partners.map(p => {
    const contactFreshness = verificationFreshness(p.contactLastVerifiedAt, 'Staff contact');
    const sourceFreshness = verificationFreshness(p.sourceLastVerifiedAt, 'Source');
    return `<article class="partner-card"><div class="partner-card-head"><div class="partner-logo">${initials(p.company)}</div><div><h3>${esc(p.company)}</h3><span>${esc(p.status || 'Active')} · Since ${isoDate(p.partnerSince)}</span></div><button class="table-action" style="margin-left:auto" type="button" data-action="edit-partner" data-id="${esc(p.id)}">${svgIcon('edit')}Edit</button></div><div class="partner-value"><div><small>Recorded contribution</small><strong>${money(p.amount)}</strong></div><span class="stage-pill pill-won">Won</span></div><div class="partner-contact"><span class="avatar">${initials(p.contactName)}</span><span><strong style="display:block;color:#2f2a5e;font-size:12px">${esc(p.contactName || 'Contact not set')}</strong><span style="display:block;margin-top:3px;color:#8d89a4">${esc(p.title || 'Point of contact')} · ${esc(p.email || 'No email')}</span><small class="freshness-tag ${contactFreshness.className}">${esc(contactFreshness.text)}</small></span></div><div class="partner-project"><strong>Impact focus:</strong> ${esc(p.project || 'Education impact partnership')}<br><span class="subtle">Relationship owner: ${esc(p.owner || 'Unassigned')}</span></div><div class="partner-priority-summary"><strong>Priorities & timing</strong><p>${esc(p.partnerPriorities || 'No partner priorities recorded yet.')}</p><strong>Relationship context</strong><p>${esc(p.relationshipContext || 'No warm-introduction or relationship path recorded.')}</p><small class="${sourceFreshness.className}">${esc(sourceFreshness.text)}${p.sourceLastVerifiedAt ? ` · ${esc(dateOnly(p.sourceLastVerifiedAt))}` : ''}</small></div></article>`;
  }).join('');
  return `${pageHead('Won relationships', 'Partners', 'Your trusted funders and points of contact, carried forward from won deals.', `<button class="button button-secondary" data-view="pipeline">${svgIcon('pipeline')} Open pipeline</button>`)}
    <section class="metric-grid">${metricCard('Active partners', String(state.data.partners.filter(p => p.status !== 'Inactive').length), 'relationship records', 'partners')}${metricCard('Total partner value', shortMoney(total), 'recorded contribution value', 'trend')}${metricCard('Won prospects', String(state.data.leads.filter(l => l.stage === 'Won').length), 'converted from pipeline', 'checkCircle')}${metricCard('Relationship owners', String(new Set(state.data.partners.map(p => p.owner).filter(Boolean)).size), 'team members', 'overview')}</section>
    <div class="page-controls"><div class="control-left"><label class="input-search">${svgIcon('search')}<input id="lead-search" type="search" placeholder="Search partners, relationships or priorities…" value="${esc(state.query)}" /></label></div><div class="control-right"><span class="subtle">${partners.length} partner${partners.length === 1 ? '' : 's'}</span></div></div>
    ${partners.length ? `<div class="partners-grid">${cards}</div>` : `<div class="empty-state"><div class="empty-state-icon">${svgIcon('partners')}</div><strong>No partner records yet</strong><p>Move a prospect to Won in the Kanban pipeline and Chelo will create a partner profile with its relationship and priorities context.</p><button class="button button-primary" data-view="pipeline">${svgIcon('pipeline')}Open pipeline</button></div>`}`;
}
function proposalsView() {
  const leads = sortRecent(state.data.leads.filter(l => !['Not proceeding'].includes(l.stage)));
  return `${pageHead('Impact proposals', 'Proposals', 'Generate, refine and review donor-specific proposals before creating a branded PDF.', `<button class="button button-primary" data-action="new-lead">${svgIcon('plus')} Add prospect</button>`)}
    <div class="note-callout" style="margin-bottom:15px"><span class="note-callout-icon">${svgIcon('info')}</span><span><strong>Chelo-guided drafting:</strong> proposals use the verified-recipient, traceability and impact-reporting context plus your project notes. Confirm project scope, contribution and every factual claim before sharing.</span></div>
    <div class="proposal-grid">${leads.map(l => `<article class="proposal-card"><div class="proposal-icon">${svgIcon('proposals')}</div><h3>${esc(l.company)}</h3><p>${esc(l.project || 'Education impact partnership')} · ${money(l.amount)} potential ask</p><div class="proposal-card-foot"><span>${l.proposalFile ? `Updated ${isoDate(l.updatedAt)}` : 'No PDF generated yet'}</span><div style="display:flex;gap:5px">${l.proposalFile ? `<a class="button button-secondary button-small" href="${proposalDownload(l)}" download>${svgIcon('download')} PDF</a>` : ''}<button class="button ${l.proposalFile ? 'button-ghost' : 'button-primary'} button-small" type="button" data-action="create-proposal" data-id="${esc(l.id)}">${svgIcon('proposals')}${l.proposalFile ? 'Edit & regenerate' : 'Create PDF'}</button></div></div>${l.proposalFile ? `<div class="proposal-card-foot" style="margin-top:10px;padding-top:9px"><span>Share after briefing or on request</span><div><button class="table-action" data-action="copy-proposal-link" data-id="${esc(l.id)}">${svgIcon('copy')}Copy secure link</button><button class="table-action" data-action="email" data-id="${esc(l.id)}">${svgIcon('mail')}Draft email</button></div></div>` : ''}</article>`).join('')}</div>`;
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
function analyticsView() {
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
  return `${pageHead('Engagement reporting', 'Analytics', 'Measure approved outreach, opens and preferred-time CTA engagement.', actions)}
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
  return `<div class="panel audit-panel"><div class="panel-header"><div><h2 class="panel-title">${svgIcon('shield')}Audit trail</h2><p class="panel-description">Application-level activity retained for up to 365 days. Secret values and message bodies are excluded.</p></div><a class="button button-secondary button-small" href="/api/audit/export.csv${state.auditQuery.trim() ? `?query=${encodeURIComponent(state.auditQuery.trim())}` : ''}" download>${svgIcon('download')} Export CSV</a></div><div class="audit-controls"><label class="input-search">${svgIcon('search')}<input id="audit-search" type="search" value="${esc(state.auditQuery)}" placeholder="Search actor, action or record…" /></label><span class="subtle">${logs.length} entries</span></div><div class="lead-table-wrap"><table class="table audit-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Summary</th></tr></thead><tbody>${rows || `<tr><td colspan="5"><div class="panel-empty">${state.auditLogs === null ? 'Loading audit trail…' : 'No matching audit entries.'}</div></td></tr>`}</tbody></table></div><div class="audit-footer">This application audit trail is append-oriented and access-controlled, but is not a tamper-proof or compliance-certified log. Back up and protect the server data directory.</div></div>`;
}
function settingsView() {
  const settings = state.data.settings || {};
  const aiState = settings.aiConfigured ? `Configured · ${settings.aiKeySource === 'environment' ? 'server environment' : 'encrypted Settings'}` : 'Not configured';
  const smtpState = settings.smtpConfigured ? `Configured · ${settings.smtpHost}:${settings.smtpPort}` : 'Not configured';
  const content = state.settingsSection === 'audit' ? auditView() : `<div class="settings-status-grid"><div class="settings-status-card"><span class="metric-icon">${svgIcon('spark')}</span><div><strong>AI drafting</strong><small>${esc(aiState)}</small></div><span class="status-dot ${settings.aiConfigured ? 'is-on' : ''}"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('mail')}</span><div><strong>SMTP sending</strong><small>${esc(smtpState)}</small></div><span class="status-dot ${settings.smtpConfigured ? 'is-on' : ''}"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('eye')}</span><div><strong>Open measurement</strong><small>${settings.openTrackingReady ? 'Pixel ready · public HTTPS URL set' : settings.openTrackingEnabled ? 'Enabled · needs public HTTPS URL' : 'Disabled'}</small></div><span class="status-dot ${settings.openTrackingReady ? 'is-on' : ''}"></span></div></div>
    <form id="settings-form" data-form="settings" class="settings-form"><section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('spark')}</span><div><h2>AI provider</h2><p>Optional OpenAI-compatible endpoint for proposal and email copy. Use HTTPS except for loopback testing. Secrets stay on the server and are never returned to the browser.</p></div></div><div class="settings-fields"><div class="form-group"><label for="setting-ai-endpoint">Chat completions endpoint</label><input class="form-control" id="setting-ai-endpoint" name="aiEndpoint" type="url" value="${esc(settings.aiEndpoint || 'https://api.openai.com/v1/chat/completions')}" placeholder="https://api.openai.com/v1/chat/completions" /></div><div class="form-group"><label for="setting-ai-model">Model</label><input class="form-control" id="setting-ai-model" name="aiModel" value="${esc(settings.aiModel || 'gpt-4o-mini')}" /></div><div class="form-group full"><label for="setting-ai-key">API key <span class="optional">(leave blank to keep current)</span></label><input class="form-control" id="setting-ai-key" name="aiApiKey" type="password" autocomplete="new-password" placeholder="${settings.aiConfigured ? 'Key is stored; value is hidden' : 'Paste API key'}" /></div><label class="check-row"><input type="checkbox" name="clearAiKey" /> Remove saved AI key <small>Environment keys, if set, remain active.</small></label></div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-action="test-ai">${svgIcon('spark')} Test AI connection</button></div></section>
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('globe')}</span><div><h2>Web research provider</h2><p>Powers the Research copilot's funder briefs. Only staff-initiated, organisation-level lookups run; fetched pages are PII-scrubbed before any AI call and every finding is cited for human review. Without a provider, research reads the funder's official website (Source URL) only.</p></div></div><div class="settings-fields"><div class="form-group"><label for="setting-search-provider">Provider</label><select class="form-control" id="setting-search-provider" name="searchProvider">${['none','tavily','serper','bing'].map(v => `<option value="${v}" ${(settings.searchProvider || 'none') === v ? 'selected' : ''}>${{ none: 'None (official website only)', tavily: 'Tavily', serper: 'Serper (Google)', bing: 'Bing Web Search' }[v]}</option>`).join('')}</select></div><div class="form-group"><label for="setting-search-key">Search API key <span class="optional">(leave blank to keep current)</span></label><input class="form-control" id="setting-search-key" name="searchApiKey" type="password" autocomplete="new-password" placeholder="${settings.searchConfigured ? 'Key is stored; value is hidden' : 'Paste search API key'}" /></div><label class="check-row"><input type="checkbox" name="clearSearchKey" /> Remove saved search key <small>SEARCH_PROVIDER / SEARCH_API_KEY environment values, if set, remain active.</small></label></div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-action="test-search">${svgIcon('globe')} Test search provider</button><span class="subtle">${settings.searchConfigured ? `Configured · ${esc(settings.searchProvider)} · ${settings.searchKeySource === 'environment' ? 'server environment' : 'encrypted Settings'}` : 'Not configured'}</span></div></section>
      <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>Email sending</h2><p>Sending mailboxes, domain authentication (SPF/DKIM/DMARC), daily caps, ramps and the send queue now live under <strong>Deliverability</strong>. ${settings.smtpConfigured ? 'Your previous SMTP settings were migrated into the first mailbox.' : ''}</p></div></div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-view="deliverability">${svgIcon('shield')} Open Deliverability</button></div></section>
      <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon gold">${svgIcon('eye')}</span><div><h2>Analytics & tracking</h2><p>First-party CTA hits are counted by Chelo. Open measurement uses a 1×1 tracking pixel and is approximate; image proxies, privacy features and blockers may distort it.</p></div></div><div class="settings-fields"><label class="check-row"><input type="checkbox" name="openTrackingEnabled" ${settings.openTrackingEnabled ? 'checked' : ''} /> Add open-tracking pixel to SMTP and .eml emails</label><div class="form-group full"><label for="setting-public-url">Public HTTPS app URL</label><input class="form-control" id="setting-public-url" name="publicBaseUrl" type="url" value="${esc(settings.publicBaseUrl || (location.protocol === 'https:' ? location.origin : ''))}" placeholder="https://partnerships.example.org" /><span class="form-hint">The recipient’s mail client must be able to reach this HTTPS address to load the pixel and CTA. Localhost and private preview URLs will not track opens for external recipients.</span></div></div><div class="settings-card-actions"><button class="button button-primary" type="submit">${svgIcon('check')} Save settings</button></div></section></form>`;
  const isAdmin = state.auth.role === 'admin' || state.auth.demoAccess;
  const sectionContent = state.settingsSection === 'governance' ? governanceView(isAdmin) : state.settingsSection === 'briefings' ? briefingsSettingsView(settings) : content;
  const tabs = `<div class="settings-tabs" role="tablist"><button type="button" class="settings-tab ${state.settingsSection === 'integrations' ? 'active' : ''}" data-settings-tab="integrations">${svgIcon('settings')} Integrations</button><button type="button" class="settings-tab ${state.settingsSection === 'governance' ? 'active' : ''}" data-settings-tab="governance">${svgIcon('shield')} Team & governance</button><button type="button" class="settings-tab ${state.settingsSection === 'briefings' ? 'active' : ''}" data-settings-tab="briefings">${svgIcon('calendar')} Briefings & inbound</button><button type="button" class="settings-tab ${state.settingsSection === 'audit' ? 'active' : ''}" data-settings-tab="audit">${svgIcon('activity')} Audit trail</button></div>`;
  return `${pageHead('Workspace controls', 'Settings', 'Protect access, connect providers and review the application activity trail.', state.auth.openAccessDemo ? '' : `<button class="button button-secondary" data-action="logout">${svgIcon('logout')} Sign out</button>`)}${tabs}${sectionContent}`;
}
function authGateView() {
  const setup = Boolean(state.auth.setupRequired);
  const title = setup ? 'Create your admin account' : 'Welcome back';
  const intro = setup ? 'Set up the first Chelo workspace administrator before connecting services.' : 'Sign in to your protected Chelo partnerships workspace.';
  const fields = setup ? `<div class="form-group"><label for="auth-password-confirm">Confirm password</label><input class="form-control" id="auth-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></div>` : '';
  const submit = setup ? 'Create admin account' : 'Sign in';
  return `<main class="auth-screen"><section class="auth-card"><div class="auth-brand"><span class="brand-symbol">${svgIcon('target')}</span><span><strong>Chelo</strong><small>impact partnerships</small></span></div><span class="auth-kicker">SECURE WORKSPACE</span><h1>${title}</h1><p class="auth-intro">${intro}</p>${state.authError ? `<div class="form-error">${esc(state.authError)}</div>` : ''}<form class="auth-form" data-form="${setup ? 'auth-setup' : 'auth-login'}">${setup ? `<div class="form-group"><label for="auth-display">Your name</label><input class="form-control" id="auth-display" name="displayName" autocomplete="name" required placeholder="e.g. Nandi M." /></div>` : ''}<div class="form-group"><label for="auth-username">${setup ? 'Admin email' : 'Staff email'}</label><input class="form-control" id="auth-username" name="username" type="email" autocomplete="username" required placeholder="you@cheloapp.com" /></div><div class="form-group"><label for="auth-password">${setup ? 'Create password' : 'Password'}</label><input class="form-control" id="auth-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? '12' : '1'}" required placeholder="${setup ? 'At least 12 characters' : 'Enter your password'}" /></div>${fields}<button type="submit" class="button button-primary auth-submit">${svgIcon(setup ? 'lock' : 'arrow')} ${submit}</button></form>${state.auth.demoAccessAvailable ? `<div class="auth-demo-divider"><span>or explore</span></div><button type="button" class="button button-secondary auth-demo-button" data-action="demo-login">${svgIcon('eye')} Enter demo as admin</button><p class="auth-demo-warning">Full admin access to the demo workspace. Only use with fictional data and an isolated, disposable data directory.</p>` : ''}<p class="auth-security-note">${svgIcon('shield')} Credentials and provider secrets are processed server-side. Use a unique password and keep this workspace on a trusted network.</p>${setup ? `<p class="auth-first-run-warning">Complete first-run setup before exposing the app to other networks.</p>` : ''}</section><div class="auth-orb auth-orb-one"></div><div class="auth-orb auth-orb-two"></div></main>`;
}
function renderView() {
  switch (state.view) {
    case 'workbench': return workbenchView();
    case 'deliverability': return deliverabilityView();
    case 'data': return dataQualityView();
    case 'discover': return discoverView();
    case 'projects': return projectsView();
    case 'prospects': return prospectsView();
    case 'pipeline': return pipelineView();
    case 'briefings': return bookingsView();
    case 'sent': return sentView();
    case 'partners': return partnersView();
    case 'proposals': return proposalsView();
    case 'analytics': return analyticsView();
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
  if (type === 'project-form') return projectFormModal(state.data.projects.find(p => p.id === id));
  if (type === 'project-detail') return projectDetailModal(state.data.projects.find(p => p.id === id));
  if (type === 'project-import') return projectImportModal(state.projectImportPreview);
  if (type === 'copilot') return copilotModal();
  if (type === 'research') return researchModal(getLead(id));
  if (type === 'staff-form') return staffFormModal(state.data.staff.find(u => u.id === id));
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
  const actions = `<button class="button button-primary button-small" data-action="create-outreach" data-id="${esc(lead.id)}" ${lead.doNotContact ? 'disabled title="On do-not-contact list"' : ''}>${svgIcon('spark')} Prepare intro email</button><button class="button button-secondary button-small" data-action="email" data-id="${esc(lead.id)}" ${lead.doNotContact ? 'disabled title="On do-not-contact list"' : ''}>${svgIcon('mail')} Email only</button><button class="button button-secondary button-small" data-action="create-proposal" data-id="${esc(lead.id)}" ${lead.doNotContact ? 'disabled title="On do-not-contact list"' : ''}>${svgIcon('proposals')} Proposal PDF only</button><button class="button button-secondary button-small" data-action="edit-lead" data-id="${esc(lead.id)}">${svgIcon('edit')} Edit</button>${lead.doNotContact ? `<span class="status-pill status-requested" title="Hashed suppression remains after contact details are deleted">Opt-out suppression active</span>` : `<button class="button button-ghost button-small" data-action="opt-out" data-id="${esc(lead.id)}">${svgIcon('ban')}Do not contact</button>`}`;
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
    ${activities.length ? `<div class="detail-section"><div class="detail-section-title"><span class="section-title-text">${svgIcon('activity')}Recent activity</span></div>${activities.map(a => `<div class="shortcut-row"><div class="shortcut-icon">${svgIcon(a.type === 'booking' ? 'calendar' : a.type === 'proposal' ? 'proposals' : 'check')}</div><div class="shortcut-copy"><strong>${esc(a.text)}</strong><span>${isoDate(a.createdAt)}</span></div></div>`).join('')}</div>` : ''}`;
  const footer = `<div class="modal-footer-left"><span class="subtle">Created ${isoDate(lead.createdAt)}</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Close</button>${lead.stage !== 'Won' ? `<button type="button" class="button button-primary" data-action="mark-won" data-id="${esc(lead.id)}">${svgIcon('trophy')}Mark as won</button>` : `<button class="button button-lime" data-view="partners">${svgIcon('partners')}View partner</button>`}</div>`;
  return modalFrame('Prospect details', 'Review context and take the next step.', body, footer);
}
function proposalModal(lead) {
  if (!lead) return '';
  const saved = lead.proposalData || {};
  const aiConfigured = Boolean(state.data.aiConfigured);
  const aiNote = aiConfigured
    ? `AI drafting is connected${state.data.aiModel ? ` (${esc(state.data.aiModel)})` : ''}. It can use aggregate preferred-time outcomes as a directional hint for future wording; it cannot change the staff-selected ask or verified facts.`
    : 'AI is not connected in this preview. The guided local draft demonstrates the workflow; configure OPENAI_API_KEY on the server for model-generated drafts and rewrites.';
  const body = `<form id="proposal-form" data-form="proposal" data-id="${esc(lead.id)}"><input type="hidden" name="generationMode" id="p-generation-mode" value="${esc(saved.generationMode || 'manual')}" />
    <div class="ai-guidance-card"><div class="ai-guidance-icon">${svgIcon('spark')}</div><div><strong>${aiConfigured ? 'AI-guided proposal writing' : 'Guided proposal preview'}</strong><p>${aiNote}</p><small>Guardrails: verified recipients · traceable funding · impact reporting · no invented metrics or unconfirmed outcomes.</small></div></div>
    ${researchBriefCard(lead, 'proposal')}
    <div class="form-grid">
    <div class="form-group full"><label for="p-company">Prepared for</label><input class="form-control" id="p-company" name="company" value="${esc(saved.company || lead.company)}" required readonly /></div>
    <div class="form-group"><label for="p-contact">Attention</label><input class="form-control" id="p-contact" name="contactName" value="${esc(saved.contactName || lead.contactName || '')}" readonly /></div>
    <div class="form-group"><label for="p-amount">Staff-selected contribution (ZAR)</label><input class="form-control" id="p-amount" name="amount" type="number" min="0" step="1000" value="${Number(saved.amount ?? lead.amount ?? 0) || ''}" readonly /></div>
    <div class="form-group full"><label for="p-project">Staff-selected project / impact focus</label><input class="form-control" id="p-project" name="project" value="${esc(saved.project || lead.project || '')}" required readonly /><span class="form-hint">To change the ask, return to Prepare outreach. This editor changes proposal wording only.</span></div>
    <div class="form-group full"><label for="p-user-notes">Chelo project and campaign notes</label><textarea class="form-control" id="p-user-notes" name="userNotes" maxlength="3000" placeholder="Add verified project facts, community need, intended use of funds, milestones, reporting needs and anything the proposal should reflect.">${esc(saved.userNotes || '')}</textarea><span class="form-hint">Use confirmed information only; avoid sensitive personal details. Notes guide the draft and are not printed verbatim in the PDF.</span></div>
    <div class="form-group full"><label for="p-verified-metrics">Verified metric comparisons <span class="optional">(optional, up to 3)</span></label><textarea class="form-control metric-entry" id="p-verified-metrics" name="verifiedMetrics" rows="3" placeholder="Attendance rate | 72 | 85 | % | 2024 to 2025 | School attendance summary, p. 4">${esc(verifiedMetricsText(saved.verifiedMetrics))}</textarea><span class="form-hint">One comparison per line: Metric | baseline | latest | unit | period | source. Cite a source you have checked. Leave blank if there is no verified comparable data; the PDF will not invent values.</span></div>
    <div class="form-group full"><label for="p-opening">Partnership summary</label><textarea class="form-control" id="p-opening" name="opening" maxlength="180" placeholder="Generate a guided draft or write this section.">${esc(saved.opening || '')}</textarea></div>
    <div class="form-group full"><label for="p-impact">The opportunity</label><textarea class="form-control" id="p-impact" name="impact" maxlength="260" placeholder="What need will this partnership help address?">${esc(saved.impact || '')}</textarea></div>
    <div class="form-group full"><label for="p-rationale">Why Chelo</label><textarea class="form-control" id="p-rationale" name="rationale" maxlength="300">${esc(saved.rationale || '')}</textarea></div>
    <div class="form-group full"><label for="p-next">Recommended next step</label><textarea class="form-control" id="p-next" name="nextStep" maxlength="200">${esc(saved.nextStep || '')}</textarea></div>
    <div class="form-group full"><label for="p-rewrite-notes">Rewrite request <span class="optional">(optional)</span></label><textarea class="form-control" id="p-rewrite-notes" name="rewriteNotes" maxlength="1000" placeholder="e.g. Make it more concise, lead with school solar, and keep the ask tentative.">${esc(saved.rewriteNotes || '')}</textarea></div>
    <div class="form-group full ai-action-row"><button type="button" class="button button-secondary button-small" data-action="proposal-draft" data-id="${esc(lead.id)}">${svgIcon('spark')} ${aiConfigured ? 'Generate AI draft' : 'Generate guided draft'}</button><button type="button" class="button button-secondary button-small" data-action="proposal-rewrite" data-id="${esc(lead.id)}">${svgIcon('wand')}${aiConfigured ? 'Request rewrite' : 'Preview rewrite'}</button><span id="proposal-draft-status" class="subtle">${esc(saved.generationMode === 'openai' ? 'Last draft generated with AI.' : saved.generationMode === 'guided-preview' ? 'Last draft was a local guided preview.' : 'Draft copy is editable before PDF generation.')}</span></div>
    </div></form>`;
  const footer = `<div class="modal-footer-left"><span class="subtle">${lead.proposalFile ? 'Regenerating replaces the previous PDF.' : 'Review content before creating the PDF.'}</span></div><div class="modal-footer-right"><button class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="proposal-form" class="button button-primary">${svgIcon('proposals')} Generate proposal PDF</button></div>`;
  return modalFrame('Personalise the proposal', `Create a guided, donor-specific proposal for ${lead.company}.`, body, footer, true);
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

If the timing is not right, no problem. To stop further outreach, use this link: ${optOut}

Kind regards,
Chelo Partnerships Team`;
  } else {
    subject = makeClientOutreachSubject(company, project);
    body = `${greeting}

I’m reaching out because ${company}’s work in ${lead.sector || 'community investment'} may align with Chelo’s focus on verified schools, NGOs and community projects, with traceable funding and progress reporting.

One possible focus is ${project}${amount}. Scope and feasibility would be validated with the project partner before any commitment. A short video conversation would let us hear your priorities, share how Chelo works, and explore whether a next step makes sense.

Which education or community-impact priorities are most important to your team this year?

Yes — choose a time for a ${INTRO_MEETING_MINUTES}-minute introductory video briefing: ${book}
Chelo will review your preferred time and confirm it personally. No preparation or commitment is required.

If you prefer not to receive further outreach, opt out here: ${optOut}

Kind regards,
Chelo Partnerships Team`;
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
  const questionMarks = (body.match(/\?/g) || []).length;
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
    ${approval ? `<div class="approval-trail"><span class="approval-trail-title">${svgIcon('shield')} Approval trail${fourEyes ? ' · 4-eyes policy' : ''}</span><span>1st · ${esc(approval.firstApprover || '—')} · ${approval.firstApprovedAt ? isoDate(approval.firstApprovedAt) : ''}</span>${approval.secondApprover ? `<span>2nd · ${esc(approval.secondApprover)} · ${isoDate(approval.secondApprovedAt)}</span>` : pendingSecond ? `<span class="approval-pending">Awaiting countersignature by a different Admin or Reviewer</span>` : ''}<small>Digest ${esc(String(approval.digest || '').slice(0, 20))}… · content is locked; any edit voids approval.</small></div>` : ''}
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
  const body = `<form id="partner-form" data-form="partner" data-id="${esc(partner.id)}"><div class="form-grid"><div class="form-group full"><label for="partner-company">Partner organisation</label><input class="form-control" id="partner-company" name="company" value="${esc(partner.company)}" required /></div><div class="form-group"><label for="partner-contact">Point of contact</label><input class="form-control" id="partner-contact" name="contactName" value="${esc(partner.contactName || '')}" /></div><div class="form-group"><label for="partner-title">Role / title</label><input class="form-control" id="partner-title" name="title" value="${esc(partner.title || '')}" /></div><div class="form-group"><label for="partner-email">Email</label><input class="form-control" id="partner-email" name="email" type="email" value="${esc(partner.email || '')}" /></div><div class="form-group"><label for="partner-phone">Phone</label><input class="form-control" id="partner-phone" name="phone" value="${esc(partner.phone || '')}" /></div><div class="form-group"><label for="partner-contact-verified">Contact last verified by staff</label><input class="form-control" id="partner-contact-verified" name="contactLastVerifiedAt" type="date" value="${esc(verificationDateValue(partner.contactLastVerifiedAt))}" /><span class="form-hint">Separate from any email-domain check.</span></div><div class="form-group"><label for="partner-source-verified">Source last checked</label><input class="form-control" id="partner-source-verified" name="sourceLastVerifiedAt" type="date" value="${esc(verificationDateValue(partner.sourceLastVerifiedAt))}" /></div><div class="form-group"><label for="partner-amount">Contribution value (ZAR)</label><input class="form-control" id="partner-amount" name="amount" type="number" min="0" step="1000" value="${Number(partner.amount || 0)}" /></div><div class="form-group"><label for="partner-status">Relationship status</label><select class="form-control" id="partner-status" name="status"><option ${partner.status === 'Active' ? 'selected' : ''}>Active</option><option ${partner.status === 'Stewardship' ? 'selected' : ''}>Stewardship</option><option ${partner.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></div><div class="form-group full"><label for="partner-project">Project focus</label><input class="form-control" id="partner-project" name="project" value="${esc(partner.project || '')}" /></div><div class="form-group"><label for="partner-owner">Relationship owner</label><input class="form-control" id="partner-owner" name="owner" value="${esc(partner.owner || '')}" /></div><div class="form-group"><label for="partner-source-name">Key public source</label><input class="form-control" id="partner-source-name" name="sourceName" value="${esc(partner.sourceName || '')}" /></div><div class="form-group full"><label for="partner-source-url">Source URL</label><input class="form-control" id="partner-source-url" name="sourceUrl" type="url" value="${esc(partner.sourceUrl || '')}" /></div><div class="form-group full"><label for="partner-relationship">Relationship / warm-introduction context</label><textarea class="form-control" id="partner-relationship" name="relationshipContext" maxlength="800">${esc(partner.relationshipContext || '')}</textarea></div><div class="form-group full"><label for="partner-priorities">Partner priorities & timing</label><textarea class="form-control" id="partner-priorities" name="partnerPriorities" maxlength="1200" placeholder="Education/community priorities, budget cycle, upcoming decisions, employee engagement or in-kind support.">${esc(partner.partnerPriorities || '')}</textarea></div><div class="form-group full"><label for="partner-notes">Stewardship notes</label><textarea class="form-control" id="partner-notes" name="notes">${esc(partner.notes || '')}</textarea></div></div></form>`;
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
async function refresh() {
  try { state.data = await API('/api/init'); renderApp(); }
  catch (error) {
    if (error.status === 401) { state.auth = await API('/api/auth/status').catch(() => ({ authenticated: false, setupRequired: false })); renderAuthGate(); return; }
    throw error;
  }
}
async function loadAnalytics(days = state.analyticsRange) {
  state.analyticsLoading = true;
  try { state.data.analytics = await API(`/api/analytics?days=${encodeURIComponent(days)}`); }
  catch (error) { toast(error.message || 'Could not load analytics.', true); }
  finally { state.analyticsLoading = false; if (state.view === 'analytics') renderApp(); }
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
function setView(view) {
  state.view = view; state.modal = null; state.mobileMoreOpen = false;
  if (!['workbench', 'discover', 'prospects', 'pipeline', 'partners', 'sent', 'projects'].includes(view)) state.query = '';
  if (view === 'workbench') wbRunPending();
  if (view === 'overview') loadRadar();
  renderApp(); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'analytics') loadAnalytics(state.analyticsRange);
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
  if (String(button.dataset.action || '').startsWith('wb-')) { if (await wbAction(button.dataset.action, button)) return; }
  if (String(button.dataset.action || '').startsWith('dlv-')) { if (await dlvAction(button.dataset.action, button)) return; }
  if (String(button.dataset.action || '').startsWith('dq-')) { if (await dqAction(button.dataset.action, button)) return; }
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
        const result = await API(`/api/settings/${action}`, { method: 'POST', body: '{}' });
        toast(result.message || 'Connection test succeeded.');
      } finally { button.disabled = false; }
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
      const result = await API(`/api/candidates/${encodeURIComponent(id)}/promote`, { method: 'POST', body: '{}' });
      if (result.deleted) { await refresh(); return toast(result.error || 'Candidate was removed after its contact check.'); }
      if (!result.lead) { await refresh(); return toast('Candidate was already added; no new pipeline record was created.'); }
      state.view = 'prospects'; state.query = ''; await refresh();
      if (result.alreadyAdded) toast('This organisation already exists in the pipeline.');
      else { openModal('lead-detail', result.lead.id); toast('Candidate added to the pipeline. Choose a project, amount and notes before generating outreach.'); }
      return;
    }
    if (action === 'edit-lead') return openModal('lead-form', id);
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
    if (action === 'copilot-tab') { state.copilotTab = button.dataset.tab === 'paste' ? 'paste' : 'web'; renderApp(); return; }
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
      if (action === 'research-approve' && !payload.approvedFindingIds.length && !payload.approvedAlignmentIds.length) return toast('Tick at least one finding or alignment point, or reject the brief.', true);
      button.disabled = true;
      try {
        await API(`/api/leads/${encodeURIComponent(lead.id)}/research/review`, { method: 'POST', body: JSON.stringify(payload) });
        await refresh();
        toast(action === 'research-approve' ? `Brief approved: ${payload.approvedFindingIds.length} finding(s) and ${payload.approvedAlignmentIds.length} alignment point(s) will inform the email and PDF.` : 'Brief rejected; drafting will not use it.');
        const returnTo = state.modal?.returnTo; state.modal = returnTo && returnTo.type ? returnTo : { type: 'lead-detail', id: lead.id }; renderApp();
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
    if (action === 'toggle-staff') {
      const user = state.data.staff.find(u => u.id === id); if (!user) return;
      await API(`/api/staff/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ active: !user.active }) });
      await refresh(); toast(user.active ? 'Account deactivated and sessions revoked.' : 'Account reactivated.'); return;
    }
    if (action === 'set-approval-policy') {
      await API('/api/settings', { method: 'PUT', body: JSON.stringify({ approvalPolicy: button.dataset.policy }) });
      state.auth = await API('/api/auth/status'); await refresh(); toast(button.dataset.policy === 'four-eyes' ? 'Strict 4-eyes approval enabled for all outbound email.' : 'Single-approver policy enabled.'); return;
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
      const fields = getEmailFields();
      if (!fields.subject || !fields.body) return toast('Add a subject and email body first.', true);
      const followUp = button.dataset.followUp === 'true';
      await API(`/api/leads/${encodeURIComponent(id)}/approve-email`, { method: 'POST', body: JSON.stringify({ ...fields, kind: followUp ? 'follow-up' : 'initial', attachProposal: Boolean(followUp && followUpPdfSelected(getLead(id))) }) });
      if (state.modal) delete state.modal.editedDraft;
      await refresh();
      const updated = getLead(id);
      const status = followUp ? updated?.followUpEmailStatus : updated?.emailStatus;
      toast(status === 'Pending second approval' ? 'First approval recorded. A different Admin or Reviewer must countersign before handoff.' : 'Email approved. Open it in your email client when ready.'); return;
    }
    if (action === 'email-countersign') {
      const followUp = button.dataset.followUp === 'true';
      await API(`/api/leads/${encodeURIComponent(id)}/approve-email`, { method: 'POST', body: JSON.stringify({ kind: followUp ? 'follow-up' : 'initial', confirmSecond: true }) });
      await refresh(); toast('Countersigned. The email is now approved for handoff.'); return;
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
  } catch (err) { toast(err.message || 'Something went wrong.', true); }
}

async function handleSubmit(event) {
  const form = event.target;
  const type = form.dataset.form;
  if (!type) return;
  event.preventDefault();
  if (type === 'wb-add') return wbAddSubmit(form);
  if (type === 'dlv-mailbox') return dlvMailboxSubmit(form);
  if (type === 'dlv-policy') return dlvPolicySubmit(form);
  try {
    if (type === 'auth-setup' || type === 'auth-login') {
      const data = formDataObject(form);
      if (type === 'auth-setup' && data.password !== data.confirmPassword) { state.authError = 'The passwords do not match.'; renderAuthGate(); return; }
      const result = await API(type === 'auth-setup' ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: data.username, password: data.password, displayName: data.displayName }) });
      state.auth = result; state.authError = ''; state.view = 'overview';
      await refresh(); toast(type === 'auth-setup' ? 'Admin account created. Welcome to Chelo.' : 'Signed in.'); return;
    }
    if (type === 'settings') {
      const data = formDataObject(form);
      data.smtpSecure = Boolean(form.elements.smtpSecure?.checked);
      data.openTrackingEnabled = Boolean(form.elements.openTrackingEnabled?.checked);
      data.clearAiKey = Boolean(form.elements.clearAiKey?.checked);
      data.clearSmtpPassword = Boolean(form.elements.clearSmtpPassword?.checked);
      if (form.elements.autoSendCalendarInvite) data.autoSendCalendarInvite = Boolean(form.elements.autoSendCalendarInvite.checked);
      if (form.elements.clearImapPassword) data.clearImapPassword = Boolean(form.elements.clearImapPassword.checked);
      if (form.elements.clearSearchKey) data.clearSearchKey = Boolean(form.elements.clearSearchKey.checked);
      if (!form.elements.smtpSecure) delete data.smtpSecure;
      if (!form.elements.openTrackingEnabled) delete data.openTrackingEnabled;
      if (!form.elements.clearAiKey) delete data.clearAiKey;
      if (!form.elements.clearSmtpPassword) delete data.clearSmtpPassword;
      await API('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
      await refresh(); toast('Settings saved securely on the server.'); return;
    }
    if (type === 'project') {
      const data = formDataObject(form);
      const result = form.dataset.id
        ? await API(`/api/projects/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) })
        : await API('/api/projects', { method: 'POST', body: JSON.stringify(data) });
      state.modal = null; await refresh(); toast(form.dataset.id ? `Project updated: ${result.name}` : `Verified project added: ${result.name}`); return;
    }
    if (type === 'staff') {
      const data = formDataObject(form);
      if (!form.dataset.id && data.password !== data.confirmPassword) throw new Error('The passwords do not match.');
      if (form.dataset.id) { if (!data.password) delete data.password; delete data.confirmPassword; delete data.username; await API(`/api/staff/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) }); }
      else await API('/api/staff', { method: 'POST', body: JSON.stringify({ username: data.username, displayName: data.displayName, role: data.role, password: data.password }) });
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
    const result = await API('/api/candidates/import', { method: 'POST', body: JSON.stringify({ candidates: selected.map(row => row.candidate) }) });
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
    root.innerHTML = `<main class="booking-screen"><div class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${svgIcon('target')}</span>Chelo</div><div class="eyebrow">Partnership briefing</div><h1>Choose a preferred time</h1><p>Loading your invitation…</p></div><div class="loading-line"><span></span></div></div></main>`;
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
  root.innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${svgIcon('target')}</span>Chelo</div><div class="eyebrow">A conversation about impact</div><h1>A ${meetingDuration}-minute introduction to Chelo.</h1><p>Choose a preferred time for a brief, no-commitment conversation.</p></div>${bookingBody}<div class="booking-foot">Chelo · Security. Transparency. Accountability. · South Africa<br>Your selected slot is a preference; the team will confirm it personally.</div></article></main>`;
}
async function initPublicBooking() {
  state.bookingLoading = true; renderPublicBooking();
  const token = location.pathname.split('/').filter(Boolean).pop();
  try { state.bookingInfo = await API(`/api/public/booking/${encodeURIComponent(token)}`); }
  catch (err) { state.bookingInfo = { error: err.message }; }
  state.bookingLoading = false;
  if (state.bookingInfo?.error) {
    $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${svgIcon('target')}</span>Chelo</div><div class="eyebrow">Partnership briefing</div><h1>Invitation unavailable</h1><p>This link may have expired or the contact has been suppressed.</p></div><div class="booking-card-body"><p class="page-subtitle">Please reply to your Chelo contact for assistance.</p></div></article></main>`;
  } else renderPublicBooking();
}
function renderPublicOptOut() {
  const info = state.optOutInfo;
  if (!info) {
    $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${svgIcon('target')}</span>Chelo</div><div class="eyebrow">Email preferences</div><h1>Loading your request…</h1><p>One moment.</p></div></article></main>`;
    return;
  }
  const unavailable = Boolean(info.error);
  const completed = state.optOutDone || info.optedOut;
  const content = unavailable
    ? `<div class="booking-card-body"><h2 style="font-size:14px;color:#2a2560">This link is unavailable</h2><p class="page-subtitle">Please contact the Chelo team if you need help with your email preferences.</p></div>`
    : completed
      ? `<div class="booking-success"><div class="success-check">${svgIcon('check')}</div><h2>Preference saved</h2><p>Chelo will not send further outreach or follow-up emails to this contact. You may close this page.</p></div>`
      : `<div class="booking-card-body"><div class="booking-project"><small>Organisation</small><strong>${esc(info.company)}</strong></div><p class="page-subtitle" style="margin:0 0 16px">If you no longer wish to receive Chelo outreach about this partnership, confirm below. This will stop future follow-ups for this contact.</p><button type="button" class="button button-primary" data-action="public-opt-out">${svgIcon('ban')}Stop further outreach</button></div>`;
  $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${svgIcon('target')}</span>Chelo</div><div class="eyebrow">Email preferences</div><h1>${completed ? 'You’re opted out.' : 'Manage your email preferences.'}</h1><p>We respect your choice.</p></div>${content}<div class="booking-foot">Chelo · Security. Transparency. Accountability. · South Africa</div></article></main>`;
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
  if (settingsTab) { event.preventDefault(); state.settingsSection = settingsTab.dataset.settingsTab; renderApp(); if (state.settingsSection === 'audit') loadAudit(); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { event.preventDefault(); setView(viewButton.dataset.view); return; }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) { event.preventDefault(); await dispatchAction(actionButton); return; }
  const leadRow = event.target.closest('[data-open-lead]');
  if (leadRow) { openModal('lead-detail', leadRow.dataset.openLead); return; }
  if (event.target.id === 'modal-backdrop') closeModal();
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
  if (location.pathname.startsWith('/opt-out/')) return initPublicOptOut();
  try {
    state.auth = await API('/api/auth/status');
    if (!state.auth.authenticated) { renderAuthGate(); return; }
    state.data = await API('/api/init'); renderApp(); loadRadar(); if (state.view === 'workbench') wbRunPending();
  } catch (err) { $('#app').innerHTML = `<main class="booking-screen"><article class="booking-card"><div class="booking-card-header"><div class="booking-brand"><span class="booking-brand-icon">${svgIcon('target')}</span>Chelo</div><div class="eyebrow">Workspace unavailable</div><h1>Could not load the partnerships workspace.</h1><p>${esc(err.message)}</p></div><div class="booking-card-body">Refresh the page in a moment. Check that the local app server is running.</div></article></main>`; }
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
  return `${pageHead('Verified impact catalog', 'Verified Projects', 'School, NGO and community projects verified by Chelo, with live funding gaps fed by the pipeline.', canEdit ? `<input type="file" id="project-csv-input" accept=".csv,text/csv" hidden /><a class="button button-ghost" href="/sample-projects.csv" download>${svgIcon('download')}CSV template</a><button class="button button-secondary" data-action="import-projects">${svgIcon('upload')} Import CSV</button><button class="button button-primary" data-action="new-project">${svgIcon('plus')} Add project</button>` : '')}
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
    <div class="form-group full"><label for="p-metrics">Verified metrics (max 3, one per line)</label><textarea class="form-control" id="p-metrics" name="verifiedMetrics" placeholder="Metric | baseline | latest | unit | period | verified source">${esc(verifiedMetricsText(project?.verifiedMetrics || []))}</textarea><span class="form-hint">Format: Metric | baseline value | latest value | unit | period | verified source.</span></div>
  </div></form>`;
  const footer = `<div class="modal-footer-left">${edit ? `<button type="button" class="button button-ghost button-small" data-action="delete-project" data-id="${esc(project.id)}">${svgIcon('trash')}Remove</button>` : '<span class="subtle">Adds a verified project to the catalog</span>'}</div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Cancel</button><button type="submit" form="project-form" class="button button-primary">${svgIcon('save')}${edit ? 'Save project' : 'Add project'}</button></div>`;
  return modalFrame(edit ? 'Edit verified project' : 'Add verified project', 'Catalog entries must name a verified recipient and a cited source.', body, footer);
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
  const tab = state.copilotTab || 'web';
  const tabs = `<div class="copilot-tabs" role="tablist"><button type="button" class="copilot-tab ${tab === 'web' ? 'is-active' : ''}" data-action="copilot-tab" data-tab="web" role="tab">${svgIcon('globe')} Web research</button><button type="button" class="copilot-tab ${tab === 'paste' ? 'is-active' : ''}" data-action="copilot-tab" data-tab="paste" role="tab">${svgIcon('edit')} Paste-to-Extract</button></div>`;
  if (tab === 'web') {
    const lead = state.modal?.returnTo?.id ? getLead(state.modal.returnTo.id) : null;
    const webBody = `${tabs}<div class="note-callout"><span class="note-callout-icon">${svgIcon('info')}</span><span><strong>How web research works.</strong> Staff start a lookup for one organisation. Chelo queries the configured search provider${state.data.settings?.searchConfigured ? ` (${esc(state.data.settings.searchProvider)})` : ' (not configured — official website only)'} and the funder's official site for public CSI, foundation and annual-report pages, scrubs emails, phone numbers and ID numbers before any AI step, and returns a cited Funder Brief. You tick what may be used; only approved findings reach the email and proposal PDF.</span></div>
      ${lead ? researchBriefCard(lead, 'copilot') : `<div class="empty-state" style="margin-top:14px"><strong>Save the prospect first.</strong><p>Web research attaches a brief to a saved prospect so it can be reviewed, audited and reused for 30 days. Add the organisation, then open the copilot from the prospect's details, Prepare outreach or Proposal screens.</p></div>`}`;
    const webFooter = `<div class="modal-footer-left"><span class="subtle">POPIA: organisation-level public facts only · no contact details are collected</span></div><div class="modal-footer-right"><button type="button" class="button button-secondary" data-action="close-modal">${svgIcon('close')}Close</button></div>`;
    return modalFrame('Research copilot', 'Gather cited public context and align the ask with the funder’s mission.', webBody, webFooter, true);
  }
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
function governanceView(isAdmin) {
  const policy = state.auth.approvalPolicy || state.data.settings?.approvalPolicy || 'single';
  const staff = state.data.staff || [];
  const rows = staff.map(u => `<tr><td><strong>${esc(u.displayName)}</strong><span class="company-secondary">${esc(u.username)}</span></td><td>${esc(roleLabel(u.role))}</td><td>${u.active ? '<span class="status-pill status-confirmed">Active</span>' : '<span class="status-pill status-declined">Deactivated</span>'}</td><td>${isoDate(u.createdAt)}</td><td><button class="table-action" data-action="edit-staff" data-id="${esc(u.id)}">${svgIcon('edit')}Edit</button><button class="table-action" data-action="toggle-staff" data-id="${esc(u.id)}">${svgIcon('users')}${u.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('');
  return `<div class="settings-status-grid"><div class="settings-status-card"><span class="metric-icon">${svgIcon('shield')}</span><div><strong>Approval policy</strong><small>${policy === 'four-eyes' ? 'Strict 4-eyes · two different staff must approve every outbound email' : 'Single approver · one staff approval releases email'}</small></div><span class="status-dot ${policy === 'four-eyes' ? 'is-on' : ''}"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('partners')}</span><div><strong>Staff accounts</strong><small>${staff.filter(u => u.active).length} active · ${staff.filter(u => u.role === 'admin' && u.active).length} admin</small></div><span class="status-dot is-on"></span></div><div class="settings-status-card"><span class="metric-icon">${svgIcon('activity')}</span><div><strong>Audit ledger</strong><small>HMAC hash-chained · 365-day retention</small></div><button class="table-action" data-action="verify-audit">${svgIcon('shield')}Verify chain</button></div></div>
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('shield')}</span><div><h2>Outbound email approval</h2><p>Approvals are stamped with an HMAC digest of recipient, subject, body and attachment. Any edit voids the approval. In 4-eyes mode the second signature must come from a different Admin or Reviewer.</p></div></div><div class="policy-toggle"><button type="button" class="policy-option ${policy === 'single' ? 'active' : ''}" data-action="set-approval-policy" data-policy="single" ${isAdmin ? '' : 'disabled'}>${svgIcon('prospects')}<strong>1-person approval</strong><span>Small team · fast handoff</span></button><button type="button" class="policy-option ${policy === 'four-eyes' ? 'active' : ''}" data-action="set-approval-policy" data-policy="four-eyes" ${isAdmin ? '' : 'disabled'}>${svgIcon('shield')}<strong>Strict 4-eyes</strong><span>Drafter + independent countersignature</span></button></div>${isAdmin ? '' : '<span class="form-hint">Only administrators can change the policy.</span>'}</section>
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('partners')}</span><div><h2>Staff accounts & roles</h2><p>Admin: full control. Reviewer: read everything, approve/countersign/return drafts, no record edits. Relationship Owner: manage prospects, projects and briefings; first approvals only.</p></div></div>${isAdmin ? `<div class="lead-table-wrap"><table class="table"><thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5"><div class="panel-empty">No staff accounts yet.</div></td></tr>'}</tbody></table></div><div class="settings-card-actions"><button class="button button-primary" type="button" data-action="new-staff">${svgIcon('plus')} Add staff account</button></div>` : '<span class="form-hint">Staff management is restricted to administrators.</span>'}</section>
    ${isAdmin ? `<section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon gold">${svgIcon('info')}</span><div><h2>Demo data</h2><p>Remove the fictional demo prospects, candidates, partners and briefings in one step. The verified Chelo project catalog is retained.</p></div></div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-action="clear-demo">${svgIcon('trash')}Clear demo records</button></div></section>` : ''}`;
}
function staffFormModal(user) {
  const edit = Boolean(user);
  const body = `<form id="staff-form" data-form="staff" data-id="${edit ? esc(user.id) : ''}"><div class="form-grid">
    <div class="form-group"><label for="s-name">Display name *</label><input class="form-control" id="s-name" name="displayName" required value="${esc(user?.displayName || '')}" /></div>
    <div class="form-group"><label for="s-email">Work email *</label><input class="form-control" id="s-email" name="username" type="email" required value="${esc(user?.username || '')}" ${edit ? 'readonly' : ''} /></div>
    <div class="form-group full"><label for="s-role">Role</label><select class="form-control" id="s-role" name="role">${['admin', 'reviewer', 'owner'].map(r => `<option value="${r}" ${(user?.role || 'owner') === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}</select></div>
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
    <section class="panel settings-card"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>Inbound replies & bounces</h2><p>Hard bounces mark the contact invalid and stop follow-ups; replies move the prospect to Interested and cancel the 5/10-business-day sequence. Use a provider webhook (HMAC-SHA256 signed) and/or optional IMAP polling of the sending mailbox.</p></div></div><div class="settings-fields">
      <div class="form-group full"><label>Webhook endpoint</label><input class="form-control" readonly value="${esc(location.origin)}/api/inbound/webhook" /><span class="form-hint">Header <code>X-Chelo-Signature</code> = hex HMAC-SHA256 of the raw JSON body. Accepts generic, Postmark, Resend and SendGrid shapes.</span></div>
      <div class="form-group full"><label>Webhook secret</label><input class="form-control" readonly value="${settings.inboundWebhookReady ? '•••••••• (stored encrypted)' : 'Not set'}" /><span class="form-hint">Fetch via <code>GET /api/inbound/webhook-info</code> as Admin, or rotate below.</span></div>
      <div class="form-group"><label for="set-imap-host">IMAP host</label><input class="form-control" id="set-imap-host" name="imapHost" value="${esc(settings.imapHost || '')}" placeholder="imap.example.com" /></div>
      <div class="form-group"><label for="set-imap-port">IMAP port (TLS)</label><input class="form-control" id="set-imap-port" name="imapPort" type="number" min="1" max="65535" value="${Number(settings.imapPort || 993)}" /></div>
      <div class="form-group"><label for="set-imap-user">IMAP username</label><input class="form-control" id="set-imap-user" name="imapUsername" autocomplete="username" value="${esc(settings.imapUsername || '')}" /></div>
      <div class="form-group"><label for="set-imap-pass">IMAP password <span class="optional">(leave blank to keep)</span></label><input class="form-control" id="set-imap-pass" name="imapPassword" type="password" autocomplete="new-password" placeholder="${settings.imapConfigured ? 'Stored; hidden' : 'App password'}" /></div>
      <label class="check-row"><input type="checkbox" name="clearImapPassword" /> Remove saved IMAP password</label>
    </div><div class="settings-card-actions"><button class="button button-secondary" type="button" data-action="rotate-webhook-secret">${svgIcon('key')}Rotate webhook secret</button><button class="button button-secondary" type="button" data-action="imap-sync" ${settings.imapConfigured ? '' : 'disabled'}>${svgIcon('activity')} Check inbox now</button><button class="button button-primary" type="submit">${svgIcon('check')} Save settings</button></div></section></form>`;
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
  const kindLabel = { mission: 'Mission', programme: 'Programme', public_figure: 'Public figure', grant_window: 'Grant window' };
  const body = `<div id="research-review">
    <div class="note-callout"><span class="note-callout-icon">${svgIcon('shield')}</span><span><strong>${brief.mode === 'openai' ? 'AI-synthesised from public pages' : 'Local extraction from public pages'} via ${esc(brief.provider)}.</strong> Gathered ${isoDate(brief.generatedAt)}${brief.requestedBy ? ` by ${esc(brief.requestedBy)}` : ''}; valid for 30 days. Scrubbed before processing: ${brief.redactions.emails} email(s), ${brief.redactions.phones} phone(s), ${brief.redactions.saIds} ID number(s). Tick only facts you have checked against the source — approved items inform the email and the PDF’s “Alignment with your mission” section.</span></div>
    ${brief.warnings?.length ? `<div class="note-callout warn"><span class="note-callout-icon">${svgIcon('info')}</span><span>${brief.warnings.map(esc).join(' ')}</span></div>` : ''}
    <div class="form-group" style="margin-top:12px"><label for="research-mission">Mission summary <span class="optional">(editable; printed in the PDF when approved)</span></label><textarea class="form-control" id="research-mission" maxlength="240" rows="2">${esc(brief.missionSummary || '')}</textarea>${brief.focusAreas?.length ? `<div class="chip-row">${brief.focusAreas.map(f => `<span class="stage-pill pill-researched">${esc(f)}</span>`).join('')}</div>` : ''}</div>
    <div class="research-group"><h4>Alignment with Chelo <span class="subtle">(${brief.alignmentPoints.length})</span></h4>${brief.alignmentPoints.length ? brief.alignmentPoints.map(a => `<label class="research-item"><input type="checkbox" name="alignment" value="${esc(a.id)}" ${checked(brief.approvedAlignmentIds, a.id)} /><span><strong>${esc(a.text)}</strong>${a.evidence ? `<em>Evidence: ${esc(a.evidence)}</em>` : ''}<small>${src(a.sourceUrl, a.sourceTitle)}</small></span></label>`).join('') : '<p class="subtle">No alignment points could be grounded in the sources.</p>'}</div>
    <div class="research-group"><h4>Cited findings <span class="subtle">(${brief.findings.length})</span></h4>${brief.findings.length ? brief.findings.map(f => `<label class="research-item"><input type="checkbox" name="finding" value="${esc(f.id)}" ${checked(brief.approvedFindingIds, f.id)} /><span><strong>${esc(f.text)}</strong><small><span class="research-kind">${esc(kindLabel[f.kind] || f.kind)}</span> ${conf(f.confidence)} ${src(f.sourceUrl, f.sourceTitle)}</small></span></label>`).join('') : '<p class="subtle">No findings. Try adding the official website or use Paste-to-Extract on a PDF report.</p>'}</div>
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
const WB_FILTERS = [['all', 'All'], ['replied', 'Replied · triage'], ['running', 'Working'], ['needs-review', 'Needs review'], ['ready', 'Ready to send'], ['approved', 'Approved'], ['queued', 'Queued'], ['sequence', 'In sequence'], ['sent', 'Sent'], ['blocked', 'Needs input'], ['dead', 'Dead emails']];
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
const WB_STATUS_META = { replied: ['Replied — triage', 'pill-interested'], sequence: ['Sequence running', 'pill-researched'], queued: ['Queued to send', 'pill-researched'], new: ['Not started', 'pill-new'], running: ['Working…', 'pill-pending'], 'needs-review': ['Review research', 'pill-interested'], ready: ['Ready to send', 'pill-researched'], approved: ['Approved', 'pill-won'], sent: ['Sent', 'pill-won'], blocked: ['Needs input', 'pill-pending'], dead: ['Dead email', 'pill-not-proceeding'], error: ['Error', 'pill-not-proceeding'] };
function wbPill(status) { const [label, cls] = WB_STATUS_META[status] || [status, 'pill-new']; return `<span class="stage-pill ${cls}">${esc(label)}</span>`; }
function wbSelected() { return getLead(state.wb.selectedId) || null; }

function workbenchView() {
  const leads = state.data.leads.filter(l => !l.isDemo || state.auth.demoAccess || true);
  const counts = leads.reduce((acc, l) => { const s = wbStatusOf(l); acc[s] = (acc[s] || 0) + 1; acc.all += 1; return acc; }, { all: 0 });
  const q = state.query.trim().toLowerCase();
  const visible = leads.filter(l => (state.wb.filter === 'all' ? wbStatusOf(l) !== 'dead' : wbStatusOf(l) === state.wb.filter) && (!q || `${l.company} ${l.contactName} ${l.email} ${l.project || ''}`.toLowerCase().includes(q)));
  if (state.wb.sort === 'fit') visible.sort((a, b) => (b.fit?.score || 0) - (a.fit?.score || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  if (!state.wb.selectedId && visible.length) state.wb.selectedId = visible[0].id;
  const selected = wbSelected();
  return `${pageHead('Outreach workbench', 'From lead to sent email in one place', 'Add or discover organisations, let Chelo verify the mailbox, research their CSI focus and draft the email — you review the findings, approve and send.', `<button type="button" class="button button-secondary" data-view="discover">${svgIcon('upload')}Import CSV</button><button type="button" class="button button-primary" data-action="wb-focus-add">${svgIcon('plus')}Add lead</button>`)}
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
function wbIntakeBar() {
  const d = state.wb.discovery;
  return `<section class="panel wb-intake">
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
      <label class="wb-discover-input">${svgIcon('globe')}<input id="wb-discover-q" class="form-control" placeholder="Discover on the web — e.g. “JSE mining companies with education CSI”" value="${esc(d.query)}" /></label>
      <button type="button" class="button button-secondary" data-action="wb-discover" ${d.busy ? 'disabled' : ''}>${svgIcon('search')}${d.busy ? 'Searching…' : 'Discover'}</button>
    </div>
    ${d.error ? `<p class="form-error">${esc(d.error)}</p>` : ''}
    ${d.results.length ? `<div class="wb-discover-results">${d.results.map(o => `<article class="wb-org ${o.alreadyTracked ? 'is-tracked' : ''}"><div class="wb-org-copy"><strong>${esc(o.name)}</strong><a class="source-link" href="${esc(o.website)}" target="_blank" rel="noopener noreferrer">${svgIcon('external')}${esc(o.domain)}</a><p>${esc(o.summary || 'No public summary captured.')}</p></div><button type="button" class="button button-small ${o.alreadyTracked ? 'button-ghost' : 'button-secondary'}" data-action="wb-discover-add" data-domain="${esc(o.domain)}" ${o.alreadyTracked ? 'disabled' : ''}>${svgIcon(o.alreadyTracked ? 'check' : 'plus')}${o.alreadyTracked ? 'Tracked' : 'Add'}</button></article>`).join('')}<p class="subtle">Organisation facts only — emails and phone numbers are never scraped (POPIA). Add the public contact yourself in the lead's details.</p></div>` : ''}
  </section>`;
}
function wbRow(l, active) {
  const s = wbStatusOf(l);
  return `<button type="button" class="wb-row ${active ? 'is-active' : ''} wb-row-${s}" data-action="wb-select" data-id="${esc(l.id)}">
    <span class="wb-row-avatar">${initials(l.company)}</span>
    <span class="wb-row-copy"><strong>${esc(l.company)}</strong><small>${esc(l.contactName || 'No contact yet')}${l.project ? ` · ${esc(l.project)}` : ''}</small></span>
    <span class="wb-row-status">${fitPill(l.fit)}${wbPill(s)}${s === 'running' ? '<span class="wb-spinner" aria-hidden="true"></span>' : ''}</span>
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
function wbStepper(lead) {
  const s = wbStatusOf(lead);
  const busy = state.wb.busy[lead.id];
  const verify = wbStepState(lead, 'verify'); const researchStep = wbStepState(lead, 'research'); const match = wbStepState(lead, 'match'); const draft = wbStepState(lead, 'draft');
  const brief = lead.research;
  const mailbox = lead.mailboxCheck;
  const projects = state.data.projects || [];
  const emailStatus = lead.emailStatus || 'None';
  const openStep = s === 'replied' ? 'track' : s === 'needs-review' ? 'research' : s === 'ready' ? 'review' : s === 'approved' ? 'review' : s === 'sequence' || s === 'queued' ? 'review' : s === 'sent' ? 'track' : s === 'blocked' || s === 'dead' ? 'verify' : match?.status === 'needs-choice' ? 'match' : 'verify';
  const header = `<div class="wb-detail-head">
    <div><div class="eyebrow"><span class="eyebrow-dot"></span>${esc(lead.stage || 'New')}</div><h2>${esc(lead.company)}</h2><p class="subtle">${esc(lead.contactName || 'No contact')}${lead.title ? ` · ${esc(lead.title)}` : ''}${lead.email ? ` · ${esc(lead.email)}` : ' · no email yet'}</p></div>
    <div class="wb-detail-actions">${wbPill(s)}<button type="button" class="button button-ghost button-small" data-action="edit-lead" data-id="${esc(lead.id)}">${svgIcon('edit')}Edit details</button><button type="button" class="button button-secondary button-small" data-action="wb-run" data-id="${esc(lead.id)}" ${busy || s === 'running' ? 'disabled' : ''}>${svgIcon('refresh')}${busy || s === 'running' ? 'Working…' : 'Re-run flow'}</button></div>
  </div>`;
  // 1 · Verify
  const verifyBody = `<div class="wb-kv"><span>Syntax & domain</span><strong>${esc(lead.contactCheck?.emailStatus || 'not checked')}</strong></div>
    <div class="wb-kv"><span>Mailbox probe</span><strong>${esc(mailbox?.status || 'not probed')}</strong></div>
    <p class="subtle">${esc(mailbox?.reason || verify?.detail || 'The flow checks syntax, MX records and performs an SMTP handshake (no email is sent). Dead mailboxes never reach the pipeline.')}</p>
    ${(lead.contactCheck?.issues || []).length ? `<p class="form-error">Missing: ${esc(lead.contactCheck.issues.join(', '))}</p>` : ''}
    ${wbQualityRow(lead)}
    <div class="wb-step-actions"><button type="button" class="button button-secondary button-small" data-action="wb-verify" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('checkCircle')}Re-check mailbox</button><button type="button" class="button button-ghost button-small" data-action="wb-waterfall" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('users')}${lead.contactLeads ? 'Re-run contact waterfall' : 'Find public contacts'}</button>${s === 'dead' ? `<button type="button" class="button button-danger button-small" data-action="wb-delete" data-id="${esc(lead.id)}">${svgIcon('trash')}Remove dead lead</button>` : ''}</div>
    ${wbWaterfallPanel(lead)}`;
  // 2 · Research (inline review — same contract as the research modal so the existing approve action works)
  const researchBody = brief ? `<div id="research-review" class="wb-research">
      <p class="wb-mission"><strong>Mission:</strong> ${esc(brief.missionSummary || '—')}</p>
      ${brief.focusAreas?.length ? `<div class="chip-row">${brief.focusAreas.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
      <div class="wb-research-group"><h4>${svgIcon('info')}Findings · tick what is accurate</h4>${brief.findings.length ? brief.findings.map(f => `<label class="check-row"><input type="checkbox" name="finding" value="${esc(f.id)}" ${brief.status === 'approved' ? (brief.approvedFindingIds || []).includes(f.id) ? 'checked' : '' : 'checked'} /> <span>${esc(f.text)} <small class="subtle">[${esc(f.ref || f.sourceIds?.[0] || 'S')}]</small></span></label>`).join('') : '<p class="subtle">No cited findings were found. Add the website in Edit details and re-run.</p>'}</div>
      <div class="wb-research-group"><h4>${svgIcon('target')}Alignment with Chelo (education focus)</h4>${brief.alignmentPoints.map(a => `<label class="check-row"><input type="checkbox" name="alignment" value="${esc(a.id)}" ${brief.status === 'approved' ? (brief.approvedAlignmentIds || []).includes(a.id) ? 'checked' : '' : 'checked'} /> <span>${esc(a.text)}</span></label>`).join('') || '<p class="subtle">No alignment points yet.</p>'}</div>
      ${brief.contacts?.length ? `<div class="wb-research-group"><h4>${svgIcon('users')}Public CSI leads (names & titles only)</h4>${brief.contacts.map(c => `<label class="check-row"><input type="checkbox" name="contact" value="${esc(c.id)}" ${(brief.approvedContactIds || []).includes(c.id) ? 'checked' : ''} /> <span>${esc(c.name)} — ${esc(c.title || '')}</span></label>`).join('')}</div>` : ''}
      <details class="wb-sources"><summary>${brief.sources.length} source(s) · ${esc(brief.provider || 'local')} · ${esc(brief.mode || '')}</summary>${brief.sources.map(src => `<a class="source-link" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${svgIcon('external')}${esc(src.title || src.url)}</a>`).join('')}</details>
      <input type="hidden" id="research-mission" value="${esc(brief.missionSummary || '')}" /><input type="hidden" id="research-notes" value="" />
      <div class="wb-step-actions">
        ${brief.status === 'approved' ? `<span class="stage-pill pill-won">${svgIcon('check')}Approved ${isoDate(brief.reviewedAt)}</span>` : ''}
        <button type="button" class="button button-primary button-small" data-action="research-approve" data-id="${esc(lead.id)}">${svgIcon('checkCircle')}${brief.status === 'approved' ? 'Update approval' : 'Approve & draft email'}</button>
        <button type="button" class="button button-ghost button-small" data-action="research-reject" data-id="${esc(lead.id)}">${svgIcon('xCircle')}Reject brief</button>
        <button type="button" class="button button-ghost button-small" data-action="wb-run" data-force="true" data-id="${esc(lead.id)}">${svgIcon('refresh')}Research again</button>
      </div>
    </div>` : `<p class="subtle">${esc(researchStep?.detail || 'Research runs automatically once the mailbox passes verification.')}</p>`;
  // 3 · Match
  const matchBody = `<label class="form-group"><span>Chelo project this funder should hear about</span>
      <select class="form-control" data-wb-project="${esc(lead.id)}"><option value="">— choose a verified project —</option>${projects.map(p => `<option value="${esc(p.id)}" ${lead.projectId === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.sector || '')} · ${esc(p.province || '')}${brief?.suggestedProjectId === p.id ? ' (suggested from research)' : ''}</option>`).join('')}</select></label>
    <p class="subtle">${esc(match?.detail || 'Pick the project whose outcomes match their CSI focus; the email and PDF will anchor on it.')}</p>
    ${wbFitPanel(lead)}`;
  // 4 · Draft
  const d = lead.emailDraft;
  const draftBody = d ? `<label class="form-group"><span>Subject</span><input id="email-subject" class="form-control" value="${esc(d.subject || '')}" ${emailStatus === 'Sent' ? 'readonly' : ''} /></label>
      <label class="form-group"><span>Email</span><textarea id="email-body" class="form-control wb-email-body" rows="12" ${emailStatus === 'Sent' ? 'readonly' : ''}>${esc(d.body || '')}</textarea></label>
      <p class="subtle">${esc(draft?.detail || '')} ${d.generationMode ? `· ${esc(d.generationMode)}` : ''}${draft?.usedApprovedResearch ? ' · uses approved research' : ' · generic until research is approved'}</p>
      <div class="wb-step-actions">
        <button type="button" class="button button-secondary button-small" data-action="email-save-draft" data-id="${esc(lead.id)}" ${emailStatus === 'Sent' ? 'disabled' : ''}>${svgIcon('save')}Save edits</button>
        <button type="button" class="button button-ghost button-small" data-action="wb-redraft" data-id="${esc(lead.id)}" ${busy || emailStatus === 'Sent' ? 'disabled' : ''}>${svgIcon('wand')}Regenerate draft</button>
        <button type="button" class="button button-ghost button-small" data-action="proposal-draft" data-id="${esc(lead.id)}">${svgIcon('proposals')}Proposal PDF</button>
      </div>` : `<p class="subtle">${esc(draft?.detail || 'The draft is generated automatically once the mailbox is verified and a project is chosen.')}</p>`;
  // 5 · Review & approve the sequence (single-send kept as a fallback)
  const approvalPending = emailStatus === 'Pending second approval';
  const singleSendBody = d ? `<div class="wb-preview"><div class="wb-preview-head"><span>To</span><strong>${esc(lead.contactName || '')} &lt;${esc(lead.email || '')}&gt;</strong></div><div class="wb-preview-head"><span>Subject</span><strong>${esc(d.subject || '')}</strong></div><pre class="wb-preview-body">${esc(d.body || '')}</pre></div>
      <div class="wb-step-actions">
        ${emailStatus === 'Draft' || emailStatus === 'None' ? `<button type="button" class="button button-primary button-small" data-action="email-approve" data-id="${esc(lead.id)}">${svgIcon('checkCircle')}Approve</button>` : ''}
        ${approvalPending ? `<button type="button" class="button button-primary button-small" data-action="email-countersign" data-id="${esc(lead.id)}">${svgIcon('shield')}Countersign (4-eyes)</button>` : ''}
        ${emailStatus === 'Approved' ? `<button type="button" class="button button-primary button-small" data-action="send-smtp" data-id="${esc(lead.id)}">${svgIcon('send')}Queue & send</button><button type="button" class="button button-secondary button-small" data-action="email-open" data-id="${esc(lead.id)}">${svgIcon('mail')}Open in email client</button><button type="button" class="button button-ghost button-small" data-action="mark-sent" data-id="${esc(lead.id)}">${svgIcon('check')}Mark as sent</button>` : ''}
        ${['Approved', 'Pending second approval'].includes(emailStatus) ? `<button type="button" class="button button-ghost button-small" data-action="email-return" data-id="${esc(lead.id)}">${svgIcon('back')}Return to draft</button>` : ''}
        ${emailStatus === 'Sent' ? `<span class="stage-pill pill-won">${svgIcon('check')}Sent ${isoDate(lead.sentAt || lead.updatedAt)}</span>` : ''}
        ${emailStatus === 'Queued' ? `<span class="stage-pill pill-researched"><span class="wb-spinner"></span>Queued — sends in the next free slot</span><button type="button" class="button button-ghost button-small" data-action="dlv-cancel-job" data-id="${esc(lead.sendJobId || '')}" data-return-view="workbench">${svgIcon('xCircle')}Cancel send</button>` : ''}
        ${String(emailStatus).startsWith('Failed') ? `<span class="stage-pill pill-not-proceeding">${svgIcon('xCircle')}${esc(emailStatus)}</span><button type="button" class="button button-ghost button-small" data-action="email-return" data-id="${esc(lead.id)}">${svgIcon('back')}Return to draft</button>` : ''}
      </div>` : '<p class="subtle">Nothing to review yet.</p>';
  const reviewBody = d ? `${wbSequencePanel(lead)}<details class="wb-legacy"><summary>Send a single email instead (no follow-ups)</summary>${singleSendBody}</details>` : '<p class="subtle">Nothing to review yet.</p>';
  // 6 · Track
  const events = (lead.emailEvents || []).slice(-6).reverse();
  const booking = (state.data.bookings || []).find(b => b.leadId === lead.id);
  const trackBody = `${wbTriageCard(lead)}<div class="wb-track-grid">
      <div class="wb-kv"><span>Status</span><strong>${esc(emailStatus)}</strong></div>
      <div class="wb-kv"><span>Opens</span><strong>${lead.openCount || (lead.emailEvents || []).filter(e => e.type === 'open').length || 0}</strong></div>
      <div class="wb-kv"><span>Reply</span><strong>${lead.repliedAt ? isoDate(lead.repliedAt) : '—'}</strong></div>
      <div class="wb-kv"><span>Briefing</span><strong>${booking ? esc(booking.status) : '—'}</strong></div>
    </div>
    ${events.length ? `<ul class="wb-events">${events.map(e => `<li>${svgIcon(e.type === 'bounce' ? 'xCircle' : e.type === 'reply' ? 'reply' : e.type === 'open' ? 'eye' : 'activity')}<span>${esc(e.type)}</span><small>${isoDate(e.at)}</small></li>`).join('')}</ul>` : ''}
    <div class="wb-step-actions">
      ${emailStatus === 'Sent' && !(lead.sequence && lead.sequence.status === 'running') ? `<button type="button" class="button button-secondary button-small" data-action="follow-up" data-id="${esc(lead.id)}">${svgIcon('send')}Draft follow-up</button><button type="button" class="button button-ghost button-small" data-action="mark-replied" data-id="${esc(lead.id)}">${svgIcon('reply')}Mark replied</button>` : ''}
      ${lead.stage !== 'Won' ? `<button type="button" class="button button-ghost button-small" data-action="mark-won" data-id="${esc(lead.id)}">${svgIcon('trophy')}Mark won → Partners</button>` : `<span class="stage-pill pill-won">${svgIcon('trophy')}Partner</span>`}
      <button type="button" class="button button-ghost button-small" data-action="opt-out" data-id="${esc(lead.id)}">${svgIcon('ban')}Do not contact</button>
    </div>`;
  return `<div class="panel wb-stepper">${header}
    ${lead.flow?.error ? `<p class="form-error">${esc(lead.flow.error)}</p>` : ''}
    ${wbStep(1, 'Verify email', verify?.status, verify?.detail, verifyBody, { open: openStep === 'verify' })}
    ${wbStep(2, 'Research CSI focus', researchStep?.status, researchStep?.detail, researchBody, { open: openStep === 'research' })}
    ${wbStep(3, 'Match project · fit & timing', match?.status, lead.fit ? `Fit ${lead.fit.score} · ${lead.fit.window?.label || 'FYE unknown'}` : match?.detail, matchBody, { open: openStep === 'match' })}
    ${wbStep(4, 'Draft email', draft?.status, draft?.detail, draftBody, { open: openStep === 'draft' })}
    ${wbStep(5, 'Review & approve sequence', wbSequenceStepStatus(lead, emailStatus), wbSequenceStepDetail(lead, emailStatus), reviewBody, { open: openStep === 'review' })}
    ${wbStep(6, 'Track, triage & relationship', lead.triage && !lead.triage.handled ? 'review' : emailStatus === 'Sent' ? 'sent' : null, lead.triage && !lead.triage.handled ? `Reply: ${wbTriageLabel(lead.triage.category)}` : lead.stage === 'Won' ? 'Partner' : '', trackBody, { open: openStep === 'track' })}
  </div>`;
}

const SEQ_STEP_META = { planned: ['Planned', 'pill-new'], queued: ['Queued', 'pill-researched'], sent: ['Sent', 'pill-won'], skipped: ['Skipped', 'pill-new'], cancelled: ['Cancelled', 'pill-not-proceeding'], failed: ['Failed', 'pill-not-proceeding'] };
const SEQ_STATUS_META = { draft: ['Draft plan', 'pill-new'], 'pending-approval': ['Awaiting countersign', 'pill-pending'], approved: ['Approved', 'pill-won'], running: ['Running', 'pill-researched'], stopped: ['Stopped', 'pill-not-proceeding'], completed: ['Completed', 'pill-won'] };
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
  const seq = lead.sequence; const busy = state.wb.busy[lead.id];
  const policy = (state.data.settings?.approvalPolicy || state.data.sendPolicy?.approvalPolicy || '');
  if (!seq || seq.status === 'stopped' && !state.wb.showStoppedSeq?.[lead.id] && false) return '';
  if (!seq) {
    return `<div class="wb-seq-intro"><div><h4>${svgIcon('send')}Approve the whole plan once</h4><p class="subtle">First touch plus three short in-thread follow-ups over about two weeks (Tue–Thu, SA business hours). Steps send themselves from the approved mailbox; any human reply stops the plan immediately and opens a triage card.</p></div>
      <button type="button" class="button button-primary button-small" data-action="seq-build" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('wand')}Build sequence plan</button></div>`;
  }
  const editable = ['draft'].includes(seq.status);
  const [statusLabel, statusCls] = SEQ_STATUS_META[seq.status] || [seq.status, 'pill-new'];
  const steps = seq.steps.map(st => {
    const [label, cls] = SEQ_STEP_META[st.status] || [st.status, 'pill-new'];
    const when = st.sentAt ? `Sent ${wbWhen(st.sentAt)}` : st.scheduledFor ? `Due ${wbWhen(st.scheduledFor)}` : st.n === 1 ? 'Sends in the next free slot after approval' : `+${st.offsetDays} business day${st.offsetDays === 1 ? '' : 's'} after step ${st.n - 1}`;
    const off = ['skipped', 'cancelled'].includes(st.status);
    return `<li class="seq-step ${off ? 'is-off' : ''} seq-step-${esc(st.status)}" data-step="${st.n}">
      <div class="seq-step-rail"><span class="seq-step-dot">${st.status === 'sent' ? svgIcon('check') : st.status === 'failed' || st.status === 'cancelled' ? svgIcon('xCircle') : st.n}</span></div>
      <div class="seq-step-main">
        <div class="seq-step-head"><strong>${st.n === 1 ? 'First touch' : `Follow-up ${st.n - 1}`}</strong><span class="stage-pill ${cls}">${esc(label)}</span><small class="subtle">${esc(when)}</small>
          ${editable ? `<label class="seq-toggle"><input type="checkbox" data-seq-toggle="${st.n}" ${off ? '' : 'checked'} ${st.n === 1 ? 'disabled' : ''} /> include</label>${st.n > 1 ? `<label class="seq-offset">after <input type="number" min="1" max="30" value="${st.offsetDays}" data-seq-offset="${st.n}" /> business days</label>` : ''}` : ''}</div>
        ${editable && !off ? `<input class="form-control seq-subject" data-seq-subject="${st.n}" value="${esc(st.subject || '')}" ${st.n === 1 ? 'readonly title="Edit the first touch in step 4"' : ''} /><textarea class="form-control seq-body" rows="${st.n === 1 ? 4 : 5}" data-seq-body="${st.n}" ${st.n === 1 ? 'readonly' : ''}>${esc(st.body || '')}</textarea>` : `<details class="seq-preview"><summary>${esc(st.subject || '')}</summary><pre class="wb-preview-body">${esc(st.body || '')}</pre></details>`}
        ${st.error ? `<p class="form-error">${esc(st.error)}</p>` : ''}
      </div></li>`;
  }).join('');
  const approval = seq.approval || {};
  const actions = [];
  if (editable) actions.push(`<button type="button" class="button button-secondary button-small" data-action="seq-save" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('save')}Save plan edits</button>`, `<button type="button" class="button button-primary button-small" data-action="seq-approve" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('checkCircle')}Approve plan & start</button>`, `<button type="button" class="button button-ghost button-small" data-action="seq-build" data-force="true" data-id="${esc(lead.id)}">${svgIcon('refresh')}Rebuild from draft</button>`);
  if (seq.status === 'pending-approval') actions.push(`<span class="subtle">First approval by ${esc(approval.firstApprover || 'staff')} · a different reviewer must countersign</span>`, `<button type="button" class="button button-primary button-small" data-action="seq-countersign" data-id="${esc(lead.id)}" ${busy ? 'disabled' : ''}>${svgIcon('shield')}Countersign (4-eyes)</button>`);
  if (['running', 'approved', 'pending-approval'].includes(seq.status)) actions.push(`<button type="button" class="button button-danger button-small" data-action="seq-stop" data-id="${esc(lead.id)}">${svgIcon('xCircle')}Stop sequence</button>`);
  if (['stopped', 'completed'].includes(seq.status) && !lead.doNotContact && !(lead.triage && !lead.triage.handled)) actions.push(`<button type="button" class="button button-ghost button-small" data-action="seq-build" data-force="true" data-id="${esc(lead.id)}">${svgIcon('refresh')}Plan a new sequence</button>`);
  return `<div class="wb-seq">
    <div class="wb-seq-head"><div><h4>${svgIcon('send')}Follow-up sequence</h4><p class="subtle">${seq.steps.filter(s => !['skipped', 'cancelled'].includes(s.status)).length} steps · same thread (In-Reply-To) · stops on any human reply, bounce or opt-out${approval.approvedAt ? ` · approved ${isoDate(approval.approvedAt)} (${esc(approval.policy || 'single')})` : ''}</p></div><span class="stage-pill ${statusCls}">${esc(statusLabel)}</span></div>
    <ol class="seq-steps">${steps}</ol>
    <div class="wb-step-actions">${actions.join('')}</div>
  </div>`;
}
function wbTriageCard(lead) {
  const t = lead.triage; if (!t) return '';
  const [label, icon, action] = TRIAGE_META[t.category] || TRIAGE_META.unclassified;
  if (t.handled) return `<div class="wb-triage is-handled"><span class="stage-pill pill-won">${svgIcon('check')}Triaged: ${esc(wbTriageLabel(t.outcome?.category || t.category))}</span><small class="subtle">${esc(t.handledBy || '')} · ${isoDate(t.handledAt)}${t.outcome?.resumeOn ? ` · resurfaces ${esc(t.outcome.resumeOn)}` : ''}${t.outcome?.redirect?.name ? ` · redirect → ${esc(t.outcome.redirect.name)}` : ''}</small></div>`;
  const overdue = t.dueAt && Date.parse(t.dueAt) < Date.now();
  const redirect = t.hints?.redirect || {}; const resumeOn = t.hints?.resumeOn || '';
  const sla = t.dueAt ? `<span class="triage-sla ${overdue ? 'is-overdue' : ''}">${svgIcon('clock')}${overdue ? 'Overdue — was due' : 'Respond by'} ${wbWhen(t.dueAt)}</span>` : '';
  return `<div class="wb-triage" data-lead="${esc(lead.id)}">
    <div class="wb-triage-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span>Human reply · sequence stopped</div><h4>${svgIcon(icon)}Suggested: ${esc(label)} <small class="subtle">(${esc(t.confidence || 'low')} confidence)</small></h4><p class="subtle">${esc(action)}${t.reasons?.length ? ` · ${esc(t.reasons.slice(0, 2).join('; '))}` : ''}</p></div>${sla}</div>
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
  if (action === 'seq-build') { await run(() => API(url('sequence/build'), { method: 'POST', body: JSON.stringify({ force: button.dataset.force === 'true' }) }), 'Sequence plan built — review each step, then approve once.'); return true; }
  if (action === 'seq-save') { await run(() => API(url('sequence'), { method: 'PATCH', body: JSON.stringify({ steps: wbCollectSequenceEdits() }) }), 'Plan saved.'); return true; }
  if (action === 'seq-approve') { const steps = wbCollectSequenceEdits(); await run(() => API(url('sequence/approve'), { method: 'POST', body: JSON.stringify({ steps }) }), r => r.sequence.status === 'running' ? 'Plan approved — step 1 is queued; follow-ups will send themselves unless they reply.' : 'First approval recorded — a second reviewer must countersign.'); return true; }
  if (action === 'seq-countersign') { await run(() => API(url('sequence/approve'), { method: 'POST', body: JSON.stringify({ confirmSecond: true }) }), 'Countersigned — the sequence is running.'); return true; }
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
function dataQualityView() {
  const d = state.dq.data;
  const head = pageHead('Data quality', 'Data engine', 'Identity resolution at ingest, a merge-review queue instead of silent duplicates, freshness scoring with automatic re-verification after 90 days, and a public-contact waterfall with per-hop confidence.', `<button type="button" class="button button-secondary" data-action="dq-refresh">${svgIcon('refresh')}Refresh</button><button type="button" class="button button-primary" data-action="dq-reverify" ${state.dq.busy ? 'disabled' : ''}>${svgIcon('checkCircle')}${state.dq.busy ? 'Re-verifying…' : 'Re-verify stale now'}</button>`);
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
async function wbRunFlow(id, { force = false, redraft = false } = {}) {
  state.wb.busy[id] = true; renderApp();
  try { await API(`/api/leads/${encodeURIComponent(id)}/flow`, { method: 'POST', body: JSON.stringify({ force, redraft }) }); }
  catch (err) { toast(err.message, true); }
  finally { delete state.wb.busy[id]; await refresh(); }
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
  if (action.startsWith('seq-') || action === 'triage-apply') return wbSequenceAction(action, button);
  if (action === 'wb-waterfall') { state.wb.busy[id] = true; renderApp(); try { const r = await API(`/api/leads/${encodeURIComponent(id)}/waterfall`, { method: 'POST', body: '{}' }); toast(r.contactLeads.contacts.length ? `${r.contactLeads.contacts.length} public contact lead(s) found — review them in step 1.` : 'No publicly listed CSI people found on the rungs available.'); } catch (err) { toast(err.message, true); } finally { delete state.wb.busy[id]; await refresh(); } return true; }
  if (action === 'wb-wf-decide') { const decision = button.dataset.decision; const lead = getLead(id); const replace = decision === 'accept' && lead?.contactName ? confirm(`Replace ${lead.contactName} with this person as the primary contact?`) : false; if (decision === 'accept' && lead?.contactName && !replace) return true; try { const r = await API(`/api/leads/${encodeURIComponent(id)}/contact-leads`, { method: 'POST', body: JSON.stringify({ id: button.dataset.contact, action: decision, replace }) }); toast(decision === 'accept' ? 'Contact set — add their public work email in Edit details, then re-run the flow.' : decision === 'candidate' ? 'Captured in Discover as a candidate.' : 'Marked not relevant.'); await refresh(); } catch (err) { toast(err.message, true); } return true; }
  if (action === 'wb-run') { await wbRunFlow(id, { force: button.dataset.force === 'true' }); return true; }
  if (action === 'wb-redraft') { await wbRunFlow(id, { redraft: true }); return true; }
  if (action === 'wb-verify') { state.wb.busy[id] = true; renderApp(); try { const r = await API(`/api/leads/${encodeURIComponent(id)}/verify-mailbox`, { method: 'POST', body: '{}' }); toast(`Mailbox: ${r.mailbox.status} — ${r.mailbox.reason}`, ['invalid', 'undeliverable'].includes(r.mailbox.status)); } catch (err) { toast(err.message, true); } finally { delete state.wb.busy[id]; await refresh(); } return true; }
  if (action === 'wb-delete') { if (!confirm('Remove this dead lead from the database?')) return true; await API(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.wb.selectedId = null; await refresh(); toast('Dead lead removed.'); return true; }
  if (action === 'wb-discover') {
    const q = $('#wb-discover-q')?.value?.trim() || ''; if (!q) return toast('Describe the organisations you want to find.', true) || true;
    state.wb.discovery = { ...state.wb.discovery, query: q, busy: true, error: '' }; renderApp();
    try { const r = await API(`/api/discovery/search?q=${encodeURIComponent(q)}`); state.wb.discovery = { query: q, busy: false, results: r.organisations || [], error: r.warnings?.length && !r.organisations?.length ? r.warnings.join(' ') : '' }; }
    catch (err) { state.wb.discovery = { ...state.wb.discovery, busy: false, results: [], error: err.message }; }
    renderApp(); return true;
  }
  if (action === 'wb-discover-add') {
    const org = state.wb.discovery.results.find(o => o.domain === button.dataset.domain); if (!org) return true;
    button.disabled = true;
    try { const r = await API('/api/discovery/add', { method: 'POST', body: JSON.stringify({ ...org, query: state.wb.discovery.query }) }); org.alreadyTracked = true; state.wb.selectedId = r.lead.id; state.wb.filter = 'all'; await refresh(); toast(`${org.name} added. Add a public work email in Edit details to start verification.`); }
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
function deliverabilityView() {
  const data = state.dlv.data;
  const head = pageHead('Deliverability', 'Sending engine', 'Your own mailboxes, authenticated domains, slow ramps, business-hours windows and a circuit breaker — the plumbing that decides whether emails land.', `<button type="button" class="button button-secondary" data-action="dlv-refresh">${svgIcon('refresh')}Refresh</button><button type="button" class="button button-secondary" data-action="dlv-tick">${svgIcon('send')}Process queue now</button><button type="button" class="button button-primary" data-action="dlv-new-mailbox">${svgIcon('plus')}Add mailbox</button>`);
  if (!data) { loadDeliverability(); return `${head}<div class="panel empty-state"><div class="empty-state-icon">${svgIcon('activity')}</div><p>${state.dlv.error ? esc(state.dlv.error) : 'Loading sending engine…'}</p></div>`; }
  const boxes = data.mailboxes || [];
  const queue = data.queue || {};
  const paused = boxes.filter(m => m.status === 'paused').length;
  const tiles = metricCard('Active mailboxes', String(boxes.filter(m => m.status === 'active').length), `${boxes.length} registered`, 'mail', paused ? `${paused} paused` : '', paused > 0)
    + metricCard('Capacity left today', String(boxes.filter(m => m.status === 'active').reduce((a, m) => a + m.today.remaining, 0)), `of ${boxes.reduce((a, m) => a + m.today.cap, 0)} across caps`, 'trendingUp')
    + metricCard('In queue', String((queue.queued || 0) + (queue.sending || 0)), `${queue.held || 0} held · ${queue.dead || 0} rejected`, 'send', queue.held ? 'needs attention' : '', Boolean(queue.held))
    + metricCard('Sent · 14 days', String(data.series.reduce((a, d) => a + (d.sent || 0), 0)), `${data.series.reduce((a, d) => a + (d.dead || 0), 0)} rejected by receivers`, 'checkCircle');
  return `${head}
  ${data.serverless ? `<div class="notice notice-warn">${svgIcon('info')}<div><strong>On-demand worker.</strong> This host cannot run a background sender, so queued emails are attempted when they become due on the next request, on “Process queue now”, or via the <code>/api/cron/send-tick</code> cron. For reliable scheduled sending run the Docker deployment.</div></div>` : `<p class="subtle">Background worker checks the queue every ${data.workerIntervalSeconds}s. Domain authentication is re-checked every 12 hours.</p>`}
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
      <div><strong>${esc(m.label)}</strong><small>${esc(m.fromName)} &lt;${esc(m.fromEmail)}&gt; · ${esc(m.host)}:${m.port}${m.secure ? ' TLS' : ' STARTTLS'}</small></div>
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
      ${m.status === 'paused' ? `<button type="button" class="button button-primary button-small" data-action="dlv-resume" data-id="${esc(m.id)}">${svgIcon('play')}Resume</button>` : `<button type="button" class="button button-ghost button-small" data-action="dlv-pause" data-id="${esc(m.id)}">${svgIcon('ban')}Pause</button>`}
      <button type="button" class="button button-ghost button-small" data-action="dlv-edit" data-id="${esc(m.id)}">${svgIcon('edit')}Edit</button>
      <button type="button" class="button button-ghost button-small" data-action="dlv-restart-ramp" data-id="${esc(m.id)}">${svgIcon('trendingUp')}Restart ramp</button>
      <button type="button" class="button button-ghost button-small" data-action="dlv-delete" data-id="${esc(m.id)}">${svgIcon('trash')}Remove</button>
    </div>
  </article>`;
}
function dlvMailboxForm(m) {
  const edit = Boolean(m.id);
  return `<section class="panel dlv-form"><div class="settings-section-head"><span class="settings-section-icon blue">${svgIcon('mail')}</span><div><h2>${edit ? 'Edit mailbox' : 'Add sending mailbox'}</h2><p>Use an app password where your provider requires it (Google Workspace: Security → App passwords; Microsoft 365: SMTP AUTH must be enabled). Secrets are encrypted at rest and never returned to the browser.</p></div></div>
    <form data-form="dlv-mailbox" class="settings-form">${edit ? `<input type="hidden" name="id" value="${esc(m.id)}" />` : ''}
      <div class="settings-fields">
        <div class="form-group"><label>Label</label><input class="form-control" name="label" value="${esc(m.label || '')}" placeholder="Partnerships inbox" /></div>
        <div class="form-group"><label>From name</label><input class="form-control" name="fromName" value="${esc(m.fromName || 'Chelo Partnerships Team')}" /></div>
        <div class="form-group"><label>From email</label><input class="form-control" name="fromEmail" type="email" required value="${esc(m.fromEmail || '')}" placeholder="partnerships@yourdomain.org" /></div>
        <div class="form-group"><label>SMTP host</label><input class="form-control" name="host" required value="${esc(m.host || '')}" placeholder="smtp.gmail.com / smtp.office365.com" /></div>
        <div class="form-group"><label>Port</label><input class="form-control" name="port" type="number" min="1" max="65535" value="${m.port || 587}" /></div>
        <div class="form-group"><label>Username</label><input class="form-control" name="username" autocomplete="username" value="${esc(m.username || '')}" /></div>
        <div class="form-group"><label>Password / app password</label><input class="form-control" name="password" type="password" autocomplete="new-password" placeholder="${m.hasPassword ? 'Stored — leave blank to keep' : ''}" /></div>
        <div class="form-group"><label>Daily cap (full, after ramp)</label><input class="form-control" name="dailyCap" type="number" min="1" max="500" value="${m.dailyCap || (state.dlv.data?.policy?.defaultDailyCap || 25)}" /><span class="form-hint">Practitioners keep Workspace/365 mailboxes at 20–40 cold sends a day. Add mailboxes rather than raising this.</span></div>
        <div class="form-group"><label>DKIM selector <span class="optional">(optional)</span></label><input class="form-control" name="dkimSelector" value="${esc(m.dkimSelector || '')}" placeholder="google / selector1" /></div>
        <label class="check-row"><input type="checkbox" name="secure" ${m.secure ? 'checked' : ''} /> Implicit TLS (port 465)</label>
        <label class="check-row"><input type="checkbox" name="rampEnabled" ${m.rampEnabled === false ? '' : 'checked'} /> Ramp a new mailbox slowly (${(state.dlv.data?.policy?.ramp || []).join(' → ')} per day, week by week)</label>
      </div>
      <div class="settings-card-actions"><button type="button" class="button button-ghost" data-action="dlv-cancel-edit">${svgIcon('xCircle')}Cancel</button><button type="submit" class="button button-primary">${svgIcon('check')}${edit ? 'Save mailbox' : 'Add & check domain'}</button></div>
    </form></section>`;
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
  return `<section class="panel"><div class="settings-section-head"><span class="settings-section-icon purple">${svgIcon('send')}</span><div><h2>Send queue</h2><p>Every approved email passes through here: suppression gate → mailbox cap → window → SMTP. Rejected addresses are quarantined automatically.</p></div></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table dlv-queue"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(j => `<tr><td>${dlvWhen(j.status === 'sent' ? j.sentAt : j.scheduledAt)}</td><td><strong>${esc(j.meta?.company || '')}</strong><br><small>${esc(j.to)}</small></td><td>${esc(j.subject)}${j.lastError ? `<br><small class="form-error">${esc(j.lastError.slice(0, 120))}</small>` : ''}</td><td>${dlvJobPill(j.status)}${j.attempts > 1 ? `<small class="subtle"> ×${j.attempts}</small>` : ''}</td><td class="dlv-queue-actions">${['queued', 'held', 'failed'].includes(j.status) ? `<button type="button" class="button button-ghost button-small" data-action="dlv-cancel-job" data-id="${esc(j.id)}">${svgIcon('xCircle')}Cancel</button>` : ''}${['held', 'failed', 'dead'].includes(j.status) ? `<button type="button" class="button button-ghost button-small" data-action="dlv-retry-job" data-id="${esc(j.id)}">${svgIcon('refresh')}Retry</button>` : ''}${j.leadId ? `<button type="button" class="button button-ghost button-small" data-action="wb-open" data-id="${esc(j.leadId)}">${svgIcon('external')}Lead</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="subtle">Queue is empty.</p>`}</section>`;
}
async function dlvAction(action, button) {
  const id = button.dataset.id;
  const call = async (url, body = {}, method = 'POST') => API(url, { method, body: method === 'DELETE' ? undefined : JSON.stringify(body) });
  try {
    if (action === 'dlv-refresh') { await loadDeliverability(true); return true; }
    if (action === 'dlv-new-mailbox') { state.dlv.editing = {}; renderApp(); document.querySelector('.dlv-form')?.scrollIntoView({ behavior: 'smooth' }); return true; }
    if (action === 'dlv-cancel-edit') { state.dlv.editing = null; renderApp(); return true; }
    if (action === 'dlv-edit') { state.dlv.editing = (state.dlv.data.mailboxes || []).find(m => m.id === id) || {}; renderApp(); return true; }
    if (action === 'dlv-tick') { const r = await call('/api/deliverability/tick'); toast(r.ran ? `Processed ${r.ran} queued email(s).` : 'Nothing is due right now.'); await loadDeliverability(true); await refresh(); return true; }
    if (action === 'dlv-check') { const r = await call(`/api/deliverability/mailboxes/${id}/check`); toast(`Domain ${r.health.domain}: ${r.health.status}${r.health.issues.length ? ` — ${r.health.issues.map(i => i.title).join(', ')} need attention` : ''}`, r.health.status === 'fail'); await loadDeliverability(true); return true; }
    if (action === 'dlv-test') { const r = await call(`/api/deliverability/mailboxes/${id}/test`); toast(r.message); return true; }
    if (action === 'dlv-pause') { await call(`/api/deliverability/mailboxes/${id}/pause`, { reason: 'paused by staff' }); await loadDeliverability(true); return true; }
    if (action === 'dlv-resume') { const r = await call(`/api/deliverability/mailboxes/${id}/resume`); toast(r.warning || 'Mailbox resumed.', Boolean(r.warning)); await loadDeliverability(true); return true; }
    if (action === 'dlv-restart-ramp') { await call(`/api/deliverability/mailboxes/${id}/restart-ramp`); toast('Ramp restarted from week 1.'); await loadDeliverability(true); return true; }
    if (action === 'dlv-delete') { if (!confirm('Remove this mailbox? Queued emails on it will be held.')) return true; await call(`/api/deliverability/mailboxes/${id}`, {}, 'DELETE'); await loadDeliverability(true); return true; }
    if (action === 'dlv-cancel-job') { await call(`/api/deliverability/jobs/${id}/cancel`); await loadDeliverability(true); await refresh(); return true; }
    if (action === 'dlv-retry-job') { await call(`/api/deliverability/jobs/${id}/retry`); toast('Re-queued in the next free slot.'); await loadDeliverability(true); await refresh(); return true; }
    if (action === 'wb-open') { state.wb.selectedId = id; state.wb.filter = 'all'; setView('workbench'); return true; }
  } catch (err) { toast(err.message, true); return true; }
  return false;
}
async function dlvMailboxSubmit(form) {
  const data = formDataObject(form);
  data.secure = form.querySelector('[name="secure"]').checked; data.rampEnabled = form.querySelector('[name="rampEnabled"]').checked;
  data.port = Number(data.port); data.dailyCap = Number(data.dailyCap);
  if (!data.password) delete data.password;
  try { const r = await API('/api/deliverability/mailboxes', { method: 'POST', body: JSON.stringify(data) }); state.dlv.editing = null; toast(`Mailbox saved. Domain ${r.mailbox.domain}: ${r.mailbox.health?.status || 'checked'}.`, r.mailbox.health?.status === 'fail'); await loadDeliverability(true); await refresh(); }
  catch (err) { toast(err.message, true); }
}
async function dlvPolicySubmit(form) {
  const data = formDataObject(form);
  const body = { windowStart: data.windowStart, windowEnd: data.windowEnd, timezone: data.timezone, defaultDailyCap: Number(data.defaultDailyCap), minGapSeconds: Number(data.minGapSeconds), jitterSeconds: Number(data.jitterSeconds), ramp: String(data.ramp || '').split(/[,\s]+/).map(Number).filter(n => n > 0), sendDays: [...form.querySelectorAll('[name="sendDays"]:checked')].map(i => Number(i.value)), breaker: { hardBounceRate: Number(data.hardBounceRate) / 100, complaintRate: Number(data.complaintRate) / 100 } };
  try { await API('/api/deliverability/policy', { method: 'POST', body: JSON.stringify(body) }); toast('Sending policy saved.'); await loadDeliverability(true); }
  catch (err) { toast(err.message, true); }
}
