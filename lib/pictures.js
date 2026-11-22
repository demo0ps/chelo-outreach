'use strict';
// v68: the photo library. One theme per need category, several generated photos per theme (mix of warm documentary and
// bright editorial). Chelo picks the theme from the project, then rotates through the theme's photos per funder so two
// funders never get the same picture for the same school; staff can pin one photo per project.
// Files: public/brand/photos/<theme>-<n>.jpg (hosted page, 1400w) and <theme>-<n>-cover.jpg (PDF cover, 1000w).
const fs = require('node:fs');
const path = require('node:path');

const THEMES = [
  { id: 'classrooms', label: 'Classrooms & building', legacy: 'classroom', re: /\b(classroom|class room|build|construct|renovat|repair|infrastructure|hall|block|ceiling|floor|paint)\b/ },
  { id: 'sanitation', label: 'Toilets & plumbing', legacy: 'construction', re: /\b(sanitation|toilet|ablution|plumbing|sewer|septic|pit latrine|latrine|handwash|basin)\b/ },
  { id: 'water', label: 'Water', legacy: 'construction', re: /\b(water|borehole|tank|jojo|tap|pump|rain ?water)\b/ },
  { id: 'electricity', label: 'Electrical & solar', legacy: 'ict', re: /\b(solar|electric|electrical|electricity|power|wiring|lighting|lights|generator|inverter|battery)\b/ },
  { id: 'ict', label: 'Computers & ICT', legacy: 'ict', re: /\b(digital|ict|computer|laptop|tablet|lab|stem|coding|e-?learning|wifi|connectivity|screens?|smart ?board|projector)\b/ },
  { id: 'library', label: 'Library & literacy', legacy: 'literacy', re: /\b(literacy|librar(y|ies)|reading|books?|foundation phase|ecd|early childhood|numeracy)\b/ },
  { id: 'sports', label: 'Grounds & sports', legacy: 'classroom', re: /\b(sport|sports|field|pitch|court|netball|soccer|football|playground|grounds|garden|landscap|tree)\b/ },
  { id: 'furniture', label: 'Furniture & fittings', legacy: 'classroom', re: /\b(furniture|desks?|chairs?|tables?|shelv|cupboard|fittings)\b/ },
  { id: 'fencing', label: 'Fencing & security', legacy: 'construction', re: /\b(fence|fencing|palisade|gate|security|guard ?house|burglar)\b/ },
  { id: 'kitchen', label: 'Kitchens & feeding', legacy: 'construction', re: /\b(kitchen|feeding|nutrition|meals?|stove|cook|food garden|pantry)\b/ },
  { id: 'other', label: 'School life', legacy: 'construction', re: null }
];
const THEME_IDS = THEMES.map(t => t.id);
const NEED_TO_THEME = { classrooms: 'classrooms', sanitation: 'sanitation', water: 'water', electricity: 'electricity', ict: 'ict', library: 'library', sports: 'sports', furniture: 'furniture', fencing: 'fencing', kitchen: 'kitchen', other: 'other' };

/** Scan the photos folder once (re-scan on demand) so adding a file is enough — no list to maintain. */
function createLibrary(dir) {
  let cache = null;
  function scan() {
    const counts = Object.fromEntries(THEME_IDS.map(id => [id, []]));
    let files = [];
    try { files = fs.readdirSync(dir); } catch { files = []; }
    for (const f of files) {
      const m = f.match(/^([a-z]+)-(\d+)\.jpg$/); if (!m || !counts[m[1]]) continue;
      if (files.includes(`${m[1]}-${m[2]}-cover.jpg`)) counts[m[1]].push(Number(m[2]));
    }
    for (const id of THEME_IDS) counts[id].sort((a, b) => a - b);
    cache = counts; return counts;
  }
  const variants = theme => (cache || scan())[theme] || [];
  function themeFor(project) {
    if (!project) return 'other';
    if (project.photo && THEME_IDS.includes(project.photo.theme)) return project.photo.theme;
    if (project.needCategory && NEED_TO_THEME[project.needCategory]) return NEED_TO_THEME[project.needCategory];
    const text = `${project.name || ''} ${project.sector || ''} ${project.summary || ''}`.toLowerCase();
    // Specific before general: "water tank for the classroom block" is water, not classrooms.
    for (const id of ['sanitation', 'water', 'electricity', 'ict', 'library', 'kitchen', 'fencing', 'furniture', 'sports', 'classrooms']) {
      const t = THEMES.find(x => x.id === id); if (t.re && t.re.test(text)) return id;
    }
    return 'other';
  }
  const hash = s => { let h = 2166136261; for (const ch of String(s || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  /** The picture for one lead on one project: pinned photo if staff chose one, else theme + rotation keyed on the lead. */
  function pick(project, { lead = null, seed = '' } = {}) {
    let theme = themeFor(project);
    let list = variants(theme);
    if (!list.length) { theme = 'other'; list = variants('other'); }
    if (!list.length) { // nothing generated yet — fall back to the legacy template files
      const legacy = (THEMES.find(t => t.id === theme) || THEMES[0]).legacy;
      return { theme, n: 0, image: `/brand/templates/${legacy}.jpg`, cover: `/brand/templates/${legacy}-cover.jpg`, legacy, pinned: false, choices: list.length };
    }
    let n;
    if (project?.photo && project.photo.theme === theme && list.includes(Number(project.photo.n))) n = Number(project.photo.n);
    else n = list[hash(`${project?.id || ''}|${lead?.id || seed || ''}`) % list.length];
    const legacy = (THEMES.find(t => t.id === theme) || THEMES[0]).legacy;
    return { theme, n, image: `/brand/photos/${theme}-${n}.jpg`, cover: `/brand/photos/${theme}-${n}-cover.jpg`, legacy, pinned: Boolean(project?.photo && project.photo.theme === theme && Number(project.photo.n) === n), choices: list.length };
  }
  /** Every photo, for the staff gallery. */
  function gallery() { const c = cache || scan(); return THEMES.map(t => ({ id: t.id, label: t.label, photos: c[t.id].map(n => ({ n, image: `/brand/photos/${t.id}-${n}.jpg` })) })); }
  function coverBuffer(picked) { try { return fs.readFileSync(path.join(dir, '..', picked.cover.replace(/^\/brand\//, ''))); } catch { return null; } }
  return { THEMES, THEME_IDS, NEED_TO_THEME, scan, variants, themeFor, pick, gallery, coverBuffer };
}

module.exports = { createLibrary, THEMES, THEME_IDS, NEED_TO_THEME };
