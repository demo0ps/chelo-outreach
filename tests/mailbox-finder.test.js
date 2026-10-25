const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxFinder, extractMailboxes, looksPersonal } = require('../lib/mailbox-finder');

test('mailbox finder: captures only the organisation’s own generic mailboxes, never personal addresses', () => {
  const html = `<footer>CSI enquiries: <a href="mailto:CSI@example-corp.co.za">CSI@example-corp.co.za</a> · foundation@example-corp.co.za · thandi.nkosi@example-corp.co.za · j.smith@example-corp.co.za · media@example-corp.co.za · info@gmail.com · partner@othercorp.com · logo@2x.png</footer>`;
  const hits = extractMailboxes(html, { domains: new Set(['example-corp.co.za']), sourceUrl: 'https://www.example-corp.co.za/contact' });
  assert.deepEqual(hits.map(h => h.email), ['csi@example-corp.co.za', 'foundation@example-corp.co.za', 'media@example-corp.co.za']);
  assert.equal(hits[0].score, 1); assert.equal(hits[2].score, 0, 'media is kept for transparency but never auto-selected');
  assert.ok(looksPersonal('thandi.nkosi') && looksPersonal('j.smith') && !looksPersonal('csi') && !looksPersonal('corporate.affairs'));
  assert.equal(extractMailboxes('mail us at enquiries [at] example-corp.co.za', { domains: new Set(['example-corp.co.za']) })[0].email, 'enquiries@example-corp.co.za');
});

test('mailbox finder: crawls contact/CSI pages, verifies, prefers published over pattern guesses, pattern guess only when SMTP-confirmed', async () => {
  const site = {
    'https://www.acme.co.za/': { html: '<html><body>Welcome</body></html>', text: 'Welcome' },
    'https://www.acme.co.za/contact-us': { html: '<footer>General: info@acme.co.za · Social investment: csi@acme.co.za · CEO: sipho.dlamini@acme.co.za</footer>', text: '' }
  };
  const fetched = [];
  const fetchPage = async url => { fetched.push(url); if (site[url]) return site[url]; throw new Error('HTTP 404'); };
  const verify = async email => email.startsWith('csi@') ? { status: 'deliverable', reason: 'ok' } : { status: 'unknown', reason: 'port 25 blocked' };
  const finder = createMailboxFinder({ fetchPage, verify });
  const r = await finder.find({ company: 'Acme', website: 'https://www.acme.co.za/' });
  assert.equal(r.status, 'published'); assert.equal(r.chosen.email, 'csi@acme.co.za'); assert.equal(r.chosen.verification.status, 'deliverable');
  assert.ok(!r.candidates.some(c => c.email.includes('sipho')), 'personal address never stored');
  assert.ok(r.pages.includes('https://www.acme.co.za/contact-us'));

  // Nothing published → pattern guesses, only accepted when SMTP says deliverable
  const quiet = createMailboxFinder({ fetchPage: async () => ({ html: '<p>no emails here</p>', text: 'no emails here' }), verify: async () => ({ status: 'unknown', reason: 'port 25 blocked' }) });
  const q = await quiet.find({ company: 'Quiet', website: 'https://www.quiet.co.za/' });
  assert.equal(q.status, 'unconfirmed'); assert.equal(q.chosen, null); assert.ok(q.candidates.every(c => c.pattern));
  const confirmed = createMailboxFinder({ fetchPage: async () => ({ html: '', text: '' }), verify: async email => ({ status: email.startsWith('foundation@') ? 'deliverable' : 'undeliverable', reason: '' }) });
  const c = await confirmed.find({ company: 'Quiet', website: 'https://www.quiet.co.za/' });
  assert.equal(c.status, 'pattern-verified'); assert.equal(c.chosen.email, 'foundation@quiet.co.za');
  // Unreachable site, no patterns requested
  const dead = createMailboxFinder({ fetchPage: async () => { throw new Error('ENOTFOUND'); }, verify: async () => ({ status: 'invalid' }) });
  assert.equal((await dead.find({ company: 'Dead', website: 'https://www.dead.co.za/' }, { tryPatterns: false })).status, 'unreachable');
});
