const crypto = require('node:crypto');

const VIDEO_PLATFORMS = {
  google_meet: { id: 'google_meet', label: 'Google Meet', placeholder: 'https://meet.google.com/abc-defg-hij' },
  microsoft_teams: { id: 'microsoft_teams', label: 'Microsoft Teams', placeholder: 'https://teams.microsoft.com/l/meetup-join/...' },
  zoom: { id: 'zoom', label: 'Zoom', placeholder: 'https://zoom.us/j/...' }
};

function detectVideoPlatform(url = '', fallback = 'google_meet') {
  const clean = String(url || '').trim().toLowerCase();
  if (/meet\.google\.com/i.test(clean)) return 'google_meet';
  if (/teams\.(microsoft|live)\.com/i.test(clean)) return 'microsoft_teams';
  if (/zoom\.(us|com)/i.test(clean)) return 'zoom';
  return VIDEO_PLATFORMS[fallback] ? fallback : 'google_meet';
}

function normalizeVideoPlatform(value, url = '') {
  if (value && VIDEO_PLATFORMS[value]) return value;
  return detectVideoPlatform(url, 'google_meet');
}

function validateMeetingUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return { ok: true, url: '' };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: 'Enter a valid HTTPS video meeting link (Google Meet, Microsoft Teams or Zoom).' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { ok: false, error: 'Video briefing links must use HTTPS without embedded credentials.' };
  }
  return { ok: true, url: parsed.href };
}

// South Africa Standard Time (Africa/Johannesburg) is permanently UTC+02:00 with no DST.
function parseSastDateTime(dateStr, timeStr) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [year, month, day] = d.split('-').map(Number);
  const [hour, minute] = t.split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const checkUtc = new Date(Date.UTC(year, month - 1, day));
  if (checkUtc.getUTCFullYear() !== year || checkUtc.getUTCMonth() !== month - 1 || checkUtc.getUTCDate() !== day) return null;
  const parsed = new Date(`${d}T${t}:00+02:00`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatIcsLocalSast(dateStr, timeStr, addMinutes = 0) {
  const start = parseSastDateTime(dateStr, timeStr);
  if (!start) throw new Error('Invalid SAST briefing date or time.');
  const target = new Date(start.getTime() + addMinutes * 60000 + 2 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return `${target.getUTCFullYear()}${pad(target.getUTCMonth() + 1)}${pad(target.getUTCDate())}T${pad(target.getUTCHours())}${pad(target.getUTCMinutes())}00`;
}

function formatIcsUtcStamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 section 3.1: fold lines longer than 75 octets with CRLF + single space.
function foldIcsLine(line) {
  const bytes = Buffer.from(String(line), 'utf8');
  if (bytes.length <= 75) return String(line);
  const chunks = [];
  let cursor = 0;
  let limit = 75;
  while (cursor < bytes.length) {
    let end = Math.min(cursor + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(cursor, end).toString('utf8'));
    cursor = end;
    limit = 74; // account for leading space on continuation lines
  }
  return chunks.join('\r\n ');
}

function buildBriefingIcs(booking, options = {}) {
  const duration = Math.max(10, Math.min(120, Number(booking.durationMinutes || options.durationMinutes || 20)));
  const dtStart = formatIcsLocalSast(booking.date, booking.time, 0);
  const dtEnd = formatIcsLocalSast(booking.date, booking.time, duration);
  const dtStamp = formatIcsUtcStamp(new Date());
  const method = options.method === 'REQUEST' ? 'REQUEST' : 'PUBLISH';
  const status = booking.status === 'Declined' ? 'CANCELLED' : 'CONFIRMED';
  const platformKey = normalizeVideoPlatform(booking.videoPlatform, booking.meetingUrl);
  const platformLabel = VIDEO_PLATFORMS[platformKey]?.label || 'Video call';
  const orgClean = String(booking.organization || 'Partner').replace(/\s·\s*Demo$/i, '').trim();
  const projectLabel = String(options.project || booking.project || 'Education impact partnership').trim();
  const organizerEmail = String(options.organizerEmail || 'partnerships@cheloapp.com').trim();
  const organizerName = String(options.organizerName || 'Chelo Partnerships Team').trim();
  const meetingUrl = String(booking.meetingUrl || '').trim();
  const locationText = meetingUrl ? `${platformLabel}: ${meetingUrl}` : `${platformLabel} (link shared by Chelo)`;
  const uidSeed = String(booking.id || crypto.randomBytes(8).toString('hex')).replace(/[^a-zA-Z0-9_.-]/g, '-');
  const uid = `${uidSeed}@cheloapp.com`;
  const sequence = Math.max(0, Number(booking.icsSequence || 0));

  const descriptionLines = [
    `Chelo ${duration}-minute introductory video briefing with ${orgClean}.`,
    `Focus: ${projectLabel}`,
    `Video platform: ${platformLabel}`,
    meetingUrl ? `Join link: ${meetingUrl}` : 'Join link: Chelo will share the meeting room link.',
    '',
    'No preparation or commitment is required. This conversation explores alignment, verified project priorities and how Chelo reports traceable community impact.',
    booking.note ? `Notes: ${booking.note}` : ''
  ].filter((line, idx, arr) => line || (idx > 0 && idx < arr.length - 1)).join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Chelo Impact Partnerships//Briefing Scheduler 2.0//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VTIMEZONE',
    'TZID:Africa/Johannesburg',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0200',
    'TZNAME:SAST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${status}`,
    `DTSTART;TZID=Africa/Johannesburg:${dtStart}`,
    `DTEND;TZID=Africa/Johannesburg:${dtEnd}`,
    `SUMMARY:${escapeIcsText(`Chelo × ${orgClean} · ${duration}-min Intro Briefing`)}`,
    `DESCRIPTION:${escapeIcsText(descriptionLines)}`,
    `LOCATION:${escapeIcsText(locationText)}`,
    ...(meetingUrl ? [`URL:${meetingUrl}`] : []),
    `ORGANIZER;CN=${escapeIcsText(organizerName)}:mailto:${organizerEmail}`,
    ...(booking.email ? [`ATTENDEE;CN=${escapeIcsText(booking.contactName || orgClean)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${String(booking.email).trim()}`] : []),
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function buildBriefingConfirmationEmail(booking, options = {}) {
  const duration = Number(booking.durationMinutes || 20);
  const orgClean = String(booking.organization || 'your team').replace(/\s·\s*Demo$/i, '').trim();
  const firstName = String(booking.contactName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Dear ${firstName},` : 'Hello,';
  const platformKey = normalizeVideoPlatform(booking.videoPlatform, booking.meetingUrl);
  const platformLabel = VIDEO_PLATFORMS[platformKey]?.label || 'Video call';
  const projectLabel = String(options.project || booking.project || 'Education impact partnership').trim();
  const meetingUrl = String(booking.meetingUrl || '').trim();
  const [y, m, d] = String(booking.date || '').split('-').map(Number);
  const niceDate = y && m && d
    ? new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : booking.date;

  const subject = `Confirmed: Chelo × ${orgClean} (${booking.date} at ${booking.time} SAST)`;
  const text = [
    greeting,
    '',
    `Thank you for requesting a time with Chelo. Your ${duration}-minute introductory video briefing is confirmed:`,
    '',
    `Date: ${niceDate}`,
    `Time: ${booking.time} SAST (Africa/Johannesburg)`,
    `Platform: ${platformLabel}`,
    meetingUrl ? `Join video briefing: ${meetingUrl}` : 'Video link: To be shared before the call',
    `Discussion focus: ${projectLabel}`,
    '',
    'A calendar invitation (.ics) is attached to this email. No preparation or commitment is required — we look forward to hearing your priorities and sharing how Chelo connects partners with verified projects.',
    '',
    'If you need to adjust the time, simply reply to this email.',
    '',
    'Kind regards,',
    options.organizerName || 'Chelo Partnerships Team'
  ].join('\n');

  const escapeHtml = v => String(v || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const joinButton = meetingUrl
    ? `<p style="margin:18px 0"><a href="${escapeHtml(meetingUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#5945e8;color:#ffffff;text-decoration:none;font-weight:700">Join via ${escapeHtml(platformLabel)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,sans-serif;font-size:14px;color:#24213f;line-height:1.6">
    <p style="margin:0 0 14px">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 14px">Thank you for requesting a time with Chelo. Your <strong>${duration}-minute introductory video briefing</strong> is confirmed:</p>
    <div style="margin:0 0 16px;padding:14px 16px;border-radius:10px;background:#f5f3ff;border:1px solid #e4dfff">
      <div><strong>Date:</strong> ${escapeHtml(niceDate)}</div>
      <div><strong>Time:</strong> ${escapeHtml(booking.time)} SAST (Africa/Johannesburg)</div>
      <div><strong>Platform:</strong> ${escapeHtml(platformLabel)}</div>
      <div><strong>Focus:</strong> ${escapeHtml(projectLabel)}</div>
      ${meetingUrl ? `<div style="margin-top:6px;word-break:break-all"><strong>Link:</strong> <a href="${escapeHtml(meetingUrl)}" style="color:#5945e8">${escapeHtml(meetingUrl)}</a></div>` : ''}
    </div>
    ${joinButton}
    <p style="margin:0 0 14px">A calendar invitation (<code>.ics</code>) is attached. No preparation or commitment is required — we look forward to hearing your priorities.</p>
    <p style="margin:0;color:#55516f">Kind regards,<br>${escapeHtml(options.organizerName || 'Chelo Partnerships Team')}</p>
  </body></html>`;

  return { subject, text, html };
}

module.exports = {
  VIDEO_PLATFORMS,
  detectVideoPlatform,
  normalizeVideoPlatform,
  validateMeetingUrl,
  parseSastDateTime,
  formatIcsLocalSast,
  buildBriefingIcs,
  buildBriefingConfirmationEmail
};
