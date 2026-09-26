// Turns the raw API numbers into what the cards show. Pure functions, no I/O.

function split(calendarTotal, restricted, label) {
  // The contribution calendar already counts private contributions, so the
  // private share can never exceed it. If it does, GitHub changed how these
  // fields relate and publishing would print wrong numbers - fail instead and
  // leave yesterday's cards in place.
  if (restricted > calendarTotal) {
    throw new Error(`${label}: private contributions (${restricted}) exceed the calendar total (${calendarTotal})`);
  }
  return { total: calendarTotal, private: restricted, public: calendarTotal - restricted };
}

export function summarizeContributions(raw) {
  const years = raw.years.map((y) => ({ year: y.year, ...split(y.calendarTotal, y.restricted, String(y.year)) }));
  const sum = (key) => years.reduce((acc, y) => acc + y[key], 0);
  return {
    total: sum('total'),
    public: sum('public'),
    private: sum('private'),
    firstYear: years[0]?.year,
    pastYear: split(raw.pastYear.calendarTotal, raw.pastYear.restricted, 'past year'),
    years,
  };
}

export function summarizeLanguages(repos, { top = 6 } = {}) {
  const sizes = new Map();
  for (const repo of repos) {
    for (const { name, size } of repo.languages) sizes.set(name, (sizes.get(name) ?? 0) + size);
  }
  const totalSize = [...sizes.values()].reduce((acc, size) => acc + size, 0);
  const ranked = [...sizes]
    .map(([name, size]) => ({ name, size, share: totalSize ? size / totalSize : 0 }))
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

  // Fold the tail into "Other" only when it holds more than one language;
  // a single leftover language keeps its own name.
  const shown = ranked.length > top + 1 ? ranked.slice(0, top) : ranked;
  const rest = ranked.slice(shown.length);
  const otherSize = rest.reduce((acc, item) => acc + item.size, 0);
  return {
    totalSize,
    items: shown,
    other: rest.length ? { name: 'Other', size: otherSize, share: otherSize / totalSize, count: rest.length } : null,
  };
}

export function buildStats(raw) {
  return {
    login: raw.login,
    generatedAt: raw.generatedAt,
    contributions: summarizeContributions(raw),
    languages: summarizeLanguages(raw.repos),
  };
}
