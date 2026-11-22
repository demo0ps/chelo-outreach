// v58 — discovery returns real funders (not the magazine), and articles become dated "homework" facts.
const test = require('node:test');
const assert = require('node:assert/strict');
const news = require('../lib/news-intel');
const createResearch = require('../lib/funder-research');

test('host classification: media, directories, government, universities and social are never funders', () => {
  assert.equal(news.classifyHost('www.news24.com'), 'media');
  assert.equal(news.classifyHost('bizcommunity.com'), 'media');
  assert.equal(news.classifyHost('miningweekly.co.za'), 'media');
  assert.equal(news.classifyHost('careers24.com'), 'directory');
  assert.equal(news.classifyHost('education.gov.za'), 'government');
  assert.equal(news.classifyHost('wits.ac.za'), 'academic');
  assert.equal(news.classifyHost('za.linkedin.com'), 'social');
  assert.equal(news.classifyHost('angloamerican.com'), 'company');
  assert.equal(news.isPublisherUrl('https://www.sasol.com/news/sasol-hands-over-classrooms'), true, 'a /news/ path on a company site is still an article');
  assert.equal(news.isPublisherUrl('https://www.sasol.com/sustainability/csi'), false);
});

test('article dates and freshness; email phrasing never names the outlet', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  assert.equal(news.articleDate({ html: '<meta property="article:published_time" content="2026-03-12T08:00:00+02:00">' }), '2026-03-12');
  assert.equal(news.articleDate({ url: 'https://www.news24.com/business/2025/09/04/story' }), '2025-09-04');
  assert.equal(news.articleDate({ text: 'Johannesburg, 3 February 2026 — Vuka Mining Trust handed over...' }), '2026-02-03');
  assert.equal(news.isFresh('2026-03-12', now), true);
  assert.equal(news.isFresh('2025-09-04', now), false);
  assert.equal(news.whenPhrase('2026-03-12', now), 'earlier this year');
  assert.equal(news.whenPhrase('2026-10-02', now), 'recently');
  assert.equal(news.whenPhrase('2025-09-04', now), 'last year');
  assert.equal(news.whenPhrase('2023-01-01', now), 'in 2023');
});

test('giving facts (heuristic): only sentences about the funder giving, dated and flagged fresh/stale', async () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const articles = [
    { url: 'https://www.news24.com/2026/03/12/vuka', title: 'Vuka hands over labs', publishedAt: '2026-03-12', text: 'Vuka Mining Trust handed over three science laboratories worth R4.2 million to schools in Sekhukhune on Tuesday. The MEC thanked the company. Vuka Mining Trust reported a 12% rise in platinum output for the quarter.' },
    { url: 'https://www.iol.co.za/2024/05/01/vuka', title: 'Old bursaries', publishedAt: '2024-05-01', text: 'Vuka Mining Trust awarded 40 bursaries to engineering students from Limpopo in its annual programme.' }
  ];
  const facts = await news.givingFacts('Vuka Mining Trust', articles, { now });
  assert.ok(facts.some(f => /laboratories/.test(f.text) && f.fresh && f.figure && f.when === 'earlier this year'), JSON.stringify(facts));
  assert.ok(facts.some(f => /bursaries/.test(f.text) && !f.fresh && f.when === 'in 2024'));
  assert.ok(!facts.some(f => /platinum output/.test(f.text)), 'business news is not a giving fact');
  assert.ok(facts.every(f => f.kind === 'news_giving' && f.sourceUrl && f.outlet));
});

test('funder names from articles (heuristic) skip recipients, places and people', () => {
  const names = news.heuristicFunderNames([{ url: 'https://x/a', title: 't', text: 'Standard Bank Group has donated R2 million to 20 schools in Limpopo. The Department of Basic Education welcomed the gift. Shoprite Holdings handed over a mobile kitchen to Thabo Primary School on Friday. Gauteng welcomed the move.' }]);
  const list = names.map(n => n.name);
  assert.ok(list.includes('Standard Bank Group'), list.join('|'));
  assert.ok(list.includes('Shoprite Holdings'), list.join('|'));
  assert.ok(!list.some(n => /Gauteng|Department|Thabo Primary/.test(n)), list.join('|'));
  assert.equal(news.looksLikeOfficialSite('Shoprite Holdings', { url: 'https://www.shopriteholdings.co.za/', title: 'Shoprite Holdings' }), true);
  assert.equal(news.looksLikeOfficialSite('Shoprite Holdings', { url: 'https://www.news24.com/shoprite', title: 'Shoprite Holdings donates' }), false);
});

test('discovery: company pages count directly, articles are read for funders, magazines never appear as results', async () => {
  const fetchCalls = [];
  const fetchImpl = async (href, init = {}) => {
    fetchCalls.push(href);
    if (href === 'https://api.tavily.com/search') {
      const q = JSON.parse(init.body).query;
      if (/official website/.test(q)) {
        if (/Standard Bank Group/.test(q)) return json({ results: [{ title: 'Standard Bank Group | Home', url: 'https://www.standardbank.com/', content: 'Africa is our home' }] });
        return json({ results: [{ title: 'Random blog', url: 'https://www.bizcommunity.com/x', content: '' }] });
      }
      return json({ results: [
        { title: 'Exxaro | Corporate social investment', url: 'https://www.exxaro.com/sustainability/csi', content: 'Exxaro CSI invests in education' },
        { title: 'Miners donate to schools', url: 'https://www.miningweekly.com/article/2026-05-02-miners-donate', content: 'Standard Bank Group has donated R2 million to 20 schools.' },
        { title: 'CSI Manager vacancy', url: 'https://www.careers24.com/jobs/csi-manager', content: 'Apply now' },
        { title: 'DBE statement', url: 'https://www.education.gov.za/news/x', content: 'The department welcomed' }
      ] });
    }
    if (href.includes('miningweekly.com')) return html('<html><head><title>Miners donate to schools</title><meta property="article:published_time" content="2026-05-02T09:00:00+02:00"></head><body><p>Standard Bank Group has donated R2 million to 20 schools in Limpopo this week, the bank said. Mystery Mining Trust pledged R500 000 to a feeding scheme. Learners cheered as the Department of Basic Education looked on and principal Thandi Mokoena (082 555 1234) thanked them.</p></body></html>');
    throw new Error(`unexpected fetch ${href}`);
  };
  function json(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } }); }
  function html(body) { return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }); }
  const researcher = createResearch({ fetch: fetchImpl, resolver: { lookup: async () => [{ address: '41.0.0.1' }] } });
  const result = await researcher.discoverOrganisations({ provider: 'tavily', apiKey: 'k' }, 'mining education CSI');
  const names = result.organisations.map(o => o.name);
  assert.ok(names.some(n => /Exxaro/.test(n)), `own-site company kept: ${names}`);
  assert.ok(names.includes('Standard Bank Group'), `funder named in the article resolved: ${names}`);
  const sb = result.organisations.find(o => o.name === 'Standard Bank Group');
  assert.equal(sb.domain, 'standardbank.com'); assert.equal(sb.via, 'news');
  assert.ok(sb.articles.some(a => a.url.includes('miningweekly') && a.publishedAt === '2026-05-02'), 'article kept with its date');
  assert.ok(!names.some(n => /Miningweekly|Careers24|Education|Mining Weekly/i.test(n)), `publishers never become results: ${names}`);
  assert.ok(!result.organisations.some(o => /miningweekly|careers24|gov\.za/.test(o.domain || '')));
  const mystery = result.organisations.find(o => o.name === 'Mystery Mining Trust');
  assert.ok(mystery && mystery.unresolved && !mystery.website, 'unresolved funders are shown without a website');
  assert.ok(!fetchCalls.some(h => /careers24|gov\.za/.test(h)), 'directories and government pages are never fetched');
});

test('v59: proper names, publishers judged by AI, tool domains dropped, article step reported', async () => {
  assert.equal(news.orgNameFor('Corporate social investment | BP Southern Africa', 'bp.com'), 'BP Southern Africa');
  assert.equal(news.orgNameFor('Corporate social investment', 'bp.com'), 'BP');
  assert.ok(['JSE', 'Johannesburg Stock Exchange'].includes(news.orgNameFor('Corporate Social Investment | Johannesburg Stock Exchange', 'jse.co.za')));
  assert.equal(news.orgNameFor('Datatec | CSI Datatec Foundation', 'datatec.com'), 'Datatec');
  assert.equal(news.classifyHost('www.businessinsider.co.za'), 'media');
  assert.equal(news.classifyHost('billionaires.africa'), 'media');
  assert.equal(news.classifyHost('trialogueknowledgehub.co.za'), 'media');
  assert.equal(news.classifyHost('tavily.com'), 'directory');

  // The screenshot case: AI says Business Insider is a publisher; the article names the Motsepe Foundation.
  const fetchImpl = async (href, init = {}) => {
    if (href === 'https://ai.example/v1/chat/completions') {
      const body = JSON.parse(init.body); const user = JSON.parse(body.messages[1].content);
      if (user.items) return json({ choices: [{ message: { content: JSON.stringify({ items: user.items.map(it => ({ i: it.i, kind: /businessinsider|tavily|trialogue/.test(it.url) ? 'publisher' : 'org', name: /bp\.com/.test(it.url) ? 'BP Southern Africa' : /datatec/.test(it.url) ? 'Datatec' : '' })) }) } }] });
      if (user.sources) return json({ choices: [{ message: { content: JSON.stringify({ organisations: [{ name: 'Motsepe Foundation', ref: 'N1', evidence: 'The Motsepe Foundation pledged $417.8m to education.' }] }) } }] });
    }
    if (href === 'https://api.tavily.com/search') {
      const q = JSON.parse(init.body).query;
      if (/official website/.test(q)) return json({ results: [{ title: 'Motsepe Foundation', url: 'https://www.motsepefoundation.org/', content: '' }] });
      return json({ results: [
        { title: 'CSI', url: 'https://tavily.com/csi', content: 'South African companies spent ZAR13.1 billion on CSI' },
        { title: 'Corporate social investment', url: 'https://www.bp.com/en_za/south-africa/home/sustainability/csi.html', content: 'The Energy Mobility Education Trust' },
        { title: 'Datatec | CSI Datatec Foundation', url: 'https://www.datatec.com/csi', content: 'Partnerships' },
        { title: 'Businessinsider', url: 'https://www.businessinsider.co.za/2026/06/billionaire-education', content: 'South African billionaire plots Africa\'s largest education investment with $417.8m' }
      ] });
    }
    if (href.includes('businessinsider')) return html('<html><head><title>Billionaire education</title></head><body><p>The Motsepe Foundation pledged $417.8m to education across Africa.</p></body></html>');
    throw new Error(`unexpected fetch ${href}`);
  };
  function json(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } }); }
  function html(body) { return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }); }
  const researcher = createResearch({ fetch: fetchImpl, resolver: { lookup: async () => [{ address: '41.0.0.1' }] } });
  const r = await researcher.discoverOrganisations({ provider: 'tavily', apiKey: 'k' }, 'JSE energy companies with education csi', { aiConfig: { apiKey: 'ai', model: 'm', endpoint: 'https://ai.example/v1/chat/completions' } });
  const names = r.organisations.map(o => o.name).sort();
  assert.deepEqual(names, ['BP Southern Africa', 'Datatec', 'Motsepe Foundation'], names.join('|'));
  assert.ok(!r.organisations.some(o => /tavily|businessinsider/.test(o.domain)));
  assert.deepEqual(r.read.named, ['Motsepe Foundation']); assert.equal(r.read.aiOn, true); assert.equal(r.read.articles, 1);
});
