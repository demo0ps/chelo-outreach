// Public supporter pages (v71): /support (sign-up) and /pledge/:token?p=project. Plain fetch to /api/public/*; no session.
(function () {
  const $ = s => document.querySelector(s);
  const msg = (el, text, ok) => { el.innerHTML = `<div class="msg ${ok ? 'ok' : 'err'}"></div>`; el.firstChild.textContent = text; };
  const checks = (host, items, name) => { host.innerHTML = ''; for (const it of items) { const id = Array.isArray(it) ? it[0] : it; const label = Array.isArray(it) ? it[1] : it; const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.name = name; i.value = id; l.append(i, document.createTextNode(label)); host.append(l); } };
  const picked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
  async function post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; }
  const rand = n => `R ${Math.round(Number(n) || 0).toLocaleString('en-ZA')}`;

  if (location.pathname === '/support') {
    $('#join').hidden = false;
    fetch('/api/public/support/signup').then(r => r.json()).then(d => {
      checks($('#categories'), d.categories, 'categories'); checks($('#provinces'), d.provinces, 'provinces');
      const sel = $('#band'); sel.innerHTML = '<option value="">Prefer not to say</option>'; for (const [id, label] of d.bands) { const o = document.createElement('option'); o.value = id; o.textContent = label; sel.append(o); }
    });
    $('#join-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target; const data = Object.fromEntries(new FormData(f).entries()); data.categories = picked('categories'); data.provinces = picked('provinces'); data.consent = f.consent.checked;
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try { const r = await post('/api/public/support/signup', data); msg($('#join-msg'), r.message, true); f.reset(); } catch (err) { msg($('#join-msg'), err.message, false); } finally { btn.disabled = false; }
    });
    return;
  }
  const m = location.pathname.match(/^\/pledge\/([a-f0-9]{20,48})/);
  if (m) {
    $('#pledge').hidden = false; const p = new URLSearchParams(location.search).get('p') || '';
    const api = `/api/public/pledge/${encodeURIComponent(m[1])}?p=${encodeURIComponent(p)}`;
    fetch(api).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unavailable'); return d; }).then(d => {
      const pr = d.project; const gap = Math.max(0, pr.targetAmount - pr.committedAmount);
      $('#p-title').textContent = `${pr.recipientName}: ${pr.category.toLowerCase()}`;
      $('#p-sub').textContent = `${pr.name}${pr.province ? ` · ${pr.province}` : ''}${pr.targetAmount ? ` · ${rand(pr.targetAmount)} needed${gap && gap !== pr.targetAmount ? `, ${rand(gap)} still open` : ''}` : ''}`;
      $('#p-brief').textContent = pr.summary || '';
      if (d.already.length) { $('#p-already').hidden = false; $('#p-already').textContent = `You have already pledged ${d.already.map(a => rand(a.amount)).join(' and ')} to this project. Thank you — you can add to it below.`; }
    }).catch(err => { $('#p-title').textContent = 'Pledge link unavailable'; msg($('#pledge-msg'), err.message, false); $('#pledge-form').hidden = true; });
    $('#pledge-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target; const data = Object.fromEntries(new FormData(f).entries()); const btn = $('#p-submit'); btn.disabled = true;
      try { const r = await post(api, data); msg($('#pledge-msg'), r.message, true); f.querySelectorAll('input,textarea').forEach(el => { el.readOnly = true; }); } catch (err) { msg($('#pledge-msg'), err.message, false); btn.disabled = false; }
    });
  }
})();
