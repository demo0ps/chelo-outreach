'use strict';
// Rules-first reply classification. Five buckets, each with one action and one deadline.
// AI is deliberately NOT in this path: the rules are auditable and run on every inbound signal.
const CATEGORIES = {
  interested: { label: 'Interested', action: 'Reply personally and offer times', slaHours: 4 },
  'not-now': { label: 'Not now', action: 'Pause and resurface on the date given', slaHours: 24 },
  'wrong-person': { label: 'Wrong person', action: 'Capture the redirect and reroute', slaHours: 24 },
  'opt-out': { label: 'Opt-out', action: 'Suppress immediately, workspace-wide', slaHours: 1 },
  automatic: { label: 'Automatic', action: 'Ignore — not engagement', slaHours: null },
  unclassified: { label: 'Needs a human look', action: 'Read and categorise', slaHours: 8 }
};

const AUTO_HEADERS = /^(auto-submitted:\s*(?!no)|x-autoreply|x-autorespond|x-auto-response-suppress|precedence:\s*(bulk|junk|auto_reply|list))/im;
const AUTO_SUBJECT = /\b(out of (the )?office|automatic reply|auto(matic)?[- ]?(reply|response)|ooo\b|away from (my )?(email|office|desk)|on (annual |maternity |sick )?leave|delivery status notification|undeliverable|ticket #?\d+|case #?\d+|has been received|we have received your (email|message|enquiry)|thank you for contacting|your request \(#?\d+\))/i;
const AUTO_BODY = /\b(i am (currently )?(out of|away from) (the )?office|i('| a)m (currently )?on (annual |maternity |sick |parental )?leave|will (be )?(back|return(ing)?) (on|in) |limited access to (my )?email|this (is an|mailbox is an) (automated|automatic) (response|reply|message)|do not reply to this (email|message)|your (message|email) has been received|has been logged as|ticket (has been )?(created|opened))/i;
const OPT_OUT = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|do not (contact|email) (me|us)( again)?|opt[- ]?out|no further (emails?|contact|correspondence)|cease (all )?(contact|communication)|not interested[.!]? (please )?(stop|remove|unsubscribe)|popia|spam)\b/i;
const WRONG_PERSON = /\b(wrong person|not the (right|correct) (person|contact|department)|no longer (work|employed|with|at|responsible)|i('ve| have) (left|moved)|moved (on|to (a )?(new|different))|(please )?(contact|reach out to|speak to|direct (this|your (enquiry|request)) to|forward(ed|ing)? (this|your email) to|copy(ing)?|cc(’|')?(ing|d)?|loop(ing)? in)\s+(my colleague|our|the|[A-Z][a-z]+ [A-Z][a-z]+)|(is|would be) (the )?(right|better|correct) person|handles? (this|csi|our (csi|social investment|foundation|sponsorship))|redirect(ing|ed)? (you|this))\b/i;
const NOT_NOW = /\b(not (at this|right now|this (year|quarter|time)|a priority (right )?now)|budget(s)? (is|are|have been) (allocated|committed|spent|finalised|finalized|closed)|(circle|check|come|get) back (in|next|after|around|later)|next (financial|fiscal) year|revisit (this )?(in|next|later)|later (this|in the) year|after (our|the) (year[- ]end|financial year|agm|budget cycle)|timing (isn'?t|is not) (right|good)|(q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december) (next year|20\d\d)|in (a few|[2-9]|\d\d) (weeks|months)|put (this|it) on hold|park (this|it))\b/i;
const INTERESTED = /\b(interested|keen|happy to (chat|talk|meet|discuss|set up|connect)|let'?s (talk|meet|set something up|connect|schedule)|sounds? (good|great|interesting|promising)|tell me more|more (information|details|info)|send (me |us |over |through )?(the|a|your|more)? ?(proposal|deck|details|information|budget)|(can|could) (we|you) (set up|schedule|arrange|do) (a )?(call|meeting|time|chat)|available (on|next|this)|what (times?|dates?) (work|suit)|(book|schedule|arrange) (a )?(call|briefing|meeting)|i('d| would) (like|love) to|open to (a )?(conversation|call|chat|discussion)|please (share|send)|looking forward|yes[,.! ]|works for me|thursday|tuesday|wednesday|monday|friday)\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function extractRedirect(text) {
  const t = String(text || '');
  const patterns = [
    /(?:contact|reach out to|speak to|copy(?:ing)?|cc(?:’|')?(?:ing|d)?|loop(?:ing)? in|forward(?:ed|ing)? (?:this|it|your email) to|direct(?:ed|ing)? (?:this|you) to)\s+(?:my colleague\s+|our\s+)?([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})(?:[,\s(]+(?:who is |our |the )?([A-Za-z &/-]{3,60}?))?(?=[,.;)\n]|$)/,
    /([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})\s+(?:\(([^)]{3,60})\)\s+)?(?:is|would be|will be)\s+(?:the\s+)?(?:right|better|best|correct)\s+(?:person|contact)/,
    /([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})\s+(?:now\s+)?(?:handles|leads|runs|manages|looks after)\s+(?:this|our|the)\s+([A-Za-z &/-]{3,60}?)(?=[,.;)\n]|$)/
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && !/^(Kind|Best|Many|Warm|Thank|Thanks|Regards|Dear|Hello|Good)\b/.test(m[1])) return { name: m[1].trim(), title: (m[2] || '').trim().replace(/^who is\s+/i, '') };
  }
  return null;
}
function extractResumeHint(text, now = new Date()) {
  const t = String(text || '').toLowerCase();
  let m = t.match(/in (\d{1,2}|a few|a couple of|two|three|six) (weeks?|months?)/);
  if (m) { const n = { 'a few': 3, 'a couple of': 2, two: 2, three: 3, six: 6 }[m[1]] || Number(m[1]); const d = new Date(now); if (/week/.test(m[2])) d.setDate(d.getDate() + n * 7); else d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
  m = t.match(new RegExp(`\\b(${MONTHS.join('|')})\\b(?:\\s+(20\\d\\d))?`));
  if (m) { const month = MONTHS.indexOf(m[1]); let year = m[2] ? Number(m[2]) : now.getFullYear(); if (!m[2] && month <= now.getMonth()) year += 1; return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); }
  if (/next (financial|fiscal) year|after (our|the) (year[- ]end|financial year|budget cycle)|next year/.test(t)) { const d = new Date(now); d.setMonth(d.getMonth() + 4); return d.toISOString().slice(0, 10); }
  if (/next quarter|q[1-4]/.test(t)) { const d = new Date(now); d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0, 10); }
  return null;
}

function classifyReply({ subject = '', text = '', headers = '', fromEmail = '' } = {}, { now = new Date() } = {}) {
  const subj = String(subject || ''); const body = String(text || '').slice(0, 4000); const hdr = String(headers || '');
  const from = String(fromEmail || '').toLowerCase();
  const reasons = [];
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|noreply|notifications?|bounce)/.test(from)) reasons.push('sender is a system address');
  if (AUTO_HEADERS.test(hdr)) reasons.push('auto-reply header present');
  if (AUTO_SUBJECT.test(subj)) reasons.push('automatic-reply subject');
  if (AUTO_BODY.test(body)) reasons.push('out-of-office wording');
  if (reasons.length) return { category: 'automatic', confidence: reasons.length >= 2 || AUTO_HEADERS.test(hdr) ? 'high' : 'medium', reasons, hints: {} };
  if (OPT_OUT.test(body) || OPT_OUT.test(subj)) return { category: 'opt-out', confidence: 'high', reasons: ['opt-out wording'], hints: {} };
  const redirect = extractRedirect(body);
  if (WRONG_PERSON.test(body) || redirect) return { category: 'wrong-person', confidence: redirect ? 'high' : 'medium', reasons: [redirect ? `redirect to ${redirect.name}` : 'wrong-person wording'], hints: { redirect } };
  const notNow = NOT_NOW.test(body); const interested = INTERESTED.test(body);
  if (notNow && !/(but|however|although|still)[^.]*\b(interested|keen|happy)/i.test(body)) return { category: 'not-now', confidence: interested ? 'medium' : 'high', reasons: ['deferral wording'], hints: { resumeOn: extractResumeHint(body, now) } };
  if (interested) return { category: 'interested', confidence: /\?|proposal|call|meet|time/i.test(body) ? 'high' : 'medium', reasons: ['interest wording'], hints: {} };
  if (!body.trim()) return { category: 'unclassified', confidence: 'low', reasons: ['no body available (headers only)'], hints: {} };
  return { category: 'unclassified', confidence: 'low', reasons: ['no rule matched'], hints: {} };
}

function slaDueAt(category, from = new Date()) {
  const hours = CATEGORIES[category]?.slaHours; if (hours == null) return null;
  return new Date(from.getTime() + hours * 3600e3).toISOString();
}

module.exports = { classifyReply, extractRedirect, extractResumeHint, slaDueAt, CATEGORIES };
