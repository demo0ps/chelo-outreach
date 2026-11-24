'use strict';
// Four Desks — Release 3 (v62): the Schools desk. The DBE master list (province → district → circuit → school) lives in its
// own SQLite table; a school becomes a target (kind = 'school') only when a person adds it. Schools reached by email where
// one is published, otherwise by a call task with a script. The ask is always the same: a 15-minute call with the principal.
// Needs captured on that call become Verified Projects. Pure logic + one SQLite table; no network.
const districts = require('./districts'); // v72: district-office partnership requests
/** v72: NextFinder is Chelo's sister service — an on-site assessment with a scored report. Always optional, never priced here. */
const NEXTFINDER_URL = 'https://nextfinder.org';
const NEXTFINDER_NUDGE = `If you would like an independent picture of what the school needs before we talk, our sister service NextFinder (${NEXTFINDER_URL}) visits the school and produces a scored report with project recommendations. It is optional — a Chelo listing does not depend on it.`;
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { OPT_OUT_FOOTER } = require('./conversion');

const BUNDLED = path.join(__dirname, '..', 'data-seeds', 'dbe-schools-2025q2.csv.gz');
const BUNDLED_LABEL = 'DBE national master list, Q2 2025 (25 500 open schools)';
const PROVINCE_NAMES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
const PROVINCE_CODES = { EC: 'Eastern Cape', FS: 'Free State', GT: 'Gauteng', GP: 'Gauteng', KZN: 'KwaZulu-Natal', LP: 'Limpopo', MP: 'Mpumalanga', NW: 'North West', NC: 'Northern Cape', WC: 'Western Cape' };
const COLS = ['natemis', 'name', 'province', 'district', 'circuit', 'phase', 'sector', 'type', 'quintile', 'noFee', 'urbanRural', 'town', 'municipality', 'email', 'phone', 'principal', 'learners', 'educators', 'lat', 'lng'];
// Official DBE Excel/CSV headers → our columns (so the user can upload a newer quarter straight from the DBE site).
const DBE_HEADERS = { natemis: 'natemis', official_institution_name: 'name', institution_name: 'name', province: 'province', eidistrict: 'district', eicircuit: 'circuit', phase_ped: 'phase', sector: 'sector', type_doe: 'type', quintile: 'quintile', nofeeschool: 'noFee', urban_rural: 'urbanRural', town_city: 'town', lmunname: 'municipality', email: 'email', telephone: 'phone', addressee: 'principal', gis_long: 'lat', gis_lat: 'lng', status: 'status', learners: 'learners', educators: 'educators' };
for (const y of [2023, 2024, 2025, 2026, 2027, 2028]) { DBE_HEADERS[`learners${y}`] = 'learners'; DBE_HEADERS[`educators${y}`] = 'educators'; }
const CALL_OUTCOMES = ['booked', 'no-answer', 'call-back', 'declined', 'wrong-number'];
const NEED_CATEGORIES = ['classrooms', 'sanitation', 'water', 'electricity', 'ict', 'library', 'sports', 'furniture', 'fencing', 'kitchen', 'other'];
const FOLLOW_UP_OFFSETS = [0, 5, 7];

function clamp(text, max) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t; }
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function cleanPhone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('27') && d.length === 11) d = `0${d.slice(2)}`; if (d.length === 9) d = `0${d}`; return d.length >= 10 && d.length <= 11 ? d : ''; }
function cleanEmail(v) { const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? e : ''; }

// ---------- CSV (RFC-4180 enough for DBE exports) ----------
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}
/** Map a header row (ours or the DBE's) to column names; null when it is neither. */
function headerMap(header) {
  const norm = header.map(h => String(h || '').replace(/^\uFEFF/, '').trim());
  if (COLS.every(c => norm.includes(c))) return norm.map(h => (COLS.includes(h) ? h : null));
  const mapped = norm.map(h => DBE_HEADERS[h.toLowerCase().replace(/[^a-z0-9]+/g, '_')] || null);
  return mapped.includes('natemis') && mapped.includes('name') ? mapped : null;
}
function rowToSchool(cells, map) {
  const r = {};
  map.forEach((col, i) => { if (col) r[col] = cells[i] ?? ''; });
  if (r.status && !/^open/i.test(String(r.status).trim())) return null;
  const natemis = String(r.natemis || '').trim();
  if (!/^\d{6,12}$/.test(natemis)) return null;
  const drop = v => (['99', 'unknown', 'n/a', ''].includes(String(v || '').trim().toLowerCase()) ? '' : String(v).trim());
  let lat = Number(r.lat), lng = Number(r.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat > 0 && lng < 0) [lat, lng] = [lng, lat]; // DBE files swap the GIS columns
  const noFee = /^(yes|no fee)$/i.test(String(r.noFee || '').trim()) ? 'yes' : '';
  return {
    natemis, name: titleCase(drop(r.name)), province: PROVINCE_CODES[String(r.province || '').trim().toUpperCase()] || PROVINCE_NAMES.find(n => n.toLowerCase() === String(r.province || '').trim().toLowerCase()) || titleCase(drop(r.province)),
    district: titleCase(drop(r.district)), circuit: titleCase(drop(r.circuit)), phase: titleCase(drop(r.phase)), sector: titleCase(drop(r.sector)), type: titleCase(drop(r.type)),
    quintile: drop(r.quintile).toUpperCase(), noFee, urbanRural: titleCase(drop(r.urbanRural)), town: titleCase(drop(r.town)), municipality: drop(r.municipality),
    email: cleanEmail(r.email), phone: cleanPhone(r.phone), principal: titleCase(drop(r.principal)),
    learners: /^\d+$/.test(String(r.learners || '').trim()) ? Number(r.learners) : null, educators: /^\d+$/.test(String(r.educators || '').trim()) ? Number(r.educators) : null,
    lat: Number.isFinite(lat) ? Number(lat.toFixed(4)) : null, lng: Number.isFinite(lng) ? Number(lng.toFixed(4)) : null
  };
}

// ---------- store ----------
function createSchoolsStore(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schools (
    natemis TEXT PRIMARY KEY, name TEXT NOT NULL, province TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '', circuit TEXT NOT NULL DEFAULT '',
    phase TEXT NOT NULL DEFAULT '', sector TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', quintile TEXT NOT NULL DEFAULT '', no_fee TEXT NOT NULL DEFAULT '',
    urban_rural TEXT NOT NULL DEFAULT '', town TEXT NOT NULL DEFAULT '', municipality TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    principal TEXT NOT NULL DEFAULT '', learners INTEGER, educators INTEGER, lat REAL, lng REAL, source TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT ''
  ); CREATE INDEX IF NOT EXISTS idx_schools_tree ON schools (province, district, circuit);
  CREATE TABLE IF NOT EXISTS schools_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const upsert = conn.prepare(`INSERT INTO schools (natemis, name, province, district, circuit, phase, sector, type, quintile, no_fee, urban_rural, town, municipality, email, phone, principal, learners, educators, lat, lng, source, imported_at)
    VALUES (@natemis, @name, @province, @district, @circuit, @phase, @sector, @type, @quintile, @noFee, @urbanRural, @town, @municipality, @email, @phone, @principal, @learners, @educators, @lat, @lng, @source, @importedAt)
    ON CONFLICT(natemis) DO UPDATE SET name = excluded.name, province = excluded.province, district = excluded.district, circuit = excluded.circuit, phase = excluded.phase, sector = excluded.sector, type = excluded.type, quintile = excluded.quintile, no_fee = excluded.no_fee, urban_rural = excluded.urban_rural, town = excluded.town, municipality = excluded.municipality,
      email = CASE WHEN excluded.email = '' THEN schools.email ELSE excluded.email END, phone = CASE WHEN excluded.phone = '' THEN schools.phone ELSE excluded.phone END, principal = excluded.principal, learners = excluded.learners, educators = excluded.educators, lat = excluded.lat, lng = excluded.lng, source = excluded.source, imported_at = excluded.imported_at`);
  const setMeta = conn.prepare('INSERT INTO schools_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const getMeta = key => conn.prepare('SELECT value FROM schools_meta WHERE key = ?').get(key)?.value || '';
  const rowOut = r => r && ({ natemis: r.natemis, name: r.name, province: r.province, district: r.district, circuit: r.circuit, phase: r.phase, sector: r.sector, type: r.type, quintile: r.quintile, noFee: r.no_fee === 'yes', urbanRural: r.urban_rural, town: r.town, municipality: r.municipality, email: r.email, phone: r.phone, principal: r.principal, learners: r.learners, educators: r.educators, lat: r.lat, lng: r.lng });

  function importRows(rows, map, source) {
    const importedAt = new Date().toISOString();
    let imported = 0, skipped = 0;
    conn.exec('BEGIN IMMEDIATE');
    try { for (const cells of rows) { const s = rowToSchool(cells, map); if (!s) { skipped += 1; continue; } upsert.run({ ...s, source, importedAt }); imported += 1; } conn.exec('COMMIT'); }
    catch (err) { conn.exec('ROLLBACK'); throw err; }
    setMeta.run('source', source); setMeta.run('importedAt', importedAt);
    return { imported, skipped, total: count() };
  }
  function importCsv(text, { source = 'upload' } = {}) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('The file is empty.');
    const map = headerMap(rows[0]);
    if (!map) throw new Error('This does not look like the DBE master list. Expected columns such as NatEmis, Official_Institution_Name, Province, EIDistrict, EICircuit, Email, Telephone.');
    return importRows(rows.slice(1), map, source);
  }
  function loadBundled() {
    if (!fs.existsSync(BUNDLED)) throw new Error('The bundled DBE list is missing from this build.');
    return importCsv(zlib.gunzipSync(fs.readFileSync(BUNDLED)).toString('utf8'), { source: BUNDLED_LABEL });
  }
  function count() { return conn.prepare('SELECT COUNT(*) AS n FROM schools').get().n; }
  function status() {
    const n = count();
    return { loaded: n > 0, total: n, withEmail: n ? conn.prepare("SELECT COUNT(*) AS n FROM schools WHERE email <> ''").get().n : 0, withPhone: n ? conn.prepare("SELECT COUNT(*) AS n FROM schools WHERE phone <> ''").get().n : 0, source: getMeta('source'), importedAt: getMeta('importedAt'), bundledAvailable: fs.existsSync(BUNDLED), bundledLabel: BUNDLED_LABEL };
  }
  /** District first: provinces → districts (with reach counts); pass a province+district for its circuits. */
  function tree({ province = '', district = '' } = {}) {
    const agg = "COUNT(*) AS schools, SUM(email <> '') AS withEmail, SUM(phone <> '') AS withPhone, SUM(no_fee = 'yes') AS noFee";
    if (!province) return { level: 'provinces', items: conn.prepare(`SELECT province AS name, ${agg} FROM schools GROUP BY province ORDER BY province`).all() };
    if (!district) return { level: 'districts', province, items: conn.prepare(`SELECT district AS name, ${agg} FROM schools WHERE province = ? GROUP BY district ORDER BY schools DESC`).all(province) };
    return { level: 'circuits', province, district, items: conn.prepare(`SELECT circuit AS name, ${agg} FROM schools WHERE province = ? AND district = ? GROUP BY circuit ORDER BY schools DESC`).all(province, district) };
  }
  function list({ province = '', district = '', circuit = '', phase = '', contact = '', q = '', limit = 200, offset = 0 } = {}) {
    const where = []; const args = [];
    if (province) { where.push('province = ?'); args.push(province); }
    if (district) { where.push('district = ?'); args.push(district); }
    if (circuit) { where.push('circuit = ?'); args.push(circuit); }
    if (phase) { where.push('phase LIKE ?'); args.push(`%${phase}%`); }
    if (contact === 'email') where.push("email <> ''"); else if (contact === 'phone') where.push("phone <> '' AND email = ''"); else if (contact === 'any') where.push("(email <> '' OR phone <> '')");
    if (q) { where.push('(name LIKE ? OR town LIKE ? OR natemis LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `${q}%`); }
    const sql = `FROM schools ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const total = conn.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
    const items = conn.prepare(`SELECT * ${sql} ORDER BY (email = ''), (phone = ''), name LIMIT ? OFFSET ?`).all(...args, Math.min(500, Math.max(1, Number(limit) || 200)), Math.max(0, Number(offset) || 0)).map(rowOut);
    return { total, items };
  }
  function get(natemis) { return rowOut(conn.prepare('SELECT * FROM schools WHERE natemis = ?').get(String(natemis))); }
  return { importCsv, loadBundled, status, tree, list, get, count };
}

// ---------- school → target ----------
function leadFromSchool(s) {
  return {
    company: s.name, kind: 'school', natemis: s.natemis, contactName: s.principal ? `${s.principal} (principal)` : 'The Principal', title: 'Principal',
    email: s.email || '', phone: s.phone || '', province: s.province, sector: 'Education', sourceName: 'DBE master list', sourceUrl: 'https://www.education.gov.za/Programmes/EMIS/EMISDownloads.aspx',
    school: { natemis: s.natemis, district: s.district, circuit: s.circuit, phase: s.phase, sector: s.sector, quintile: s.quintile, noFee: Boolean(s.noFee), urbanRural: s.urbanRural, town: s.town, municipality: s.municipality, learners: s.learners, educators: s.educators },
    contactChannel: s.email ? 'email' : s.phone ? 'phone' : 'none', stage: 'New'
  };
}
/** Facts we already know from the DBE list, in the brief shape, so the review step works like every other desk. */
/** v72: brief for a district office — the district as the DBE list shows it plus what Chelo already has there. */
function districtBrief(lead) {
  const s = lead.school || {}; const st = s.stats || {}; const stamp = id => `${id}-${crypto.randomBytes(3).toString('hex')}`;
  const facts = [];
  if (st.schools) facts.push(`${s.district} district (${lead.province}) has ${st.schools.toLocaleString('en-ZA')} public schools on the DBE list${st.withEmail ? `; ${st.withEmail.toLocaleString('en-ZA')} publish an email address` : ''}.`);
  if (st.q13) facts.push(`${st.q13.toLocaleString('en-ZA')} schools are quintile 1–3${st.noFee ? ` and ${st.noFee.toLocaleString('en-ZA')} are no-fee` : ''}.`);
  if (st.schoolsOnChelo) facts.push(`${st.schoolsOnChelo} school${st.schoolsOnChelo === 1 ? '' : 's'} in the district already on Chelo, ${st.needsLogged} need${st.needsLogged === 1 ? '' : 's'} logged${st.projects ? `, ${st.projects} verified project${st.projects === 1 ? '' : 's'}` : ''}.`);
  const base = dbeBriefFrom(lead, facts, stamp);
  if (lead.sourceUrl) base.sources.unshift({ url: lead.sourceUrl, title: 'District office page', official: /\.gov\.za/.test(lead.sourceUrl) });
  return base;
}
function dbeBrief(lead) {
  const s = lead.school || {};
  if (s.level === 'district') return districtBrief(lead); // v72
  const stamp = id => `${id}-${crypto.randomBytes(3).toString('hex')}`;
  const facts = [];
  if (s.phase) facts.push(`${lead.company} is a ${s.sector ? `${s.sector.toLowerCase()} ` : ''}${s.phase.toLowerCase()}${s.district ? ` in the ${s.district} district` : ''}${lead.province ? `, ${lead.province}` : ''}.`);
  if (s.learners) facts.push(`About ${s.learners.toLocaleString('en-ZA')} learners${s.educators ? ` and ${s.educators} educators` : ''} (DBE 2025).`);
  if (s.quintile && /^Q[1-5]$/.test(s.quintile)) facts.push(`Quintile ${s.quintile.slice(1)}${s.noFee ? ' no-fee school' : ''}${s.urbanRural ? `, ${s.urbanRural.toLowerCase()}` : ''}.`);
  if (s.town) facts.push(`Town: ${s.town}${s.municipality ? ` (${s.municipality})` : ''}.`);
  return dbeBriefFrom(lead, facts, stamp);
}
function dbeBriefFrom(lead, facts, stamp) {
  const now = new Date().toISOString();
  return {
    id: `brief-${crypto.randomBytes(6).toString('hex')}`, company: lead.company, website: '', sector: 'Education', kind: 'dbe', generatedAt: now, expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(), provider: 'dbe-master-list', mode: 'local', status: 'pending-review',
    missionSummary: facts[0] || '', focusAreas: [], suggestedProjectId: null,
    findings: facts.map((text, i) => ({ id: stamp(`f${i + 1}`), kind: 'dbe', text, sourceUrl: 'https://www.education.gov.za/Programmes/EMIS/EMISDownloads.aspx', sourceTitle: 'DBE master list', confidence: 'high', fresh: true, themes: ['school'] })),
    articles: [], contacts: [], alignmentPoints: [], sources: [{ url: 'https://www.education.gov.za/Programmes/EMIS/EMISDownloads.aspx', title: 'DBE master list of schools', official: true }],
    attempted: [], redactions: { emails: 0, phones: 0, saIds: 0, total: 0 }, warnings: [], approvedFindingIds: [], approvedAlignmentIds: [], approvedContactIds: []
  };
}

// ---------- the ask: a 15-minute principal call ----------
function emailStep({ step = 1, lead, links = {}, staff = {} }) {
  const s = lead.school || {};
  if (s.level === 'district') return districts.emailStep({ step, lead, links, staff }); // v72
  const school = clamp(lead.company, 90);
  const signature = `Kind regards,\n${staff.name || 'Chelo Schools Team'}\nChelo · cheloapp.com${staff.phone ? ` · ${staff.phone}` : ''}`;
  const optOut = links.optOut ? `\n\n${OPT_OUT_FOOTER}${links.optOut}` : '';
  const call = links.booking ? `Pick a time that suits you here: ${links.booking}` : '';
  if (step === 1) {
    return {
      subject: `${school}: a 15-minute call about what your school needs`,
      body: `Dear Principal,\n\nChelo lists public schools and the real needs they have — classrooms, sanitation, water, electricity, ICT, a library, fencing — and connects each need with a company that funds it. We confirm the need with you, get the quotes, the company pays the supplier directly, and you sign off the work. Listing ${school} on Chelo is free, and so is everything that follows: no fee, no form, no money through the school.\n\nWe are working through the ${s.district ? `${s.district} district` : lead.province || 'your district'} and would like 15 minutes on the phone to hear what ${school} needs most this year. ${call}\n\n${NEXTFINDER_NUDGE}\n\nIf you prefer, reply with a phone number and a good time and we will call you.\n\n${signature}${optOut}`
    };
  }
  if (step === 2) return { subject: 'Re: {subject}', body: `Dear Principal,\n\nA short follow-up in case my earlier email was missed. Fifteen minutes is all we need to list ${school} and understand what it needs most; after that Chelo does the work of finding a funder. It costs the school nothing.\n\n${call}\n\n${signature}${optOut}` };
  return { subject: 'Re: {subject}', body: `Dear Principal,\n\nI will close this thread here. If a need comes up at ${school} — this term or next — reply to this email or ${links.booking ? `book a time: ${links.booking}` : 'send us a phone number'} and we will pick it up.\n\n${signature}${optOut}` };
}
/** What the person says on the phone. Short, plain, one ask. */
function callScript(lead, staff = {}) {
  const s = lead.school || {};
  if (s.level === 'district') { // v72
    const st = s.stats || {};
    return [
      `Ask for the District Director's office. If unavailable: the Chief Education Specialist for institutional support, or the Director's PA — and when the Director is usually in.`,
      `"Good morning, my name is ${staff.name || '…'} from Chelo. We connect public schools with companies that fund real needs — classrooms, toilets, water, electricity, computers — and we want to work with the ${s.district} district office rather than around it."`,
      `"${st.schools ? `The district has ${st.schools.toLocaleString('en-ZA')} schools on the DBE list${st.q13 ? `, ${st.q13.toLocaleString('en-ZA')} quintile 1–3` : ''}. ` : ''}Listing is free for every school and we never ask the district or a school for money. We are asking for three things: a signed MoU, permission to approach principals, and the principals' contact details. Could I have thirty minutes with the Director or a delegated official?"`,
      'If yes: book the time and ask for the official\'s email so the partnership note and MoU can be sent ahead. If no: ask whether the circuit managers may be approached directly, note the name, and thank them.'
    ];
  }
  const who = s.principal || lead.contactName?.replace(/\s*\(principal\)$/i, '') || 'the principal';
  return [
    `Ask for ${who}. If unavailable: ask for the deputy or the admin clerk, and when the principal is usually in.`,
    `"Good morning, my name is ${staff.name || '…'} from Chelo. We connect schools with companies that fund real needs — classrooms, toilets, water, electricity, computers. We are working through the ${s.district || lead.province || 'district'} schools."`,
    `"I am not selling anything. Listing the school on Chelo is free and so is everything after it — we never ask the school for money. I would like 15 minutes with the principal to hear what ${clamp(lead.company, 60)} needs most this year. Could we book that?"`,
    `If they ask how we know what a school needs: "We confirm it with you on the call. If the school wants an independent assessment first, our sister service NextFinder visits the school and produces a scored report — that is optional and separate from the Chelo listing."`,
    'If yes → agree a day and time, confirm the best number, and press "Call booked" below.',
    'If "send an email" → ask for the address, add it under Edit details, and press Run; Chelo sends the email.',
    'If busy → ask when to call back and press "Call back". If not interested → press "Declined" and move on.',
    'Never ask for ID numbers, learner names or anything personal. The school\'s needs only.'
  ];
}
function openCallTask(lead, { actor = 'system', staff = {} } = {}) {
  if (lead.callTask && ['open', 'call-back', 'booked'].includes(lead.callTask.status)) return lead.callTask;
  lead.callTask = { id: `call_${crypto.randomBytes(4).toString('hex')}`, status: 'open', phone: lead.phone || '', script: callScript(lead, staff), attempts: 0, openedAt: new Date().toISOString(), openedBy: actor, history: [] };
  return lead.callTask;
}
function recordCall(lead, { outcome, notes = '', callBackAt = '', bookedAt = '', actor = 'staff' }) {
  if (!CALL_OUTCOMES.includes(outcome)) throw new Error(`Outcome must be one of ${CALL_OUTCOMES.join(', ')}.`);
  const task = lead.callTask || openCallTask(lead, { actor });
  const at = new Date().toISOString();
  task.attempts = (task.attempts || 0) + 1;
  task.history = [...(task.history || []), { at, by: actor, outcome, notes: clamp(notes, 400) }].slice(-20);
  task.lastOutcome = outcome; task.lastAt = at;
  if (outcome === 'booked') { task.status = 'booked'; task.bookedAt = bookedAt || ''; if (['New', 'Researched', 'Contacted'].includes(lead.stage)) lead.stage = 'Briefing booked'; }
  else if (outcome === 'call-back') { task.status = 'call-back'; task.callBackAt = callBackAt || ''; if (lead.stage === 'New') lead.stage = 'Contacted'; }
  else if (outcome === 'no-answer') { task.status = task.attempts >= 4 ? 'exhausted' : 'open'; if (lead.stage === 'New') lead.stage = 'Contacted'; }
  else if (outcome === 'declined') { task.status = 'declined'; lead.stage = 'Not proceeding'; }
  else if (outcome === 'wrong-number') { task.status = 'wrong-number'; }
  return task;
}

// ---------- needs → Verified Project ----------
function addNeed(lead, { text, category = 'other', estimate = 0, actor = 'staff' }) {
  const t = clamp(text, 300); if (!t) throw new Error('Describe the need in a sentence.');
  const need = { id: `need_${crypto.randomBytes(4).toString('hex')}`, text: t, category: NEED_CATEGORIES.includes(category) ? category : 'other', estimate: Math.max(0, Number(estimate) || 0), status: 'captured', capturedAt: new Date().toISOString(), capturedBy: actor, projectId: '' };
  lead.needs = [...(lead.needs || []), need].slice(0, 20);
  return need;
}
/** The project body a need becomes (goes through the normal safeProject validation). */
function projectFromNeed(lead, need) {
  const s = lead.school || {};
  const label = need.category === 'other' ? 'Project' : titleCase(need.category);
  return {
    name: `${label} — ${clamp(lead.company, 80)}`, recipientName: lead.company, recipientType: `${s.phase || 'School'}${s.quintile ? ` · ${s.quintile}` : ''}`, province: lead.province || '',
    sector: 'Education', targetAmount: need.estimate || 0, committedAmount: 0, status: 'Verified · Seeking Partners',
    summary: `${need.text} Captured on the principal call${lead.callTask?.bookedAt ? ` (${lead.callTask.bookedAt})` : ''}. ${[s.learners ? `${s.learners.toLocaleString('en-ZA')} learners` : '', s.noFee ? 'no-fee school' : '', s.district ? `${s.district} district` : ''].filter(Boolean).join(', ')}.`.replace(/\s+/g, ' ').replace(/\s\.$/, '').trim(),
    sourceUrl: 'https://www.education.gov.za/Programmes/EMIS/EMISDownloads.aspx', verifiedAt: new Date().toISOString().slice(0, 10)
  };
}

module.exports = { NEXTFINDER_URL, NEXTFINDER_NUDGE, PROVINCE_NAMES, BUNDLED, BUNDLED_LABEL, COLS, CALL_OUTCOMES, NEED_CATEGORIES, FOLLOW_UP_OFFSETS, parseCsv, headerMap, rowToSchool, createSchoolsStore, leadFromSchool, dbeBrief, emailStep, callScript, openCallTask, recordCall, addNeed, projectFromNeed };
