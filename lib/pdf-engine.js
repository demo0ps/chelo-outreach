function clampText(value, max = 3000) {
  return String(value || '').trim().slice(0, max);
}

// Preserves WinAnsi/Latin-1 characters (e.g., South African names with diacritics) while normalising typographic punctuation.
function toPdfText(input) {
  return String(input || '')
    .normalize('NFC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(input) {
  const clean = toPdfText(input);
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code === 0x5c) out += '\\\\';
    else if (code === 0x28) out += '\\(';
    else if (code === 0x29) out += '\\)';
    else if (code >= 0x20 && code <= 0x7e) out += clean[i];
    else if (code >= 0xa0 && code <= 0xff) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ' ';
  }
  return out;
}

function parseVerifiedMetrics(raw, options = {}) {
  const strict = Boolean(options.strict);
  let rows = [];
  if (Array.isArray(raw)) {
    rows = raw.map(metric => [
      metric?.label,
      metric?.baselineValue ?? metric?.baseline,
      metric?.currentValue ?? metric?.current,
      metric?.unit,
      metric?.period,
      metric?.source
    ].map(value => String(value ?? '').trim()));
  } else {
    rows = String(raw || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.split('|').map(value => value.trim()));
  }
  if (strict && rows.length > 3) throw new Error('Add no more than three verified metric comparisons.');
  const metrics = [];
  let invalid = 0;
  for (const fields of rows) {
    const [rawLabel, rawBaseline, rawCurrent, rawUnit, rawPeriod, rawSource] = fields;
    const label = clampText(rawLabel, 70);
    const baselineText = String(rawBaseline || '').replace(/,/g, '').trim();
    const currentText = String(rawCurrent || '').replace(/,/g, '').trim();
    const baselineValue = Number(baselineText);
    const currentValue = Number(currentText);
    const unit = clampText(rawUnit, 24);
    const period = clampText(rawPeriod, 70);
    const source = clampText(rawSource, 180);
    const valid = fields.length >= 6
      && label
      && /^\d+(?:\.\d{1,3})?$/.test(baselineText)
      && /^\d+(?:\.\d{1,3})?$/.test(currentText)
      && Number.isFinite(baselineValue) && baselineValue >= 0
      && Number.isFinite(currentValue) && currentValue >= 0
      && unit && period && source;
    if (!valid) { invalid += 1; continue; }
    metrics.push({ label, baselineValue, currentValue, unit, period, source });
  }
  if (strict && invalid) {
    throw new Error('Each verified metric must use: Metric | baseline value | latest value | unit | period | verified source. Use one comparison per line.');
  }
  return metrics.slice(0, 3);
}

function wrapPdfLines(str, maxChars = 88) {
  const words = toPdfText(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) { lines.push(current); current = ''; }
      for (let idx = 0; idx < word.length; idx += maxChars) {
        lines.push(word.slice(idx, idx + maxChars));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Multi-page auto-paginating branded PDF generator (never silently clips sections at 5 lines).
function makeProposalPdf(lead, proposal = {}) {
  const company = toPdfText(proposal.company || lead.company || 'Potential partner');
  const contact = toPdfText(proposal.contactName || lead.contactName || 'Partnership team');
  const project = toPdfText(proposal.project || lead.project || 'Education impact partnership');
  const recipientName = toPdfText(proposal.recipientName || '');
  const province = toPdfText(proposal.province || '');
  const amount = Number(proposal.amount ?? lead.amount ?? 0);
  const investment = amount ? `R ${amount.toLocaleString('en-ZA')}` : 'To be agreed';
  const opening = toPdfText(proposal.opening || `We invite ${company} to explore a partnership supporting ${project} through Chelo.`);
  const impact = toPdfText(proposal.impact || 'Support a verified education project with clear milestones, traceable funding and progress updates for your team.');
  const rationale = toPdfText(proposal.rationale || 'Chelo connects funders with verified schools, NGOs and community projects. Partners can follow project progress and see how funding contributes to measurable outcomes.');
  const nextStep = toPdfText(proposal.nextStep || 'Book a short briefing to align on the project, contribution level, timing and reporting needs.');
  const verifiedMetrics = parseVerifiedMetrics(proposal.verifiedMetrics);

  let commands = [];
  const pageStreams = [];
  const rgb = (r, g, b) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
  const rect = (x, y, w, h, color) => { commands.push(`${rgb(...color)} rg ${x} ${y} ${w} ${h} re f`); };
  const line = (x1, y1, x2, y2, color, width = 1) => { commands.push(`${rgb(...color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`); };
  const circle = (cx, cy, r, color, fill = false) => {
    const k = r * 0.55228475;
    commands.push(`${rgb(...color)} ${fill ? 'rg' : 'RG'} 1.3 w ${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c h ${fill ? 'f' : 'S'}`);
  };
  const text = (str, x, y, size = 11, bold = false, color = [0.12, 0.19, 0.19]) => {
    commands.push(`${rgb(...color)} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfEscape(str)}) Tj ET`);
  };

  const drawBrandHeader = (sectionTitle, subtitle) => {
    rect(0, 724, 595, 118, [0.13, 0.10, 0.35]);
    rect(48, 786, 32, 32, [0.35, 0.27, 0.91]);
    circle(64, 802, 7, [1, 1, 1], false);
    circle(64, 802, 2, [1, 1, 1], true);
    text('Chelo', 90, 798, 23, true, [1, 1, 1]);
    text(sectionTitle, 48, 777, 9, true, [0.84, 0.82, 1]);
    text(subtitle, 48, 746, 20, true, [1, 1, 1]);
  };

  const drawFooter = noteText => {
    line(48, 76, 547, 76, [0.87, 0.85, 0.94], 0.8);
    text('Security. Transparency. Accountability.', 48, 57, 9, true, [0.25, 0.19, 0.66]);
    text(noteText, 48, 40, 8, false, [0.43, 0.41, 0.53]);
  };

  const flushNarrativePage = isContinuation => {
    drawFooter(
      verifiedMetrics.length
        ? 'Verified metric comparisons and source references included on final page.'
        : 'cheloapp.com  |  South Africa  |  Verified impact partnerships'
    );
    pageStreams.push(commands.join('\n') + '\n');
    commands = [];
    if (isContinuation) {
      drawBrandHeader('PARTNERSHIP PROPOSAL (CONTINUED)', company.slice(0, 48));
    }
  };

  drawBrandHeader('PARTNERSHIP PROPOSAL', 'A partnership for lasting impact');
  text('PREPARED FOR', 48, 698, 8, true, [0.42, 0.36, 0.76]);
  for (const [idx, companyLine] of wrapPdfLines(company, 54).slice(0, 2).entries()) {
    text(companyLine, 48, 676 - idx * 19, 17, true, [0.13, 0.11, 0.31]);
  }
  const metaTop = company.length > 54 ? 640 : 656;
  text(`Attention: ${contact.slice(0, 64)}`, 48, metaTop, 10, false, [0.38, 0.36, 0.48]);
  line(48, metaTop - 15, 547, metaTop - 15, [0.87, 0.85, 0.94], 0.8);

  const boxBottom = metaTop - 78;
  rect(48, boxBottom, 499, 50, [0.95, 0.94, 1]);
  text('PROPOSED CONTRIBUTION', 64, boxBottom + 31, 8, true, [0.36, 0.29, 0.80]);
  text(investment, 64, boxBottom + 11, 17, true, [0.22, 0.17, 0.59]);
  const projectHeaderLine = wrapPdfLines(`Project: ${project}`, 44);
  text(projectHeaderLine[0] || '', 285, boxBottom + 27, 9, true, [0.24, 0.20, 0.52]);
  if (projectHeaderLine[1]) {
    text(projectHeaderLine[1], 285, boxBottom + 13, 8.5, false, [0.34, 0.31, 0.54]);
  } else if (recipientName || province) {
    text([recipientName, province].filter(Boolean).join(' · ').slice(0, 50), 285, boxBottom + 13, 8, false, [0.38, 0.36, 0.52]);
  }

  let y = boxBottom - 28;
  const minNarrativeY = 104;

  const renderSection = (title, body) => {
    const bodyLines = wrapPdfLines(body, 90);
    if (y - 34 < minNarrativeY) {
      flushNarrativePage(true);
      y = 692;
    }
    text(title.toUpperCase(), 48, y, 9, true, [0.35, 0.27, 0.83]);
    y -= 16;
    for (const row of bodyLines) {
      if (y < minNarrativeY) {
        flushNarrativePage(true);
        y = 692;
        text(`${title.toUpperCase()} (CONT.)`, 48, y, 8.5, true, [0.35, 0.27, 0.83]);
        y -= 15;
      }
      text(row, 48, y, 10.2, false, [0.32, 0.31, 0.44]);
      y -= 14;
    }
    y -= 11;
  };

  const recipientContext = [
    project,
    recipientName ? `Verified recipient: ${recipientName}${province ? ` (${province})` : ''}` : (province ? `Province: ${province}` : ''),
    'Final need, delivery scope, milestones and budget are confirmed with the verified recipient before approval.'
  ].filter(Boolean).join('. ');

  renderSection('Partnership opportunity', `${opening} ${impact}`);
  renderSection('A project to back', recipientContext);
  renderSection('Why Chelo', rationale);
  renderSection('Recommended next step', nextStep);

  flushNarrativePage(false);

  if (verifiedMetrics.length) {
    commands = [];
    drawBrandHeader('VERIFIED PROJECT METRICS', 'Evidence supplied for review');
    text(company.slice(0, 64), 48, 697, 13, true, [0.13, 0.11, 0.31]);
    text(`Project: ${project.slice(0, 74)}`, 48, 678, 9, false, [0.38, 0.36, 0.48]);
    text('Baseline and latest values use the same scale within each metric.', 48, 657, 9, false, [0.38, 0.36, 0.48]);
    let cardTop = 639;
    for (const metric of verifiedMetrics) {
      const cardBottom = cardTop - 108;
      rect(48, cardBottom, 499, 108, [0.975, 0.972, 1]);
      line(48, cardBottom, 547, cardBottom, [0.88, 0.86, 0.95], 0.7);
      text(metric.label.slice(0, 68), 64, cardTop - 20, 11, true, [0.18, 0.15, 0.39]);
      text(metric.period.slice(0, 82), 64, cardTop - 36, 8, false, [0.48, 0.45, 0.59]);
      const maxValue = Math.max(metric.baselineValue, metric.currentValue, 1);
      const barX = 132, barW = 250;
      const drawValue = (label, value, rowY, color) => {
        text(label, 64, rowY, 8, true, [0.34, 0.32, 0.47]);
        rect(barX, rowY - 5, barW, 7, [0.90, 0.89, 0.95]);
        const width = value > 0 ? Math.max(2, (barW * value) / maxValue) : 0;
        if (width) rect(barX, rowY - 5, width, 7, color);
        const displayed = Number(value).toLocaleString('en-ZA', { maximumFractionDigits: 3 });
        text(`${displayed} ${metric.unit}`.slice(0, 32), 394, rowY, 8, false, [0.26, 0.24, 0.38]);
      };
      drawValue('Baseline', metric.baselineValue, cardTop - 57, [0.66, 0.64, 0.77]);
      drawValue('Latest', metric.currentValue, cardTop - 75, [0.35, 0.27, 0.91]);
      const sourceLines = wrapPdfLines(`Source: ${metric.source}`, 96);
      text(sourceLines[0] || '', 64, cardTop - 94, 7.2, false, [0.43, 0.41, 0.53]);
      if (sourceLines[1]) text(sourceLines[1], 64, cardTop - 103, 6.8, false, [0.43, 0.41, 0.53]);
      cardTop -= 120;
    }
    line(48, 76, 547, 76, [0.87, 0.85, 0.94], 0.8);
    text('Bar lengths are scaled within each metric; unlike units are not compared.', 48, 57, 8, true, [0.25, 0.19, 0.66]);
    text('Source references are staff-supplied. Confirm values and periods before sharing.', 48, 40, 8, false, [0.43, 0.41, 0.53]);
    pageStreams.push(commands.join('\n') + '\n');
  }

  const pageCount = pageStreams.length;
  const firstFontId = 3 + pageCount;
  const secondFontId = firstFontId + 1;
  const firstStreamId = secondFontId + 1;
  const pageObjects = pageStreams.map((_, index) => {
    const streamId = firstStreamId + index;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${firstFontId} 0 R /F2 ${secondFontId} 0 R >> >> /Contents ${streamId} 0 R >>`;
  });
  const streamObjects = pageStreams.map(stream => `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageStreams.map((_, index) => `${3 + index} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ...streamObjects
  ];
  let pdf = '%PDF-1.4\n%Chelo\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { clampText, toPdfText, pdfEscape, parseVerifiedMetrics, wrapPdfLines, makeProposalPdf };
