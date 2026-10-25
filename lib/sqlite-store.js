const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { seededProjects, seededDb } = require('./seed-data');

module.exports = function createSqliteStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const sqlitePath = path.join(dataDir, 'chelo.sqlite');
  const legacyJsonPath = path.join(dataDir, 'db.json');

  const conn = new DatabaseSync(sqlitePath);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      sector TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      target_amount REAL NOT NULL DEFAULT 0,
      committed_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Verified · Seeking Partners',
      updated_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      company TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'New',
      project_id TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      do_not_contact INTEGER NOT NULL DEFAULT 0,
      booking_token TEXT NOT NULL DEFAULT '',
      proposal_token TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
    CREATE INDEX IF NOT EXISTS idx_leads_booking ON leads(booking_token);

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      company TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'New candidate',
      created_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      lead_id TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      amount REAL NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      lead_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Requested',
      date TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      lead_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'initial',
      status TEXT NOT NULL DEFAULT '',
      open_token TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
    CREATE INDEX IF NOT EXISTS idx_messages_open ON messages(open_token);

    CREATE TABLE IF NOT EXISTS email_events (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      lead_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_lead ON email_events(lead_id);

    CREATE TABLE IF NOT EXISTS suppressed_emails (
      hash TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'update',
      created_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merge_reviews (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      record_id TEXT NOT NULL DEFAULT '',
      match_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_merge_reviews_status ON merge_reviews(status);

    -- Batch 5: relationship memory + stewardship (additive)
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      lead_id TEXT NOT NULL DEFAULT '',
      partner_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'other',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_people_lead ON people(lead_id);
    CREATE TABLE IF NOT EXISTS touches (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      lead_id TEXT NOT NULL DEFAULT '',
      partner_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'note',
      at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_touches_lead ON touches(lead_id);
    CREATE TABLE IF NOT EXISTS pledges (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      partner_id TEXT NOT NULL DEFAULT '',
      lead_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pledged',
      amount REAL NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pledges_partner ON pledges(partner_id);
    CREATE TABLE IF NOT EXISTS stewardship_tasks (
      id TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      partner_id TEXT NOT NULL DEFAULT '',
      cadence_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      due_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stewardship_partner ON stewardship_tasks(partner_id, cadence_key);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'admin',
      csrf_token TEXT NOT NULL,
      demo_access INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_failures (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL
    );
  `);

  const getMetaStmt = conn.prepare('SELECT value FROM meta WHERE key = ?');
  const setMetaStmt = conn.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  function persistState(state) {
    conn.exec('BEGIN IMMEDIATE');
    try {
      const syncCollection = (table, rows, insertSql, mapParams) => {
        conn.exec(`DELETE FROM ${table}`);
        const stmt = conn.prepare(insertSql);
        rows.forEach((row, index) => stmt.run(...mapParams(row, index)));
      };

      syncCollection(
        'projects',
        state.projects || [],
        'INSERT INTO projects (id, pos, name, sector, province, target_amount, committed_amount, status, updated_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (p, idx) => [String(p.id), idx, String(p.name || ''), String(p.sector || ''), String(p.province || ''), Number(p.targetAmount || 0), Number(p.committedAmount || 0), String(p.status || 'Verified · Seeking Partners'), String(p.updatedAt || ''), JSON.stringify(p)]
      );

      syncCollection(
        'leads',
        state.leads || [],
        'INSERT INTO leads (id, pos, company, email, stage, project_id, amount, do_not_contact, booking_token, proposal_token, updated_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (l, idx) => [String(l.id), idx, String(l.company || ''), String(l.email || ''), String(l.stage || 'New'), String(l.projectId || ''), Number(l.amount || 0), l.doNotContact ? 1 : 0, String(l.bookingToken || ''), String(l.proposalToken || ''), String(l.updatedAt || ''), JSON.stringify(l)]
      );

      syncCollection(
        'candidates',
        state.candidates || [],
        'INSERT INTO candidates (id, pos, company, email, status, created_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (c, idx) => [String(c.id), idx, String(c.company || ''), String(c.email || ''), String(c.status || 'New candidate'), String(c.createdAt || ''), JSON.stringify(c)]
      );

      syncCollection(
        'partners',
        state.partners || [],
        'INSERT INTO partners (id, pos, lead_id, company, status, amount, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (p, idx) => [String(p.id), idx, String(p.leadId || ''), String(p.company || ''), String(p.status || 'Active'), Number(p.amount || 0), JSON.stringify(p)]
      );

      syncCollection(
        'bookings',
        state.bookings || [],
        'INSERT INTO bookings (id, pos, lead_id, status, date, time, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (b, idx) => [String(b.id), idx, String(b.leadId || ''), String(b.status || 'Requested'), String(b.date || ''), String(b.time || ''), JSON.stringify(b)]
      );

      syncCollection(
        'messages',
        (state.messages || []).slice(0, 10000),
        'INSERT INTO messages (id, pos, lead_id, kind, status, open_token, sent_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (m, idx) => [String(m.id), idx, String(m.leadId || ''), String(m.kind || 'initial'), String(m.status || ''), String(m.openToken || ''), String(m.sentAt || ''), JSON.stringify(m)]
      );

      syncCollection(
        'email_events',
        (state.emailEvents || []).slice(0, 10000),
        'INSERT INTO email_events (id, pos, lead_id, message_id, type, occurred_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (e, idx) => [String(e.id), idx, String(e.leadId || ''), String(e.messageId || ''), String(e.type || ''), String(e.occurredAt || ''), JSON.stringify(e)]
      );

      syncCollection(
        'suppressed_emails',
        (state.suppressedEmailHashes || []).slice(-50000),
        'INSERT INTO suppressed_emails (hash, pos, created_at) VALUES (?, ?, ?)',
        (hash, idx) => [String(hash), idx, new Date().toISOString()]
      );

      syncCollection(
        'merge_reviews',
        (state.mergeReviews || []).slice(0, 5000),
        'INSERT INTO merge_reviews (id, pos, status, record_id, match_id, created_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (r, idx) => [String(r.id), idx, String(r.status || 'open'), String(r.recordId || ''), String(r.matchId || ''), String(r.createdAt || ''), JSON.stringify(r)]
      );

      syncCollection('people', (state.people || []).slice(0, 20000), 'INSERT INTO people (id, pos, lead_id, partner_id, role, data_json) VALUES (?, ?, ?, ?, ?, ?)',
        (r, idx) => [String(r.id), idx, String(r.leadId || ''), String(r.partnerId || ''), String(r.role || 'other'), JSON.stringify(r)]);
      syncCollection('touches', (state.touches || []).slice(0, 50000), 'INSERT INTO touches (id, pos, lead_id, partner_id, kind, at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (r, idx) => [String(r.id), idx, String(r.leadId || ''), String(r.partnerId || ''), String(r.kind || 'note'), String(r.at || ''), JSON.stringify(r)]);
      syncCollection('pledges', (state.pledges || []).slice(0, 20000), 'INSERT INTO pledges (id, pos, partner_id, lead_id, status, amount, due_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (r, idx) => [String(r.id), idx, String(r.partnerId || ''), String(r.leadId || ''), String(r.status || 'pledged'), Number(r.amount || 0), String(r.dueAt || ''), JSON.stringify(r)]);
      syncCollection('stewardship_tasks', (state.stewardshipTasks || []).slice(0, 50000), 'INSERT INTO stewardship_tasks (id, pos, partner_id, cadence_key, status, due_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (r, idx) => [String(r.id), idx, String(r.partnerId || ''), String(r.cadenceKey || ''), String(r.status || 'open'), String(r.dueAt || ''), JSON.stringify(r)]);

      syncCollection(
        'activities',
        (state.activities || []).slice(0, 120),
        'INSERT INTO activities (id, pos, type, created_at, data_json) VALUES (?, ?, ?, ?, ?)',
        (a, idx) => [String(a.id), idx, String(a.type || 'update'), String(a.createdAt || ''), JSON.stringify(a)]
      );

      setMetaStmt.run('initialized', 'true');
      setMetaStmt.run('updated_at', new Date().toISOString());
      conn.exec('COMMIT');
    } catch (err) {
      try { conn.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }

  function loadCollection(table) {
    const rows = conn.prepare(`SELECT data_json FROM ${table} ORDER BY pos ASC`).all();
    return rows.map(r => JSON.parse(r.data_json));
  }

  function loadState() {
    const initialized = getMetaStmt.get('initialized');
    if (!initialized) {
      let initial;
      if (fs.existsSync(legacyJsonPath)) {
        try {
          const legacy = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
          initial = {
            version: 2,
            projects: Array.isArray(legacy.projects) && legacy.projects.length ? legacy.projects : seededProjects(),
            leads: Array.isArray(legacy.leads) ? legacy.leads : [],
            candidates: Array.isArray(legacy.candidates) ? legacy.candidates : seededDb().candidates,
            partners: Array.isArray(legacy.partners) ? legacy.partners : [],
            messages: Array.isArray(legacy.messages) ? legacy.messages : [],
            emailEvents: Array.isArray(legacy.emailEvents) ? legacy.emailEvents : [],
            suppressedEmailHashes: Array.isArray(legacy.suppressedEmailHashes) ? legacy.suppressedEmailHashes : [],
            bookings: Array.isArray(legacy.bookings) ? legacy.bookings : [],
            activities: Array.isArray(legacy.activities) ? legacy.activities : []
          };
          for (const lead of initial.leads) {
            if (lead.emailStatus === 'Sent (demo)') { lead.followUpAt = null; lead.followUpStep = 0; }
          }
          persistState(initial);
          try { fs.renameSync(legacyJsonPath, `${legacyJsonPath}.migrated`); } catch {}
          return initial;
        } catch (err) {
          console.error('Could not migrate legacy data/db.json; seeding fresh SQLite database:', err.message);
        }
      }
      initial = seededDb();
      persistState(initial);
      return initial;
    }

    const db = {
      version: 2,
      projects: loadCollection('projects'),
      leads: loadCollection('leads'),
      candidates: loadCollection('candidates'),
      partners: loadCollection('partners'),
      bookings: loadCollection('bookings'),
      messages: loadCollection('messages'),
      emailEvents: loadCollection('email_events'),
      suppressedEmailHashes: conn.prepare('SELECT hash FROM suppressed_emails ORDER BY pos ASC').all().map(r => r.hash),
      activities: loadCollection('activities'),
      mergeReviews: loadCollection('merge_reviews'),
      people: loadCollection('people'),
      touches: loadCollection('touches'),
      pledges: loadCollection('pledges'),
      stewardshipTasks: loadCollection('stewardship_tasks')
    };
    if (!db.projects.length) {
      db.projects = seededProjects();
      persistState(db);
    }
    for (const lead of db.leads) {
      if (lead.emailStatus === 'Sent (demo)') { lead.followUpAt = null; lead.followUpStep = 0; }
    }
    return db;
  }

  // Persistent SQLite sessions (survive container & process restarts)
  const insertSessionStmt = conn.prepare(`
    INSERT INTO sessions (token, username, user_id, display_name, role, csrf_token, demo_access, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at, role = excluded.role, display_name = excluded.display_name
  `);
  const getSessionStmt = conn.prepare('SELECT * FROM sessions WHERE token = ?');
  const deleteSessionStmt = conn.prepare('DELETE FROM sessions WHERE token = ?');
  const pruneSessionsStmt = conn.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  function putSession(token, session) {
    pruneSessionsStmt.run(Date.now());
    insertSessionStmt.run(
      String(token),
      String(session.username || ''),
      String(session.userId || ''),
      String(session.displayName || session.username || ''),
      String(session.role || 'admin'),
      String(session.csrfToken || ''),
      session.demoAccess ? 1 : 0,
      Number(session.createdAt || Date.now()),
      Number(session.expiresAt)
    );
  }

  function getSession(token) {
    if (!token) return null;
    const row = getSessionStmt.get(String(token));
    if (!row) return null;
    if (Number(row.expires_at) <= Date.now()) {
      deleteSessionStmt.run(String(token));
      return null;
    }
    return {
      token: row.token,
      username: row.username,
      userId: row.user_id || '',
      displayName: row.display_name || row.username,
      role: row.role || 'admin',
      csrfToken: row.csrf_token,
      demoAccess: Boolean(row.demo_access),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at)
    };
  }

  function deleteSession(token) {
    if (token) deleteSessionStmt.run(String(token));
  }

  function deleteSessionsForUser(username) {
    conn.prepare('DELETE FROM sessions WHERE username = ?').run(String(username || '').toLowerCase());
  }

  // Persistent proxy-safe login rate limits (keyed by username + client IP)
  const getFailureStmt = conn.prepare('SELECT count, reset_at FROM login_failures WHERE key = ?');
  const putFailureStmt = conn.prepare('INSERT INTO login_failures (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at');
  const delFailureStmt = conn.prepare('DELETE FROM login_failures WHERE key = ?');
  const pruneFailuresStmt = conn.prepare('DELETE FROM login_failures WHERE reset_at <= ?');

  function getLoginFailure(key) {
    pruneFailuresStmt.run(Date.now());
    const row = getFailureStmt.get(String(key));
    if (!row) return null;
    return { count: Number(row.count), resetAt: Number(row.reset_at) };
  }

  function recordLoginFailure(key, windowMs = 15 * 60 * 1000) {
    const existing = getLoginFailure(key);
    const now = Date.now();
    const next = existing && existing.resetAt > now
      ? { count: existing.count + 1, resetAt: existing.resetAt }
      : { count: 1, resetAt: now + windowMs };
    putFailureStmt.run(String(key), next.count, next.resetAt);
    return next;
  }

  function clearLoginFailure(key) {
    delFailureStmt.run(String(key));
  }

  const db = loadState();

  function saveDb() {
    persistState(db);
  }

  function clearDemoRecords() {
    const isDemoRecord = item => Boolean(item?.isDemo || /\s·\s*Demo$/i.test(String(item?.company || item?.organization || '')) || /^example\.com$/i.test(String(item?.email || '').split('@')[1] || ''));
    const demoLeadIds = new Set(db.leads.filter(isDemoRecord).map(l => l.id));
    const removedLeads = demoLeadIds.size;
    const removedCandidates = db.candidates.filter(isDemoRecord).length;
    const removedPartners = db.partners.filter(p => isDemoRecord(p) || (p.leadId && demoLeadIds.has(p.leadId))).length;
    const demoPartnerIds = new Set(db.partners.filter(p => isDemoRecord(p) || (p.leadId && demoLeadIds.has(p.leadId))).map(p => p.id));
    const relDemo = r => demoLeadIds.has(r.leadId) || demoPartnerIds.has(r.partnerId);
    for (const key of ['people', 'touches', 'pledges', 'stewardshipTasks']) db[key] = (db[key] || []).filter(r => !relDemo(r));
    const removedBookings = db.bookings.filter(b => isDemoRecord(b) || (b.leadId && demoLeadIds.has(b.leadId))).length;

    db.leads = db.leads.filter(l => !demoLeadIds.has(l.id));
    db.candidates = db.candidates.filter(c => !isDemoRecord(c));
    db.partners = db.partners.filter(p => !isDemoRecord(p) && !(p.leadId && demoLeadIds.has(p.leadId)));
    db.bookings = db.bookings.filter(b => !isDemoRecord(b) && !(b.leadId && demoLeadIds.has(b.leadId)));
    db.messages = db.messages.filter(m => !demoLeadIds.has(m.leadId));
    db.emailEvents = db.emailEvents.filter(e => !demoLeadIds.has(e.leadId));
    db.activities = db.activities.filter(a => !a.isDemo && !/\s·\s*Demo\b/i.test(String(a.text || '')));
    saveDb();
    return { removedLeads, removedCandidates, removedPartners, removedBookings, retainedProjects: db.projects.length };
  }

  function close() {
    try { conn.close(); } catch {}
  }

  return {
    db,
    conn,
    sqlitePath,
    saveDb,
    clearDemoRecords,
    putSession,
    getSession,
    deleteSession,
    deleteSessionsForUser,
    getLoginFailure,
    recordLoginFailure,
    clearLoginFailure,
    close
  };
};
