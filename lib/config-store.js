const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_ROLES = new Set(['admin', 'reviewer', 'owner']);
const VALID_PLATFORMS = new Set(['google_meet', 'microsoft_teams', 'zoom']);

module.exports = function createConfigStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dataDir, 0o700); } catch {}

  const settingsPath = path.join(dataDir, 'settings.json');
  const authPath = path.join(dataDir, 'auth.json');
  const auditPath = path.join(dataDir, 'audit.jsonl');
  const keyPath = path.join(dataDir, '.settings-key');

  const defaultSettings = {
    ai: { apiKey: null, model: '', endpoint: '' },
    search: { provider: 'none', apiKey: null }, // 'none' | 'tavily' | 'serper' | 'bing'
    smtp: { host: '', port: 587, secure: false, username: '', password: null, fromName: 'Chelo Partnerships Team', fromEmail: '' },
    tracking: { openTrackingEnabled: false, publicBaseUrl: '' },
    sendPolicy: {},
    governance: { approvalPolicy: 'single', outreachStyle: 'ladder', guardrail: 'block' }, // approvalPolicy 'single'|'four-eyes'; outreachStyle 'ladder'|'classic'; guardrail 'block'|'warn'
    briefings: {
      defaultPlatform: 'google_meet',
      googleMeetUrl: '',
      microsoftTeamsUrl: '',
      zoomUrl: '',
      autoSendCalendarInvite: true
    },
    inbound: {
      webhookSecret: null,
      imapHost: '',
      imapPort: 993,
      imapUsername: '',
      imapPassword: null
    }
  };

  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return structuredClone(fallback); }
  }
  function atomicJson(file, value) {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch {}
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }

  let masterKey;
  if (process.env.SETTINGS_ENCRYPTION_KEY) {
    masterKey = crypto.createHash('sha256').update(process.env.SETTINGS_ENCRYPTION_KEY, 'utf8').digest();
  } else {
    try {
      masterKey = fs.readFileSync(keyPath);
      if (masterKey.length !== 32) throw new Error('Invalid local settings encryption key.');
    } catch {
      masterKey = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, masterKey, { mode: 0o600, flag: 'w' });
      try { fs.chmodSync(keyPath, 0o600); } catch {}
    }
  }

  function encryptSecret(value) {
    const plain = String(value || '');
    if (!plain) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
  }

  function decryptSecret(record) {
    if (!record) return '';
    if (record.version !== 1) throw new Error('Unsupported encrypted-settings version.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
  }

  let settings = readJson(settingsPath, defaultSettings);
  settings = {
    ai: { ...defaultSettings.ai, ...(settings.ai || {}) },
    search: { ...defaultSettings.search, ...(settings.search || {}) },
    smtp: { ...defaultSettings.smtp, ...(settings.smtp || {}) },
    tracking: { ...defaultSettings.tracking, ...(settings.tracking || {}) },
    sendPolicy: { ...(settings.sendPolicy || {}) },
    governance: { ...defaultSettings.governance, ...(settings.governance || {}) },
    briefings: { ...defaultSettings.briefings, ...(settings.briefings || {}) },
    inbound: { ...defaultSettings.inbound, ...(settings.inbound || {}) }
  };
  if (!settings.inbound.webhookSecret) {
    settings.inbound.webhookSecret = encryptSecret(crypto.randomBytes(24).toString('hex'));
  }

  let auth = readJson(authPath, { admin: null, users: [] });
  if (!auth || typeof auth !== 'object') auth = { admin: null, users: [] };
  if (!Array.isArray(auth.users)) auth.users = [];
  if (auth.admin && typeof auth.admin === 'object' && auth.admin.username && auth.admin.passwordHash && auth.admin.salt) {
    const exists = auth.users.some(u => String(u.username || '').toLowerCase() === String(auth.admin.username).toLowerCase());
    if (!exists) {
      const localPart = String(auth.admin.username).split('@')[0] || 'Admin';
      auth.users.unshift({
        id: auth.admin.id || `user_${crypto.randomBytes(6).toString('hex')}`,
        username: String(auth.admin.username).toLowerCase(),
        displayName: auth.admin.displayName || localPart.charAt(0).toUpperCase() + localPart.slice(1),
        role: 'admin',
        salt: auth.admin.salt,
        passwordHash: auth.admin.passwordHash,
        active: true,
        createdAt: auth.admin.createdAt || new Date().toISOString()
      });
    }
  } else {
    auth.admin = auth.users.find(u => u.role === 'admin' && u.active !== false) || null;
  }

  atomicJson(settingsPath, settings);
  atomicJson(authPath, auth);

  function hashSuppressionAddress(value) {
    return crypto.createHmac('sha256', masterKey).update(`chelo-suppression-v1\0${String(value || '').trim().toLowerCase()}`, 'utf8').digest('hex');
  }

  function computeApprovalDigest(payload = {}) {
    const canonical = JSON.stringify({
      to: String(payload.to || '').trim().toLowerCase(),
      kind: payload.kind === 'follow-up' ? 'follow-up' : 'initial',
      subject: String(payload.subject || '').trim(),
      body: String(payload.body || '').trim(),
      attachProposal: Boolean(payload.attachProposal),
      pdfSha256: String(payload.pdfSha256 || ''),
      project: String(payload.project || '').trim(),
      amount: Number(payload.amount || 0)
    });
    return crypto.createHmac('sha256', masterKey).update(`chelo-approval-v1\0${canonical}`, 'utf8').digest('hex');
  }

  function verifyApprovalDigest(expectedHex, payload = {}) {
    if (!expectedHex) return false;
    const actualHex = computeApprovalDigest(payload);
    const a = Buffer.from(String(expectedHex), 'utf8');
    const b = Buffer.from(actualHex, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function validateHttpsMeetingUrl(raw, label) {
    const value = String(raw || '').trim().slice(0, 500);
    if (!value) return '';
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`Enter a valid HTTPS URL for ${label}.`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error(`${label} must use HTTPS without embedded credentials.`);
    }
    return parsed.href;
  }

  function saveSettings(input = {}) {
    const body = input && typeof input === 'object' ? input : {};
    const ai = { ...settings.ai };
    const smtp = { ...settings.smtp };
    const tracking = { ...settings.tracking };
    const governance = { ...settings.governance };
    const briefings = { ...settings.briefings };
    const inbound = { ...settings.inbound };
    const search = { ...(settings.search || { provider: 'none', apiKey: null }) };

    if (body.searchProvider !== undefined) {
      const provider = String(body.searchProvider || 'none').trim().toLowerCase();
      if (!['none', 'tavily', 'serper', 'bing'].includes(provider)) throw new Error('Search provider must be none, tavily, serper or bing.');
      search.provider = provider;
    }
    if (body.searchApiKey !== undefined && String(body.searchApiKey).trim()) search.apiKey = encryptSecret(String(body.searchApiKey).trim());
    if (body.clearSearchKey === true) search.apiKey = null;

    if (body.aiEndpoint !== undefined) {
      const endpoint = String(body.aiEndpoint || '').trim().slice(0, 500);
      if (endpoint) {
        let parsed;
        try { parsed = new URL(endpoint); } catch { throw new Error('Enter a valid AI chat-completions URL.'); }
        const localHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || (parsed.protocol === 'http:' && !localHost)) {
          throw new Error('AI endpoints must use HTTPS, except for loopback testing.');
        }
      }
      ai.endpoint = endpoint;
    }
    if (body.aiModel !== undefined) ai.model = String(body.aiModel || '').trim().slice(0, 100);
    if (body.aiApiKey !== undefined && String(body.aiApiKey).trim()) ai.apiKey = encryptSecret(String(body.aiApiKey).trim());
    if (body.clearAiKey === true) ai.apiKey = null;

    if (body.smtpHost !== undefined) smtp.host = String(body.smtpHost || '').trim().slice(0, 253);
    if (body.smtpPort !== undefined) {
      const port = Number(body.smtpPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP port must be a number between 1 and 65535.');
      smtp.port = port;
    }
    if (body.smtpSecure !== undefined) smtp.secure = Boolean(body.smtpSecure);
    if (body.smtpUsername !== undefined) smtp.username = String(body.smtpUsername || '').trim().slice(0, 250);
    if (body.smtpPassword !== undefined && String(body.smtpPassword)) smtp.password = encryptSecret(String(body.smtpPassword));
    if (body.clearSmtpPassword === true) smtp.password = null;
    if (body.smtpFromName !== undefined) smtp.fromName = String(body.smtpFromName || '').trim().slice(0, 160);
    if (body.smtpFromEmail !== undefined) {
      const email = String(body.smtpFromEmail || '').trim().slice(0, 254);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid sender email address.');
      smtp.fromEmail = email;
    }

    if (body.openTrackingEnabled !== undefined) tracking.openTrackingEnabled = Boolean(body.openTrackingEnabled);
    if (body.publicBaseUrl !== undefined) {
      const value = String(body.publicBaseUrl || '').trim().replace(/\/$/, '');
      if (value) {
        let url;
        try { url = new URL(value); } catch { throw new Error('Public app URL must be a valid HTTP or HTTPS URL.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
          throw new Error('Public app URL must be an HTTP or HTTPS origin without credentials, path, query or fragment.');
        }
        tracking.publicBaseUrl = value;
      } else tracking.publicBaseUrl = '';
    }

    if (body.approvalPolicy !== undefined) {
      const policy = String(body.approvalPolicy || '').trim();
      if (!['single', 'four-eyes'].includes(policy)) throw new Error('Approval policy must be single or four-eyes.');
      governance.approvalPolicy = policy;
    }
    if (body.outreachStyle !== undefined) {
      const style = String(body.outreachStyle || '').trim();
      if (!['ladder', 'classic'].includes(style)) throw new Error('Outreach style must be ladder or classic.');
      governance.outreachStyle = style;
    }
    if (body.guardrail !== undefined) {
      const mode = String(body.guardrail || '').trim();
      if (!['block', 'warn'].includes(mode)) throw new Error('Guardrail must be block or warn.');
      governance.guardrail = mode;
    }

    if (body.defaultPlatform !== undefined) {
      const plat = String(body.defaultPlatform || '').trim();
      if (!VALID_PLATFORMS.has(plat)) throw new Error('Select Google Meet, Microsoft Teams or Zoom.');
      briefings.defaultPlatform = plat;
    }
    if (body.googleMeetUrl !== undefined) briefings.googleMeetUrl = validateHttpsMeetingUrl(body.googleMeetUrl, 'Google Meet link');
    if (body.microsoftTeamsUrl !== undefined) briefings.microsoftTeamsUrl = validateHttpsMeetingUrl(body.microsoftTeamsUrl, 'Microsoft Teams link');
    if (body.zoomUrl !== undefined) briefings.zoomUrl = validateHttpsMeetingUrl(body.zoomUrl, 'Zoom link');
    if (body.autoSendCalendarInvite !== undefined) briefings.autoSendCalendarInvite = Boolean(body.autoSendCalendarInvite);

    if (body.rotateInboundSecret === true) {
      inbound.webhookSecret = encryptSecret(crypto.randomBytes(24).toString('hex'));
    } else if (body.inboundWebhookSecret !== undefined && String(body.inboundWebhookSecret).trim()) {
      inbound.webhookSecret = encryptSecret(String(body.inboundWebhookSecret).trim());
    }
    if (body.imapHost !== undefined) inbound.imapHost = String(body.imapHost || '').trim().slice(0, 253);
    if (body.imapPort !== undefined && String(body.imapPort).trim() !== '') {
      const iPort = Number(body.imapPort);
      if (!Number.isInteger(iPort) || iPort < 1 || iPort > 65535) throw new Error('IMAP port must be between 1 and 65535.');
      inbound.imapPort = iPort;
    }
    if (body.imapUsername !== undefined) inbound.imapUsername = String(body.imapUsername || '').trim().slice(0, 250);
    if (body.imapPassword !== undefined && String(body.imapPassword)) inbound.imapPassword = encryptSecret(String(body.imapPassword));
    if (body.clearImapPassword === true) inbound.imapPassword = null;

    settings = { ai, search, smtp, tracking, governance, briefings, inbound, sendPolicy: settings.sendPolicy || {} };
    atomicJson(settingsPath, settings);
    return publicSettings();
  }

  function getSearchConfig() {
    const stored = settings.search || { provider: 'none', apiKey: null };
    const storedKey = decryptSecret(stored.apiKey);
    const envProvider = String(process.env.SEARCH_PROVIDER || '').trim().toLowerCase();
    const provider = ['tavily', 'serper', 'bing'].includes(envProvider) ? envProvider : (stored.provider || 'none');
    const apiKey = String(process.env.SEARCH_API_KEY || storedKey || '').trim();
    const endpoint = process.env.NODE_ENV !== 'production' ? String(process.env.SEARCH_ENDPOINT || '').trim() : '';
    return { provider, apiKey, endpoint, keySource: process.env.SEARCH_API_KEY ? 'environment' : storedKey ? 'settings' : '' };
  }

  function getAIConfig() {
    const storedKey = decryptSecret(settings.ai.apiKey);
    const apiKey = String(process.env.OPENAI_API_KEY || storedKey || '').trim();
    return {
      apiKey,
      model: String(process.env.OPENAI_MODEL || settings.ai.model || 'gpt-4o-mini').trim(),
      endpoint: String(process.env.OPENAI_BASE_URL || settings.ai.endpoint || 'https://api.openai.com/v1/chat/completions').trim(),
      keySource: process.env.OPENAI_API_KEY ? 'environment' : storedKey ? 'settings' : ''
    };
  }

  function getSendPolicy() { return { ...(settings.sendPolicy || {}) }; }
  function saveSendPolicy(policy) { settings.sendPolicy = JSON.parse(JSON.stringify(policy || {})); atomicJson(settingsPath, settings); return getSendPolicy(); }

  function getSmtpConfig() {
    const storedPassword = decryptSecret(settings.smtp.password);
    const port = Number(process.env.SMTP_PORT || settings.smtp.port || 587);
    const secureFromEnv = process.env.SMTP_SECURE;
    const secure = secureFromEnv !== undefined
      ? /^(1|true|yes)$/i.test(secureFromEnv)
      : (settings.smtp.secure !== undefined ? Boolean(settings.smtp.secure) : port === 465);
    return {
      host: String(process.env.SMTP_HOST || settings.smtp.host || '').trim(),
      port,
      secure,
      username: String(process.env.SMTP_USER || settings.smtp.username || '').trim(),
      password: String(process.env.SMTP_PASSWORD || storedPassword || ''),
      fromName: String(process.env.SMTP_FROM_NAME || settings.smtp.fromName || 'Chelo Partnerships Team').trim(),
      fromEmail: String(process.env.SMTP_FROM_EMAIL || settings.smtp.fromEmail || '').trim(),
      source: process.env.SMTP_HOST ? 'environment' : settings.smtp.host ? 'settings' : ''
    };
  }

  function getInboundConfig() {
    return {
      webhookSecret: decryptSecret(settings.inbound.webhookSecret),
      imapHost: String(settings.inbound.imapHost || '').trim(),
      imapPort: Number(settings.inbound.imapPort || 993),
      imapUsername: String(settings.inbound.imapUsername || '').trim(),
      imapPassword: decryptSecret(settings.inbound.imapPassword)
    };
  }

  function getBriefingsConfig() {
    return { ...defaultSettings.briefings, ...(settings.briefings || {}) };
  }

  function getGovernanceConfig() {
    return { ...defaultSettings.governance, ...(settings.governance || {}) };
  }

  function getPublicBaseUrl(fallbackOrigin = '') {
    const value = String(process.env.PUBLIC_BASE_URL || settings.tracking.publicBaseUrl || fallbackOrigin || '').trim().replace(/\/$/, '');
    if (!value) return '';
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return value;
    } catch { return ''; }
  }

  const GOVERNANCE_KEYS = new Set(['approvalPolicy', 'outreachStyle', 'guardrail', 'defaultPlatform', 'googleMeetUrl', 'microsoftTeamsUrl', 'zoomUrl', 'autoSendCalendarInvite']);
  const TECHNICAL_SETTING_FIELDS = new Set(['searchProvider', 'searchKeySource', 'aiModel', 'aiEndpoint', 'aiKeySource', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUsername', 'smtpFromName', 'smtpFromEmail', 'smtpPasswordConfigured', 'smtpSource', 'openTrackingEnabled', 'publicBaseUrl', 'openTrackingReady', 'inboundWebhookReady', 'imapConfigured', 'imapHost', 'imapPort', 'imapUsername']);
  function governanceOnly(body) { const out = {}; for (const k of Object.keys(body || {})) if (GOVERNANCE_KEYS.has(k)) out[k] = body[k]; return out; }
  function publicSettings({ technical = true } = {}) {
    const full = publicSettingsFull();
    if (technical) return full;
    const out = {}; for (const [k, v] of Object.entries(full)) if (!TECHNICAL_SETTING_FIELDS.has(k)) out[k] = v;
    out.technicalHidden = true;
    return out;
  }
  function publicSettingsFull() {
    const ai = getAIConfig();
    const smtp = getSmtpConfig();
    const inbound = getInboundConfig();
    const briefings = getBriefingsConfig();
    const governance = getGovernanceConfig();
    const publicBaseUrl = getPublicBaseUrl();
    const search = getSearchConfig();
    return {
      searchProvider: search.provider,
      searchConfigured: Boolean(search.apiKey && search.provider !== 'none'),
      searchKeySource: search.keySource,
      aiConfigured: Boolean(ai.apiKey),
      aiModel: ai.model,
      aiEndpoint: ai.endpoint,
      aiKeySource: ai.keySource,
      smtpConfigured: Boolean(smtp.host && smtp.fromEmail),
      smtpHost: smtp.host,
      smtpPort: smtp.port,
      smtpSecure: smtp.secure,
      smtpUsername: smtp.username,
      smtpFromName: smtp.fromName,
      smtpFromEmail: smtp.fromEmail,
      smtpPasswordConfigured: Boolean(smtp.password),
      smtpSource: smtp.source,
      openTrackingEnabled: Boolean(settings.tracking.openTrackingEnabled),
      publicBaseUrl,
      openTrackingReady: Boolean(settings.tracking.openTrackingEnabled && publicBaseUrl.startsWith('https://')),
      approvalPolicy: governance.approvalPolicy,
      outreachStyle: governance.outreachStyle || 'ladder',
      guardrail: governance.guardrail || 'block',
      defaultPlatform: briefings.defaultPlatform,
      googleMeetUrl: briefings.googleMeetUrl,
      microsoftTeamsUrl: briefings.microsoftTeamsUrl,
      zoomUrl: briefings.zoomUrl,
      autoSendCalendarInvite: Boolean(briefings.autoSendCalendarInvite),
      inboundWebhookReady: Boolean(inbound.webhookSecret),
      imapConfigured: Boolean(inbound.imapHost && inbound.imapUsername && inbound.imapPassword),
      imapHost: inbound.imapHost,
      imapPort: inbound.imapPort,
      imapUsername: inbound.imapUsername
    };
  }

  function syncPrimaryAdmin() {
    auth.admin = auth.users.find(u => u.role === 'admin' && u.active !== false) || auth.users[0] || null;
    atomicJson(authPath, auth);
  }

  function hasAdmin() {
    return Boolean((auth.users && auth.users.some(u => u.role === 'admin' && u.active !== false)) || (auth.admin && auth.admin.username && auth.admin.passwordHash && auth.admin.salt));
  }

  function getAdmin() {
    const primary = auth.users.find(u => u.role === 'admin' && u.active !== false) || auth.admin;
    return primary ? { ...primary } : null;
  }

  function saveAdmin(admin) {
    if (!admin) {
      auth = { admin: null, users: [] };
      atomicJson(authPath, auth);
      return;
    }
    const username = String(admin.username || '').trim().toLowerCase();
    const localPart = username.split('@')[0] || 'Admin';
    const userRecord = {
      id: admin.id || `user_${crypto.randomBytes(6).toString('hex')}`,
      username,
      displayName: String(admin.displayName || localPart.charAt(0).toUpperCase() + localPart.slice(1)).trim(),
      role: 'admin',
      salt: admin.salt,
      passwordHash: admin.passwordHash,
      active: true,
      createdAt: admin.createdAt || new Date().toISOString()
    };
    const idx = auth.users.findIndex(u => u.username === username);
    if (idx >= 0) auth.users[idx] = userRecord;
    else auth.users.unshift(userRecord);
    syncPrimaryAdmin();
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role || 'owner',
      active: user.active !== false,
      isRoot: Boolean(user.isRoot),
      createdAt: user.createdAt || null
    };
  }

  // Root account: the founding administrator. Exactly one; cannot be demoted, deactivated, renamed or reset by anyone else.
  function ensureRoot() {
    const users = auth.users || [];
    const roots = users.filter(u => u.isRoot);
    if (roots.length === 1) return roots[0];
    for (const u of users) delete u.isRoot;
    const candidates = users.filter(u => u.role === 'admin').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const root = candidates.find(u => u.active !== false) || candidates[0] || null;
    if (root) { root.isRoot = true; root.active = true; atomicJson(authPath, auth); }
    return root;
  }
  function getRootUser() { const r = ensureRoot(); return r ? publicUser(r) : null; }
  function isRootUser(userId) { const r = ensureRoot(); return Boolean(r && userId && r.id === userId); }

  function listUsers() {
    return (auth.users || []).map(publicUser);
  }

  function findUserByEmail(email) {
    const clean = String(email || '').trim().toLowerCase();
    return (auth.users || []).find(u => u.username === clean) || null;
  }

  function findUserById(userId) {
    return (auth.users || []).find(u => u.id === userId) || null;
  }

  function createUser({ username, displayName, role = 'owner', password }) {
    const cleanEmail = String(username || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Enter a valid staff work email address.');
    if (!VALID_ROLES.has(role)) throw new Error('Role must be admin, reviewer or owner.');
    const pwd = String(password || '');
    if (pwd.length < 12 || pwd.length > 200) throw new Error('Choose a password with at least 12 characters.');
    if (findUserByEmail(cleanEmail)) throw new Error('A staff account with this email already exists.');
    const salt = crypto.randomBytes(16);
    const passwordHash = crypto.scryptSync(pwd, salt, 64).toString('hex');
    const fallbackName = cleanEmail.split('@')[0] || 'Staff';
    const user = {
      id: `user_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      username: cleanEmail,
      displayName: String(displayName || fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1)).trim().slice(0, 80),
      role,
      salt: salt.toString('hex'),
      passwordHash,
      active: true,
      createdAt: new Date().toISOString()
    };
    auth.users.push(user);
    syncPrimaryAdmin();
    ensureRoot();
    return publicUser(user);
  }

  function updateUser(userId, patch = {}, { actorId = null } = {}) {
    const user = findUserById(userId);
    if (!user) throw new Error('Staff account not found.');
    ensureRoot();
    if (user.isRoot) {
      const self = actorId && actorId === user.id;
      if (patch.role !== undefined && patch.role !== 'admin') throw new Error('The root account is always an administrator and cannot be demoted.');
      if (patch.active !== undefined && !patch.active) throw new Error('The root account cannot be deactivated.');
      if (patch.displayName !== undefined && !self) throw new Error('Only the root account can rename itself.');
      if (patch.password !== undefined && !self) throw new Error('Only the root account can change its own password.');
    }
    if (patch.displayName !== undefined) {
      const dn = String(patch.displayName || '').trim().slice(0, 80);
      if (!dn) throw new Error('Display name cannot be empty.');
      user.displayName = dn;
    }
    if (patch.role !== undefined) {
      if (!VALID_ROLES.has(patch.role)) throw new Error('Role must be admin, reviewer or owner.');
      if (user.role === 'admin' && patch.role !== 'admin') {
        const otherAdmins = auth.users.filter(u => u.id !== user.id && u.role === 'admin' && u.active !== false);
        if (!otherAdmins.length) throw new Error('Keep at least one active administrator in the workspace.');
      }
      user.role = patch.role;
    }
    if (patch.active !== undefined) {
      const nextActive = Boolean(patch.active);
      if (!nextActive && user.role === 'admin') {
        const otherAdmins = auth.users.filter(u => u.id !== user.id && u.role === 'admin' && u.active !== false);
        if (!otherAdmins.length) throw new Error('Cannot deactivate the last active administrator.');
      }
      user.active = nextActive;
    }
    if (patch.password !== undefined && String(patch.password)) {
      const pwd = String(patch.password);
      if (pwd.length < 12 || pwd.length > 200) throw new Error('New password must have at least 12 characters.');
      const salt = crypto.randomBytes(16);
      user.salt = salt.toString('hex');
      user.passwordHash = crypto.scryptSync(pwd, salt, 64).toString('hex');
    }
    user.updatedAt = new Date().toISOString();
    syncPrimaryAdmin();
    return publicUser(user);
  }

  function authenticateUser(username, password) {
    const cleanEmail = String(username || '').trim().toLowerCase();
    const pwd = String(password || '');
    const candidate = findUserByEmail(cleanEmail) || (auth.admin && auth.admin.username === cleanEmail ? auth.admin : null);
    const salt = candidate ? Buffer.from(candidate.salt, 'hex') : Buffer.alloc(16, 0x37);
    const expected = candidate ? Buffer.from(candidate.passwordHash, 'hex') : Buffer.alloc(64, 0x6b);
    const actual = crypto.scryptSync(pwd, salt, 64);
    const matches = Boolean(
      candidate
      && candidate.active !== false
      && candidate.username === cleanEmail
      && expected.length === actual.length
      && crypto.timingSafeEqual(expected, actual)
    );
    return matches ? publicUser(candidate) : null;
  }

  function computeAuditEntryHash(entry, prevHash) {
    const payload = [
      String(prevHash || 'GENESIS'),
      String(entry.id || ''),
      String(entry.timestamp || ''),
      String(entry.actor || ''),
      String(entry.action || ''),
      String(entry.entityType || ''),
      String(entry.entityId || ''),
      String(entry.summary || '')
    ].join('|');
    return crypto.createHmac('sha256', masterKey).update(`chelo-audit-chain-v1\0${payload}`, 'utf8').digest('hex');
  }

  function computeAnchorSignature(anchorHash) {
    return crypto.createHmac('sha256', masterKey).update(`chelo-audit-anchor-v1\0${anchorHash}`, 'utf8').digest('hex');
  }

  function readAuditRaw() {
    if (!fs.existsSync(auditPath)) return [];
    const items = [];
    for (const line of fs.readFileSync(auditPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try { items.push(JSON.parse(line)); } catch {}
    }
    return items;
  }

  let lastAuditPrune = 0;
  function pruneAudit() {
    if (!fs.existsSync(auditPath)) { lastAuditPrune = Date.now(); return; }
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const all = readAuditRaw();
    let prunedLastHash = null;
    const retained = [];
    for (const item of all) {
      if (Date.parse(item.timestamp) >= cutoff) {
        retained.push(item);
      } else if (item.hash) {
        prunedLastHash = item.hash;
      }
    }
    if (retained.length && prunedLastHash && retained[0].prevHash === prunedLastHash) {
      retained[0].anchorSig = computeAnchorSignature(prunedLastHash);
    }
    const serialized = retained.map(item => JSON.stringify(item));
    const temp = `${auditPath}.tmp`;
    fs.writeFileSync(temp, serialized.length ? `${serialized.join('\n')}\n` : '', { mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch {}
    fs.renameSync(temp, auditPath);
    lastAuditPrune = Date.now();
  }

  function lastChainHash() {
    const items = readAuditRaw();
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].hash) return items[i].hash;
    }
    return 'GENESIS';
  }

  function recordAudit({ actor = 'staff', action = 'updated', entityType = 'workspace', entityId = '', summary = '' } = {}) {
    if (Date.now() - lastAuditPrune > 24 * 60 * 60 * 1000) pruneAudit();
    const prevHash = lastChainHash();
    const entry = {
      id: `audit_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      actor: String(actor).slice(0, 120),
      action: String(action).slice(0, 120),
      entityType: String(entityType).slice(0, 80),
      entityId: String(entityId).slice(0, 160),
      summary: String(summary).replace(/[\r\n]+/g, ' ').slice(0, 300),
      prevHash
    };
    entry.hash = computeAuditEntryHash(entry, prevHash);
    try {
      fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      fs.chmodSync(auditPath, 0o600);
    } catch (err) {
      console.error('Could not append audit entry:', err.message);
    }
    return entry;
  }

  function verifyAuditChain() {
    const items = readAuditRaw();
    let expectedPrev = 'GENESIS';
    let chainedEntries = 0;
    let legacyEntries = 0;
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item.hash) {
        legacyEntries += 1;
        continue;
      }
      if (idx === 0 && item.prevHash && item.prevHash !== 'GENESIS' && item.anchorSig) {
        const expectedAnchor = computeAnchorSignature(item.prevHash);
        const a = Buffer.from(String(item.anchorSig), 'utf8');
        const b = Buffer.from(expectedAnchor, 'utf8');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          expectedPrev = item.prevHash;
        }
      }
      const recomputed = computeAuditEntryHash(item, expectedPrev);
      const a = Buffer.from(String(item.hash), 'utf8');
      const b = Buffer.from(recomputed, 'utf8');
      if (item.prevHash !== expectedPrev || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return {
          valid: false,
          checkedEntries: items.length,
          chainedEntries,
          legacyEntries,
          headHash: items[items.length - 1]?.hash || null,
          brokenAtId: item.id || `line_${idx + 1}`
        };
      }
      expectedPrev = item.hash;
      chainedEntries += 1;
    }
    return {
      valid: true,
      checkedEntries: items.length,
      chainedEntries,
      legacyEntries,
      headHash: expectedPrev === 'GENESIS' ? null : expectedPrev,
      brokenAtId: null
    };
  }

  function getAuditLogs({ limit = 300, action = '', from = '', to = '', query = '' } = {}) {
    const max = Math.min(50000, Math.max(1, Number(limit) || 300));
    const start = from ? Date.parse(from) : -Infinity;
    const end = to ? Date.parse(to) + 24 * 60 * 60 * 1000 : Infinity;
    const actionQuery = String(action || '').toLowerCase();
    const textQuery = String(query || '').trim().toLowerCase();
    const rows = [];
    for (const item of readAuditRaw()) {
      if (Date.parse(item.timestamp) < start || Date.parse(item.timestamp) >= end) continue;
      if (actionQuery && !String(item.action).toLowerCase().includes(actionQuery)) continue;
      if (textQuery && ![item.actor, item.action, item.entityType, item.entityId, item.summary].join(' ').toLowerCase().includes(textQuery)) continue;
      rows.push(item);
    }
    return rows.slice(-max).reverse();
  }

  pruneAudit();

  return {
    encryptSecret,
    decryptSecret,
    hashSuppressionAddress,
    computeApprovalDigest,
    verifyApprovalDigest,
    saveSettings,
    getAIConfig,
    getSearchConfig,
    getSmtpConfig,
    getSendPolicy,
    saveSendPolicy,
    getInboundConfig,
    getBriefingsConfig,
    getGovernanceConfig,
    getPublicBaseUrl,
    publicSettings,
    governanceOnly,
    GOVERNANCE_KEYS,
    hasAdmin,
    getAdmin,
    saveAdmin,
    listUsers,
    ensureRoot,
    getRootUser,
    isRootUser,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    authenticateUser,
    recordAudit,
    getAuditLogs,
    verifyAuditChain
  };
};
