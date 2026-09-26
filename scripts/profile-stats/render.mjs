// Draws the profile cards as standalone SVG strings. Pure functions, no I/O.
//
// README images are sandboxed <img> elements: no scripts, no web fonts, no
// hover. Everything a reader needs is printed on the card, and each theme gets
// its own file so the README's <picture> can follow GitHub's light/dark mode.

export const THEMES = {
  light: {
    surface: '#fcfcfb',
    border: 'rgba(11,11,11,0.10)',
    ink: '#0b0b0b',
    ink2: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    series: ['#2a78d6', '#eb6834'],
  },
  dark: {
    surface: '#1a1a19',
    border: 'rgba(255,255,255,0.10)',
    ink: '#ffffff',
    ink2: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    series: ['#3987e5', '#d95926'],
  },
};

const WIDTH = 840;
const PAD = 24;
const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const GAP = 2; // surface gap between stacked segments

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

// Rough text width for layout decisions; system fonts average ~0.56em per glyph.
const textWidth = (text, size) => String(text).length * size * 0.56;

function truncate(text, size, maxWidth) {
  if (textWidth(text, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// Clean axis ticks: step is 1, 2, 2.5 or 5 x 10^k (2.5 only once it stays whole).
export function niceScale(max, targetTicks = 4) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const rough = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const multipliers = magnitude >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, multipliers.map((m) => m * magnitude).find((s) => s >= rough));
  return { max: Math.ceil(max / step) * step, step };
}

// Vertical bar with a 4px rounded data-end on top, square at the baseline.
function columnPath(x, y, w, h, radius = 4) {
  const r = Math.min(radius, w / 2, h);
  return `M${r2(x)},${r2(y + h)}V${r2(y + r)}A${r2(r)},${r2(r)} 0 0 1 ${r2(x + r)},${r2(y)}` +
    `H${r2(x + w - r)}A${r2(r)},${r2(r)} 0 0 1 ${r2(x + w)},${r2(y + r)}V${r2(y + h)}Z`;
}

// Horizontal bar with a 4px rounded data-end on the right, square at the baseline.
function barPath(x, y, w, h, radius = 4) {
  const r = Math.min(radius, h / 2, w);
  return `M${r2(x)},${r2(y)}H${r2(x + w - r)}A${r2(r)},${r2(r)} 0 0 1 ${r2(x + w)},${r2(y + r)}` +
    `V${r2(y + h - r)}A${r2(r)},${r2(r)} 0 0 1 ${r2(x + w - r)},${r2(y + h)}H${r2(x)}Z`;
}

function frame({ height, theme, title, desc, body }) {
  const t = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(title)}</title>
<desc id="desc">${escapeXml(desc)}</desc>
<style>
text { font-family: ${FONT}; fill: ${t.ink}; }
.title { font-size: 16px; font-weight: 600; }
.hero { font-size: 48px; font-weight: 600; }
.value { font-size: 22px; font-weight: 600; }
.label { font-size: 13px; fill: ${t.ink2}; }
.small { font-size: 12px; fill: ${t.ink2}; }
.tick { font-size: 11px; fill: ${t.muted}; font-variant-numeric: tabular-nums; }
.note { font-size: 11px; fill: ${t.muted}; }
.halo { paint-order: stroke; stroke: ${t.surface}; stroke-width: 4px; stroke-linejoin: round; }
</style>
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="8" fill="${t.surface}" stroke="${t.border}"/>
${body}
</svg>
`;
}

export function renderContributionsCard(stats, theme) {
  const t = THEMES[theme];
  const c = stats.contributions;
  const height = 248;
  const updated = stats.generatedAt.slice(0, 10);
  const parts = [];

  // Header: title left, legend right.
  parts.push(`<text x="${PAD}" y="40" class="title">Contributions</text>`);
  const legend = [['Public', t.series[0]], ['Private', t.series[1]]];
  let lx = WIDTH - PAD;
  for (const [name, color] of [...legend].reverse()) {
    lx -= textWidth(name, 12);
    parts.push(`<text x="${r2(lx)}" y="40" class="small">${name}</text>`);
    lx -= 16;
    parts.push(`<rect x="${r2(lx)}" y="31" width="10" height="10" rx="2" fill="${color}"/>`);
    lx -= 16;
  }

  // Left column: hero figure, then three stat tiles.
  parts.push(`<text x="${PAD}" y="108" class="hero">${formatNumber(c.total)}</text>`);
  parts.push(`<text x="${PAD}" y="132" class="label">All-time contributions since ${c.firstYear}</text>`);
  const tiles = [
    ['Past year', c.pastYear.total],
    ['Public', c.public],
    ['Private', c.private],
  ];
  tiles.forEach(([label, value], i) => {
    const x = PAD + i * 104;
    parts.push(`<text x="${x}" y="172" class="label">${label}</text>`);
    parts.push(`<text x="${x}" y="198" class="value">${formatNumber(value)}</text>`);
  });
  parts.push(`<text x="${PAD}" y="232" class="note">Private: contributions to private repositories, including company work · Updated ${updated}</text>`);

  // Right column: contributions per year, public stacked under private.
  const plot = { left: 400, right: WIDTH - PAD, top: 72, bottom: 196 };
  const plotW = plot.right - plot.left;
  const plotH = plot.bottom - plot.top;
  const scale = niceScale(Math.max(...c.years.map((y) => y.total)));
  const yOf = (v) => plot.bottom - (v / scale.max) * plotH;

  for (let v = 0; v <= scale.max; v += scale.step) {
    const y = r2(yOf(v));
    const stroke = v === 0 ? t.axis : t.grid;
    parts.push(`<line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" stroke="${stroke}" stroke-width="1"/>`);
    parts.push(`<text x="${plot.left - 8}" y="${r2(y + 4)}" class="tick" text-anchor="end">${formatNumber(v)}</text>`);
  }

  const slot = plotW / c.years.length;
  const barW = Math.min(24, slot * 0.6);
  const labelEvery = slot < 34 ? 2 : 1;
  const peak = c.years.reduce((best, y) => (y.total > best.total ? y : best), c.years[0]);
  const last = c.years.length - 1;

  c.years.forEach((y, i) => {
    const cx = plot.left + slot * (i + 0.5);
    const x = cx - barW / 2;
    const publicH = (y.public / scale.max) * plotH;
    const privateH = (y.private / scale.max) * plotH;
    if (publicH > 0 && privateH > 0) {
      parts.push(`<rect x="${r2(x)}" y="${r2(plot.bottom - publicH)}" width="${r2(barW)}" height="${r2(publicH)}" fill="${t.series[0]}"/>`);
      const topH = Math.max(privateH - GAP, 1);
      parts.push(`<path d="${columnPath(x, plot.bottom - publicH - GAP - topH, barW, topH)}" fill="${t.series[1]}"/>`);
    } else if (publicH > 0) {
      parts.push(`<path d="${columnPath(x, plot.bottom - publicH, barW, publicH)}" fill="${t.series[0]}"/>`);
    } else if (privateH > 0) {
      parts.push(`<path d="${columnPath(x, plot.bottom - privateH, barW, privateH)}" fill="${t.series[1]}"/>`);
    }
    if ((last - i) % labelEvery === 0) {
      parts.push(`<text x="${r2(cx)}" y="${plot.bottom + 18}" class="tick" text-anchor="middle">${y.year}</text>`);
    }
  });

  // One direct label: the busiest year.
  if (peak.total > 0) {
    const i = c.years.indexOf(peak);
    const cx = plot.left + slot * (i + 0.5);
    parts.push(`<text x="${r2(cx)}" y="${r2(yOf(peak.total) - 6)}" class="small halo" text-anchor="middle">${formatNumber(peak.total)}</text>`);
  }

  const perYear = c.years.map((y) => `${y.year}: ${formatNumber(y.total)} (${formatNumber(y.public)} public, ${formatNumber(y.private)} private)`);
  return frame({
    height,
    theme,
    title: `${stats.login}'s GitHub contributions`,
    desc: `${formatNumber(c.total)} contributions since ${c.firstYear}: ${formatNumber(c.public)} public and ` +
      `${formatNumber(c.private)} private. Past year: ${formatNumber(c.pastYear.total)}. Per year - ${perYear.join('; ')}. Updated ${updated}.`,
    body: parts.join('\n'),
  });
}

export function renderLanguagesCard(stats, theme) {
  const t = THEMES[theme];
  const { items, other } = stats.languages;
  const rows = other ? [...items, other] : items;
  const rowH = 28;
  const firstRow = 60;
  const height = rows.length ? firstRow + rows.length * rowH + 12 : 120;
  const parts = [];

  parts.push(`<text x="${PAD}" y="40" class="title">Languages</text>`);
  parts.push(`<text x="${WIDTH - PAD}" y="40" class="small" text-anchor="end">Share of code in my public repositories</text>`);

  if (!rows.length) {
    parts.push(`<text x="${PAD}" y="84" class="label">No language data yet.</text>`);
  }

  const labelW = 132;
  const barLeft = PAD + labelW + 12;
  const barMax = WIDTH - PAD - barLeft - 56; // room for the share label at the tip
  const maxShare = Math.max(...rows.map((row) => row.share), 0);
  const barH = 12;

  rows.forEach((row, i) => {
    const cy = firstRow + i * rowH + rowH / 2;
    const w = maxShare ? Math.max((row.share / maxShare) * barMax, 2) : 0;
    const fill = row === other ? t.muted : t.series[0];
    parts.push(`<text x="${PAD}" y="${r2(cy + 4.5)}" class="label" style="fill:${t.ink}">${escapeXml(truncate(row.name, 13, labelW))}</text>`);
    parts.push(`<path d="${barPath(barLeft, cy - barH / 2, w, barH)}" fill="${fill}"/>`);
    parts.push(`<text x="${r2(barLeft + w + 8)}" y="${r2(cy + 4)}" class="small">${formatShare(row.share)}</text>`);
  });

  const listed = rows.map((row) => `${row.name} ${formatShare(row.share)}`).join(', ');
  return frame({
    height,
    theme,
    title: `Languages in ${stats.login}'s public repositories`,
    desc: `Share of code by size: ${listed || 'none'}.`,
    body: parts.join('\n'),
  });
}
