// Prints the profile receipt as a standalone SVG string. No network, no I/O
// beyond reading the bundled fonts.
//
// README images are sandboxed <img> elements: no scripts and no external
// fonts, so the fonts are subset and embedded as data URIs (see fonts/). Each
// theme gets its own file so the README's <picture> can follow GitHub's mode.

import { readFileSync } from 'node:fs';

const FONTS = new URL('./fonts/', import.meta.url);
const METRICS = JSON.parse(readFileSync(new URL('metrics.json', FONTS), 'utf8'));
const fontData = (file) => readFileSync(new URL(file, FONTS)).toString('base64');
const FONT_FACES = [
  ['Receipt', 400, 'space-mono-400.woff2'],
  ['Receipt', 700, 'space-mono-700.woff2'],
  ['Barcode', 400, 'libre-barcode-39-text-400.woff2'],
].map(([family, weight, file]) =>
  `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fontData(file)}) format('woff2')}`).join('');

export const THEMES = {
  light: { paper: '#fffdf7', ink: '#23211c', dim: '#6f6a5f', rule: '#b9b3a4', shadow: 'rgba(0,0,0,0.14)' },
  dark: { paper: '#ebe7db', ink: '#1d1b16', dim: '#5f5a4f', rule: '#a39d8e', shadow: 'rgba(0,0,0,0.6)' },
};

const WIDTH = 460;
const EDGE = 16; // room around the paper for its shadow
const PAD = 40; // text inset from the paper edge

const numberFormat = new Intl.NumberFormat('en-US');
export const formatNumber = (n) => numberFormat.format(n);

export function formatShare(share) {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const r2 = (n) => Math.round(n * 100) / 100;

// Exact advance width from the embedded font's metrics.
export function measure(text, font, size) {
  const { upem, advances } = METRICS[font];
  let units = 0;
  for (const ch of String(text)) units += advances[ch] ?? upem * 0.6;
  return (units / upem) * size;
}

function truncate(text, font, size, maxWidth) {
  if (measure(text, font, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, font, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// Code 39 only encodes A-Z, 0-9 and a few symbols.
const barcodeText = (login) => `*${login.toUpperCase().replace(/[^A-Z0-9 .$/+%-]/g, '-')}*`;

function paper(t, height) {
  const teeth = 22;
  const tooth = (WIDTH - 2 * EDGE) / teeth;
  const depth = 6;
  const bottom = height - EDGE;
  let top = `M${EDGE},${depth}`;
  let bot = '';
  for (let i = 0; i < teeth; i++) top += `L${r2(EDGE + tooth * (i + 0.5))},0L${r2(EDGE + tooth * (i + 1))},${depth}`;
  for (let i = teeth; i > 0; i--) bot += `L${r2(EDGE + tooth * (i - 0.5))},${bottom}L${r2(EDGE + tooth * (i - 1))},${bottom - depth}`;
  return `<defs><filter id="shadow" x="-10%" y="-5%" width="120%" height="110%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="${t.shadow}"/></filter></defs>
<path d="${top}L${WIDTH - EDGE},${bottom - depth}${bot}Z" fill="${t.paper}" filter="url(#shadow)"/>`;
}

export function renderReceipt(stats, theme) {
  const t = THEMES[theme];
  const c = stats.contributions;
  const s = stats.stack;
  const updated = stats.generatedAt.slice(0, 10);
  const out = [];
  let y = 0;

  const center = (text, cls = '') => out.push(`<text x="${WIDTH / 2}" y="${y}" text-anchor="middle" class="${cls}">${escapeXml(text)}</text>`);
  const dashed = () => out.push(`<line x1="${PAD}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}" stroke="${t.rule}" stroke-dasharray="4 4"/>`);
  const double = () => out.push(`<line x1="${PAD}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}" stroke="${t.ink}"/>` +
    `<line x1="${PAD}" y1="${y + 3}" x2="${WIDTH - PAD}" y2="${y + 3}" stroke="${t.ink}"/>`);
  const heading = (left, right) => out.push(`<text x="${PAD}" y="${y}" class="b">${escapeXml(left)}</text>` +
    `<text x="${WIDTH - PAD}" y="${y}" text-anchor="end" class="note">${escapeXml(right)}</text>`);

  // label ....... value, with a dotted leader; optional share bar underneath.
  const item = (label, value, { bold = false, size = 13, bar = null } = {}) => {
    const font = bold ? 'mono700' : 'mono400';
    const valueWidth = measure(value, font, size);
    const shown = truncate(label, font, size, WIDTH - 2 * PAD - valueWidth - 24);
    const x1 = PAD + measure(shown, font, size) + 6;
    const x2 = WIDTH - PAD - valueWidth - 6;
    const style = `font-size:${size}px${bold ? ';font-weight:700' : ''}`;
    out.push(`<text x="${PAD}" y="${y}" style="${style}">${escapeXml(shown)}</text>`);
    if (x2 > x1) {
      out.push(`<line x1="${r2(x1)}" y1="${y - 3}" x2="${r2(x2)}" y2="${y - 3}" stroke="${t.rule}" stroke-dasharray="1 4" stroke-linecap="round"/>`);
    }
    out.push(`<text x="${WIDTH - PAD}" y="${y}" text-anchor="end" style="${style}">${escapeXml(value)}</text>`);
    if (bar !== null) {
      out.push(`<rect x="${PAD}" y="${y + 6}" width="${r2(Math.max((WIDTH - 2 * PAD) * bar, 1.5))}" height="3" fill="${t.ink}"/>`);
    }
  };

  // Header
  y = 54; center(stats.profile.name.toUpperCase(), 'name');
  y += 24; center(stats.profile.role.toUpperCase(), 'role');
  y += 18; center(`github.com/${stats.login}`, 'small dim');
  y += 20; dashed();
  y += 22;
  out.push(`<text x="${PAD}" y="${y}" class="small dim">${updated}</text>` +
    `<text x="${WIDTH - PAD}" y="${y}" text-anchor="end" class="small dim">NO. ${String(c.total).padStart(6, '0')}</text>`);
  y += 14; dashed();

  // Activity: every contribution GitHub counted in the past 12 months, private ones included.
  y += 26; heading('ACTIVITY', 'GITHUB CONTRIBUTIONS, 12 MO');
  y += 8;
  y += 20; item('PUBLIC', formatNumber(c.public));
  y += 20; item('PRIVATE', formatNumber(c.private));
  y += 12; double();
  y += 30; item('TOTAL', formatNumber(c.total), { bold: true, size: 20 });
  y += 12; double();

  // Stack: languages of the lines this person changed.
  y += 34; heading('STACK', 'LINES I CHANGED, 12 MO');
  y += 8;
  const rows = s.other ? [...s.items, s.other] : s.items;
  if (!rows.length) { y += 24; center('NO CODE CHANGES FOUND', 'small dim'); }
  for (const row of rows) { y += 24; item(row.name.toUpperCase(), formatShare(row.share), { bar: row.share }); }
  y += 20; dashed();
  y += 22; item('COMMITS READ', formatNumber(s.commits));
  y += 20; item('LINES CHANGED', formatNumber(s.lines));
  y += 20; item('REPOSITORIES', s.includesPrivate ? 'PUBLIC + PRIVATE' : 'PUBLIC ONLY');

  // Footer
  y += 74; out.push(`<text x="${WIDTH / 2}" y="${y}" text-anchor="middle" class="barcode">${escapeXml(barcodeText(stats.login))}</text>`);
  y += 34; center('THANK YOU FOR VISITING', 'role b');
  y += 18; center('printed daily from GitHub data', 'note');
  const height = y + 40;

  const stackText = rows.map((row) => `${row.name} ${formatShare(row.share)}`).join(', ') || 'none';
  const desc = `${formatNumber(c.total)} GitHub contributions in the past 12 months ` +
    `(${formatNumber(c.public)} public, ${formatNumber(c.private)} private). ` +
    `Languages by lines changed in the same period: ${stackText}. Updated ${updated}.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(`${stats.profile.name} - GitHub receipt`)}</title>
<desc id="desc">${escapeXml(desc)}</desc>
<style>${FONT_FACES}
text { font-family: Receipt, ui-monospace, monospace; font-size: 13px; fill: ${t.ink}; }
.b { font-weight: 700; }
.name { font-size: 24px; font-weight: 700; letter-spacing: 1px; }
.role { font-size: 12px; letter-spacing: 3px; }
.small { font-size: 12px; }
.note { font-size: 11px; fill: ${t.dim}; }
.dim { fill: ${t.dim}; }
.barcode { font-family: Barcode; font-size: 56px; }
.print { animation: print 1.4s cubic-bezier(.2,.8,.2,1) backwards; }
@keyframes print { from { transform: translateY(-40px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .print { animation: none; } }
</style>
${paper(t, height)}
<g class="print">
${out.join('\n')}
</g>
</svg>
`;
}
