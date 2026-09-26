// Prints the profile header and two receipts (activity and stack) as
// standalone SVG strings. No network, no I/O beyond reading the bundled fonts.
//
// README images are sandboxed <img> elements: no scripts and no external
// fonts, so the fonts are subset and embedded as data URIs (see fonts/). Each
// theme gets its own file so the README's <picture> can follow GitHub's mode.

import { readFileSync } from 'node:fs';
import { CONTRIBUTION_TYPES } from './aggregate.mjs';

const FONTS = new URL('./fonts/', import.meta.url);
const METRICS = JSON.parse(readFileSync(new URL('metrics.json', FONTS), 'utf8'));
const FONT_FILES = {
  mono400: ['Receipt', 400, 'space-mono-400.woff2'],
  mono700: ['Receipt', 700, 'space-mono-700.woff2'],
  barcode: ['Barcode', 400, 'libre-barcode-39-text-400.woff2'],
};
const fontFaces = (keys) => keys.map((key) => {
  const [family, weight, file] = FONT_FILES[key];
  const data = readFileSync(new URL(file, FONTS)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')}`;
}).join('');

// paper/ink/dim/rule print the receipts; page is the header's ink on GitHub's own background.
export const THEMES = {
  light: { paper: '#fffdf7', ink: '#23211c', dim: '#6f6a5f', rule: '#b9b3a4', shadow: 'rgba(0,0,0,0.14)', page: '#1f2328' },
  dark: { paper: '#ebe7db', ink: '#1d1b16', dim: '#5f5a4f', rule: '#a39d8e', shadow: 'rgba(0,0,0,0.6)', page: '#f0f6fc' },
};

// Two receipts side by side fit GitHub's profile README column (about 850px);
// narrower screens stack them.
const WIDTH = 410;
const EDGE = 16; // room around the paper for its shadow
const PAD = 36; // text inset from the image edge
const LEFT = PAD;
const RIGHT = WIDTH - PAD;
const MID = RIGHT - 62; // right edge of a middle column, before a share column

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
const pad2 = (n) => String(n).padStart(2, '0');

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

// "GMT+8" for the time zone commit hours are counted in.
function offsetName(timeZone, at) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

// Column with a rounded data-end on top, square at the baseline.
function columnPath(x, y, w, h, radius = 4) {
  const r = Math.min(radius, w / 2, h);
  return `M${r2(x)},${r2(y + h)}V${r2(y + r)}A${r2(r)},${r2(r)} 0 0 1 ${r2(x + r)},${r2(y)}` +
    `H${r2(x + w - r)}A${r2(r)},${r2(r)} 0 0 1 ${r2(x + w)},${r2(y + r)}V${r2(y + h)}Z`;
}

// Prints lines top to bottom; callers move `y` to the next baseline.
class Printer {
  constructor(t) {
    this.t = t;
    this.out = [];
    this.y = 0;
  }

  text(x, text, { anchor = 'start', cls = '', style = '' } = {}) {
    this.out.push(`<text x="${r2(x)}" y="${r2(this.y)}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}` +
      `${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}>${escapeXml(text)}</text>`);
  }

  center(text, cls = '') { this.text(WIDTH / 2, text, { anchor: 'middle', cls }); }

  pair(left, right, cls = '') {
    this.text(LEFT, left, { cls });
    this.text(RIGHT, right, { anchor: 'end', cls });
  }

  // Bold section name on the left, column captions on the right.
  heading(left, right, mid = null) {
    this.text(LEFT, left, { cls: 'b' });
    if (mid !== null) this.text(MID, mid, { anchor: 'end', cls: 'note' });
    this.text(RIGHT, right, { anchor: 'end', cls: 'note' });
  }

  dashed() {
    this.out.push(`<line x1="${LEFT}" y1="${this.y}" x2="${RIGHT}" y2="${this.y}" stroke="${this.t.rule}" stroke-dasharray="4 4"/>`);
  }

  double() {
    this.out.push(`<line x1="${LEFT}" y1="${this.y}" x2="${RIGHT}" y2="${this.y}" stroke="${this.t.ink}"/>` +
      `<line x1="${LEFT}" y1="${this.y + 3}" x2="${RIGHT}" y2="${this.y + 3}" stroke="${this.t.ink}"/>`);
  }

  // label ....... [mid] value, with a dotted leader; optional share bar underneath.
  item(label, value, { bold = false, size = 13, mid = null, bar = null } = {}) {
    const font = bold ? 'mono700' : 'mono400';
    const style = `font-size:${size}px${bold ? ';font-weight:700' : ''}`;
    const end = mid === null ? RIGHT : MID;
    const firstWidth = measure(mid ?? value, font, size);
    const shown = truncate(label, font, size, end - LEFT - firstWidth - 24);
    const x1 = LEFT + measure(shown, font, size) + 6;
    const x2 = end - firstWidth - 6;
    this.text(LEFT, shown, { style });
    if (x2 > x1) {
      this.out.push(`<line x1="${r2(x1)}" y1="${this.y - 3}" x2="${r2(x2)}" y2="${this.y - 3}" stroke="${this.t.rule}" stroke-dasharray="1 4" stroke-linecap="round"/>`);
    }
    if (mid !== null) this.text(MID, mid, { anchor: 'end', style });
    this.text(RIGHT, value, { anchor: 'end', style });
    if (bar !== null) {
      this.out.push(`<rect x="${LEFT}" y="${this.y + 6}" width="${r2(Math.max((RIGHT - LEFT) * bar, 1.5))}" height="3" fill="${this.t.ink}"/>`);
    }
  }

  // One series of thin columns on a hairline baseline: the peak is labelled
  // with its value, `labels` name a few columns underneath.
  columns(values, { height, labels = [] }) {
    const slot = (RIGHT - LEFT) / values.length;
    const width = Math.min(slot - 2, 24); // 2px of paper between neighbours
    const max = Math.max(0, ...values);
    const base = this.y + 14 + height; // 14px above the tallest column for its label
    const clampX = (x, text) => {
      const half = measure(text, 'mono400', 10) / 2;
      return Math.min(Math.max(x, LEFT + half), RIGHT - half);
    };
    values.forEach((value, i) => {
      if (!(value > 0)) return;
      const h = Math.max((value / max) * height, 1.5);
      this.out.push(`<path d="${columnPath(LEFT + i * slot + (slot - width) / 2, base - h, width, h)}" fill="${this.t.ink}"/>`);
    });
    this.out.push(`<line x1="${LEFT}" y1="${base + 0.5}" x2="${RIGHT}" y2="${base + 0.5}" stroke="${this.t.rule}"/>`);
    this.y = base - height - 4;
    if (max > 0) {
      const peak = formatNumber(max);
      this.text(clampX(LEFT + (values.indexOf(max) + 0.5) * slot, peak), peak, { anchor: 'middle', cls: 'tiny' });
    }
    this.y = base + 14;
    for (const { index, text } of labels) {
      this.text(clampX(LEFT + (index + 0.5) * slot, text), text, { anchor: 'middle', cls: 'tiny dim' });
    }
  }
}

function paper(t, height) {
  const teeth = 21;
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

function svg({ width, height, title, desc, style, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(title)}</title>
<desc id="desc">${escapeXml(desc)}</desc>
<style>${style}</style>
${body}
</svg>
`;
}

const receiptStyle = (t) => `${fontFaces(['mono400', 'mono700', 'barcode'])}
text { font-family: Receipt, ui-monospace, monospace; font-size: 13px; fill: ${t.ink}; }
.b { font-weight: 700; }
.title { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
.role { font-size: 12px; letter-spacing: 3px; }
.small { font-size: 12px; }
.note { font-size: 11px; fill: ${t.dim}; }
.tiny { font-size: 10px; }
.dim { fill: ${t.dim}; }
.barcode { font-family: Barcode; font-size: 56px; }
.print { animation: print 1.4s cubic-bezier(.2,.8,.2,1) backwards; }
@keyframes print { from { transform: translateY(-40px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .print { animation: none; } }`;

// Body grows from the top; the footer sits at the bottom of the paper, so two
// receipts printed to the same height line up.
function receipt(t, { body, footer, footerHeight, height, delay, title, desc }) {
  return svg({
    width: WIDTH,
    height,
    title,
    desc,
    style: receiptStyle(t),
    body: `${paper(t, height)}
<g class="print"${delay ? ` style="animation-delay:${delay}s"` : ''}>
${body.out.join('\n')}
<g transform="translate(0,${height - 40 - footerHeight})">
${footer.out.join('\n')}
</g>
</g>`,
  });
}

const TYPE_LABELS = {
  commits: 'COMMITS',
  pullRequests: 'PULL REQUESTS',
  reviews: 'CODE REVIEWS',
  issues: 'ISSUES',
  repositories: 'NEW REPOSITORIES',
};

const SOURCE_LABELS = {
  'organisation private': 'ORG REPOS, PRIVATE',
  'personal private': 'MY REPOS, PRIVATE',
  'personal public': 'MY REPOS, PUBLIC',
  'public, other owners': 'OTHER REPOS, PUBLIC',
};

const MONTHS = 'JFMAMJJASOND';

function layoutActivity(stats, t) {
  const c = stats.contributions;
  const types = stats.types;
  const cal = stats.calendar;
  const s = stats.stack;
  const p = new Printer(t);

  p.y = 50; p.center(stats.profile.name.toUpperCase(), 'title');
  p.y += 22; p.center(stats.profile.role.toUpperCase(), 'role');
  p.y += 18; p.center(`github.com/${stats.login}`, 'small dim');
  p.y += 18; p.dashed();
  p.y += 20; p.pair(stats.generatedAt.slice(0, 10), `NO. ${String(c.total).padStart(6, '0')}`, 'small dim');
  p.y += 12; p.dashed();

  // Every contribution GitHub counted, private ones included, week by week.
  p.y += 26; p.heading('ACTIVITY', 'CONTRIBUTIONS / WEEK');
  p.y += 4; p.columns(cal.weeks.map((w) => w.count), {
    height: 48,
    labels: cal.weeks.flatMap((w, index) => (w.month === null ? [] : [{ index, text: MONTHS[w.month] }])),
  });

  // GitHub only itemises public contributions; PRIVATE follows as one line.
  p.y += 26; p.heading('PUBLIC, BY TYPE', 'QTY');
  p.y += 4;
  for (const key of CONTRIBUTION_TYPES) {
    p.y += 20; p.item(TYPE_LABELS[key], formatNumber(types.items.find((i) => i.key === key).count));
  }
  if (types.other) { p.y += 20; p.item('OTHER', formatNumber(types.other)); }
  p.y += 14; p.dashed();
  p.y += 22; p.item('PUBLIC', formatNumber(c.public));
  p.y += 20; p.item('PRIVATE', formatNumber(c.private));
  p.y += 12; p.double();
  p.y += 30; p.item('TOTAL', formatNumber(c.total), { bold: true, size: 20 });
  p.y += 12; p.double();

  p.y += 34; p.heading('HABITS', 'PAST 12 MONTHS');
  p.y += 4;
  p.y += 20; p.item('ACTIVE DAYS', `${formatNumber(cal.activeDays)} OF ${formatNumber(cal.days)}`);
  p.y += 20; p.item('LONGEST STREAK', `${formatNumber(cal.longestStreak)} DAYS`);
  p.y += 20; p.item('CURRENT STREAK', `${formatNumber(cal.currentStreak)} DAYS`);
  if (cal.busiestDay) { p.y += 20; p.item('BUSIEST DAY', `${cal.busiestDay.date} · ${formatNumber(cal.busiestDay.count)}`); }
  if (cal.busiestWeekday) { p.y += 20; p.item('BUSIEST WEEKDAY', cal.busiestWeekday); }

  // When the commits read for the stack were made, in the profile's time zone.
  const zone = offsetName(s.timeZone, new Date(stats.generatedAt));
  p.y += 34; p.heading('COMMIT HOURS', zone);
  p.y += 4; p.columns(s.hours, {
    height: 40,
    labels: [0, 6, 12, 18].map((h) => ({ index: h, text: pad2(h) })),
  });
  if (s.peakHour !== null) {
    p.y += 24; p.item('PEAK HOUR', `${pad2(s.peakHour)}:00-${pad2((s.peakHour + 1) % 24)}:00`);
  }

  const f = new Printer(t);
  if (c.private > 0 && stats.profile.footnote) { f.y = 11; f.center(`* ${stats.profile.footnote.toUpperCase()} *`, 'note'); }

  const typeText = CONTRIBUTION_TYPES.map((key) => `${TYPE_LABELS[key].toLowerCase()} ${formatNumber(types.items.find((i) => i.key === key).count)}`).join(', ');
  const desc = `${formatNumber(c.total)} GitHub contributions in the past 12 months ` +
    `(${formatNumber(c.public)} public, ${formatNumber(c.private)} private). Public ones by type: ${typeText}` +
    `${types.other ? `, other ${formatNumber(types.other)}` : ''}. ` +
    `Active on ${cal.activeDays} of ${cal.days} days, longest streak ${cal.longestStreak} days` +
    `${cal.busiestWeekday ? `, busiest on ${cal.busiestWeekday.toLowerCase()}s` : ''}. ` +
    `${s.peakHour !== null ? `Most commits between ${pad2(s.peakHour)}:00 and ${pad2((s.peakHour + 1) % 24)}:00 (${zone}). ` : ''}` +
    `Updated ${stats.generatedAt.slice(0, 10)}.`;

  return { body: p, footer: f, footerHeight: f.y + 4, title: `${stats.profile.name} - GitHub activity`, desc };
}

function layoutStack(stats, t) {
  const s = stats.stack;
  const p = new Printer(t);

  p.y = 50; p.center('STACK', 'title');
  p.y += 22; p.center('LINES I CHANGED', 'role');
  p.y += 18; p.center(s.includesPrivate ? 'public + private repositories' : 'public repositories only', 'small dim');
  p.y += 18; p.dashed();
  const rows = s.other ? [...s.items, s.other] : s.items;
  p.y += 20; p.pair(stats.generatedAt.slice(0, 10), `ITEMS ${rows.length}`, 'small dim');
  p.y += 12; p.dashed();

  // Languages of the lines this person changed in their own commits.
  p.y += 26; p.heading('LANGUAGE', 'SHARE', 'LINES');
  p.y += 4;
  if (!rows.length) { p.y += 24; p.center('NO CODE CHANGES FOUND', 'small dim'); }
  for (const row of rows) {
    p.y += 24; p.item(row.name.toUpperCase(), formatShare(row.share), { mid: formatNumber(row.lines), bar: row.share });
  }
  p.y += 22; p.dashed();
  p.y += 22; p.item('ADDED', `+${formatNumber(s.added)}`);
  p.y += 20; p.item('REMOVED', `-${formatNumber(s.removed)}`);
  p.y += 12; p.double();
  p.y += 28; p.item('LINES CHANGED', formatNumber(s.lines), { bold: true, size: 18 });
  p.y += 12; p.double();

  // Where those lines were changed, by kind of repository - never by name.
  if (s.sources.length) {
    p.y += 34; p.heading('SOURCE', 'LINES', 'COMMITS');
    p.y += 4;
    for (const source of s.sources) {
      p.y += 22; p.item(SOURCE_LABELS[source.key], formatShare(source.share), { mid: formatNumber(source.commits) });
      if (source.main) { p.y += 15; p.text(LEFT + 12, `mostly ${source.main.name}, ${formatShare(source.main.share)}`, { cls: 'note' }); }
    }
    p.y += 16; p.dashed();
  }
  p.y += 22; p.item('COMMITS READ', formatNumber(s.commits));
  p.y += 20; p.item('REPOSITORIES', s.privateRepos ? `${formatNumber(s.repos)} (${formatNumber(s.privateRepos)} PRIVATE)` : formatNumber(s.repos));
  p.y += 20; p.item('LINES PER COMMIT', s.commits ? formatNumber(Math.round(s.lines / s.commits)) : '0');

  const f = new Printer(t);
  f.y = 50; f.text(WIDTH / 2, barcodeText(stats.login), { anchor: 'middle', cls: 'barcode' });
  f.y += 34; f.center('THANK YOU FOR VISITING', 'role b');
  f.y += 18; f.center('printed daily from GitHub data', 'note');

  const stackText = rows.map((row) => `${row.name} ${formatShare(row.share)}`).join(', ') || 'none';
  const sourceText = s.sources.map((source) => `${SOURCE_LABELS[source.key].toLowerCase()} ${formatShare(source.share)}` +
    `${source.main ? ` (mostly ${source.main.name})` : ''}`).join(', ');
  const desc = `Languages of the ${formatNumber(s.lines)} lines I changed in the past 12 months ` +
    `(${formatNumber(s.added)} added, ${formatNumber(s.removed)} removed, ${formatNumber(s.commits)} commits): ${stackText}. ` +
    `${sourceText ? `By kind of repository: ${sourceText}. ` : ''}Updated ${stats.generatedAt.slice(0, 10)}.`;

  return { body: p, footer: f, footerHeight: f.y + 4, title: `${stats.profile.name} - languages I changed`, desc };
}

// Both receipts, printed to the same height so they line up side by side.
export function renderReceipts(stats, theme) {
  const t = THEMES[theme];
  const activity = layoutActivity(stats, t);
  const stack = layoutStack(stats, t);
  const height = Math.ceil(Math.max(...[activity, stack].map((r) => r.body.y + 48 + r.footerHeight + 40)));
  return {
    activity: receipt(t, { ...activity, height }),
    stack: receipt(t, { ...stack, height, delay: 0.15 }),
  };
}

// The name, and the role as a barcode that types itself out.
export function renderHeader(stats, theme) {
  const t = THEMES[theme];
  const { name, role } = stats.profile;
  const code = role.toUpperCase().replace(/[^A-Z0-9 .$/+%-]/g, '-');
  const width = Math.ceil(Math.max(measure(name, 'mono700', 40), measure(code, 'barcode', 64)) + 32);
  const chars = [...code].map((ch, i) =>
    `<tspan class="type" style="animation-delay:${(0.4 + i * 0.07).toFixed(2)}s">${escapeXml(ch)}</tspan>`).join('');
  return svg({
    width,
    height: 150,
    title: `${name}, ${role}`,
    desc: `${name}. ${role}, printed as a barcode.`,
    style: `${fontFaces(['mono700', 'barcode'])}
text { fill: ${t.page}; }
.name { font-family: Receipt, ui-monospace, monospace; font-size: 40px; font-weight: 700; }
.code { font-family: Barcode; font-size: 64px; }
.type { animation: type 0s backwards; }
@keyframes type { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .type { animation: none; } }`,
    body: `<text x="${width / 2}" y="46" text-anchor="middle" class="name">${escapeXml(name)}</text>
<text x="${width / 2}" y="124" text-anchor="middle" class="code">${chars}</text>`,
  });
}
