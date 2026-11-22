// v57 — one Chelo voice, five rotating openings, anti-sameness check.
const test = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../lib/voice');

test('openings rotate per funder and never repeat until all five are used', () => {
  const lead = { id: 'lead-1', company: 'Metsi Energy Group', sector: 'Energy', amount: 850000 };
  const seen = [];
  let l = lead;
  for (let i = 0; i < 5; i += 1) { const s = voice.pickOpening(l, 1); seen.push(s); l = { ...l, voice: voice.remember(l, s) }; }
  assert.equal(new Set(seen).size, 5, `all five used once: ${seen}`);
  assert.ok(voice.OPENINGS.includes(voice.pickOpening(l, 1)), 'sixth pick still returns a valid strategy');
  // Different funders start in different places.
  const starts = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => voice.pickOpening({ id: `lead-${id}` }, 1)));
  assert.ok(starts.size >= 3, `spread across funders: ${[...starts]}`);
  // Rewrite excludes the last used one.
  assert.notEqual(voice.pickOpening({ id: 'x', voice: { last: 'figure', used: ['figure'] } }, 1, { exclude: ['figure'] }), 'figure');
});

test('angle picks the fact that suits the strategy; opening lines differ; AI brief carries the rules', () => {
  const facts = ['Focus areas are education, youth employment and enterprise development', 'Spent R42 million on CSI in FY2025 reaching 12 000 learners', 'Headquartered in Sandton'];
  assert.match(voice.angleFrom(facts, 'figure'), /R42 million/);
  assert.match(voice.angleFrom(facts, 'priority'), /Focus areas/);
  const lead = { id: 'l', company: 'Vuka Mining Trust', sector: 'Mining', contactName: 'Nomsa Dube', amount: 600000 };
  const project = { name: 'Solar Classrooms', recipientName: 'Tshwane Secondary Cluster' };
  const lines = voice.OPENINGS.map(s => voice.openingLine({ strategy: s, lead, project, fact: voice.angleFrom(facts, s), amount: lead.amount }));
  assert.equal(new Set(lines).size, 5);
  assert.ok(lines.every(t => t.length > 40 && !/undefined/.test(t)), JSON.stringify(lines));
  const brief = voice.aiBrief({ strategy: 'question', step: 2, lead, fact: facts[0], signOff: 'Warm regards' });
  assert.match(brief, /55–90 words/); assert.match(brief, /Warm regards/); assert.match(brief, /genuine, specific question/);
  assert.deepEqual(voice.lengthFor(1), [95, 140]); assert.deepEqual(voice.lengthFor(9), [40, 65]);
});

test('anti-sameness flags a near-copy and ignores shared boilerplate', () => {
  const a = 'Hi Sipho,\n\nMetsi Energy Group\'s work in Energy CSI is why I\'m writing.\n\nBy March 2027 the solar roof at Tshwane Secondary is live.\n\nChelo verified the quotes, pays suppliers directly and signs off each milestone, so your board sees every rand land.\n\nWorth a one-page look?\n\nTo stop further outreach: https://x/opt';
  const b = a.replace('Metsi Energy Group', 'Vuka Mining Trust').replace('Sipho', 'Nomsa');
  const c = 'Hi Nomsa,\n\nR42 million on CSI last year, 12 000 learners reached. That number is why I\'m writing.\n\nAt Tshwane Secondary the need is a solar roof and a working lab by March.\n\nQuotes verified, suppliers paid directly, milestones signed off — the credit and the report are yours.\n\nMay I send the one page?\n\nTo stop further outreach: https://x/opt';
  assert.equal(voice.tooSimilar(b, [a]).tooSimilar, true);
  assert.equal(voice.tooSimilar(c, [a]).tooSimilar, false);
  assert.equal(voice.tooSimilar(c, []).score, 0);
});
