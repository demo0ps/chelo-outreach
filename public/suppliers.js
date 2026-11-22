// Public supplier pages (R4): /suppliers/join and /quote/:token. Plain fetch to /api/public/*; no session.
(function () {
  const $ = s => document.querySelector(s);
  const msg = (el, text, ok) => { el.innerHTML = `<div class="msg ${ok ? 'ok' : 'err'}"></div>`; el.firstChild.textContent = text; };
  const checks = (host, items, name) => { host.innerHTML = ''; for (const it of items) { const id = Array.isArray(it) ? it[0] : it; const label = Array.isArray(it) ? it[1] : it; const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.name = name; i.value = id; l.append(i, document.createTextNode(label)); host.append(l); } };
  const picked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
  async function post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; }

  if (location.pathname === '/suppliers/join') {
    $('#join').hidden = false;
    fetch('/api/public/suppliers/signup').then(r => r.json()).then(d => { checks($('#trades'), d.trades, 'trades'); checks($('#provinces'), d.provinces, 'provinces'); });
    $('#join-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target; const data = Object.fromEntries(new FormData(f).entries()); data.trades = picked('trades'); data.provinces = picked('provinces'); data.consent = f.consent.checked;
      const btn = f.querySelector('button'); btn.disabled = true;
      try { const r = await post('/api/public/suppliers/signup', data); msg($('#join-msg'), r.message, true); f.reset(); } catch (err) { msg($('#join-msg'), err.message, false); } finally { btn.disabled = false; }
    });
    return;
  }
  const m = location.pathname.match(/^\/quote\/([A-Za-z0-9_-]+)/);
  if (m) {
    $('#quote').hidden = false; const token = m[1]; const s = new URLSearchParams(location.search).get('s') || '';
    const api = `/api/public/quote/${encodeURIComponent(token)}${s ? `?s=${encodeURIComponent(s)}` : ''}`;
    fetch(api).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Unavailable'); return d; }).then(d => {
      $('#q-title').textContent = `Quote request: ${d.tradeLabel}`;
      $('#q-sub').textContent = `${d.project.name} · ${d.project.recipientName}${d.project.province ? `, ${d.project.province}` : ''} · ${d.status === 'open' ? `quotes close ${new Date(d.closesAt).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}` : 'this request has closed'}`;
      $('#q-brief').textContent = d.project.brief || '';
      if (d.supplier) { $('#q-company').value = d.supplier.company || ''; $('#q-contact').value = d.supplier.contactName || ''; $('#q-email').value = d.supplier.email || ''; $('#q-phone').value = d.supplier.phone || ''; }
      if (d.status !== 'open') { $('#quote-form').querySelectorAll('input,textarea,button').forEach(el => { el.disabled = true; }); msg($('#quote-msg'), 'This quote request has closed. Thank you for your interest.', false); }
    }).catch(err => { $('#q-title').textContent = 'Quote link unavailable'; msg($('#quote-msg'), err.message, false); $('#quote-form').hidden = true; });
    $('#quote-form').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target; const data = Object.fromEntries(new FormData(f).entries()); const btn = $('#q-submit'); btn.disabled = true;
      try { const r = await post(api, data); msg($('#quote-msg'), r.message, true); f.querySelectorAll('input,textarea').forEach(el => { el.readOnly = true; }); } catch (err) { msg($('#quote-msg'), err.message, false); btn.disabled = false; }
    });
  }
})();
