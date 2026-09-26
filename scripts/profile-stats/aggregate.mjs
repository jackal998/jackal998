// Turns the raw API numbers into what the receipt shows. Pure functions, no I/O.

function split(calendarTotal, restricted, label) {
  // The contribution calendar already counts private contributions, so the
  // private share can never exceed it. If it does, GitHub changed how these
  // fields relate and publishing would print wrong numbers - fail instead and
  // leave yesterday's receipt in place.
  if (restricted > calendarTotal) {
    throw new Error(`${label}: private contributions (${restricted}) exceed the calendar total (${calendarTotal})`);
  }
  return { total: calendarTotal, private: restricted, public: calendarTotal - restricted };
}

export function summarizeContributions(activity) {
  const years = activity.years.map((y) => ({ year: y.year, ...split(y.calendarTotal, y.restricted, String(y.year)) }));
  const sum = (key) => years.reduce((acc, y) => acc + y[key], 0);
  return {
    total: sum('total'),
    public: sum('public'),
    private: sum('private'),
    firstYear: years[0]?.year,
    pastYear: split(activity.pastYear.calendarTotal, activity.pastYear.restricted, 'past year'),
    years,
  };
}

// Years before activity really started are folded into one line ("2016-20"),
// so the receipt stays short without dropping any contributions.
export function activityRows(years, threshold = 100) {
  const start = years.findIndex((y) => y.total >= threshold);
  if (start <= 1) return years.map((y) => ({ label: String(y.year), total: y.total }));
  const early = years.slice(0, start);
  return [
    { label: `${early[0].year}-${String(early.at(-1).year).slice(2)}`, total: early.reduce((acc, y) => acc + y.total, 0) },
    ...years.slice(start).map((y) => ({ label: String(y.year), total: y.total })),
  ];
}

export function summarizeStack(stack, { top = 6 } = {}) {
  const ranked = Object.entries(stack.languages)
    .filter(([, lines]) => lines > 0)
    .map(([name, lines]) => ({ name, lines, share: stack.lines ? lines / stack.lines : 0 }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));

  // Fold the tail into "Other" only when it holds more than one language.
  const shown = ranked.length > top + 1 ? ranked.slice(0, top) : ranked;
  const rest = ranked.slice(shown.length);
  const otherLines = rest.reduce((acc, item) => acc + item.lines, 0);
  return {
    items: shown,
    other: rest.length ? { name: 'Other', lines: otherLines, share: otherLines / stack.lines, count: rest.length } : null,
    commits: stack.commits,
    lines: stack.lines,
    includesPrivate: stack.privateRepos > 0,
    capped: stack.capped,
  };
}

export function buildStats(raw) {
  const contributions = summarizeContributions(raw.activity);
  return {
    profile: raw.profile,
    login: raw.login,
    generatedAt: raw.generatedAt,
    contributions,
    activityRows: activityRows(contributions.years),
    stack: summarizeStack(raw.stack),
  };
}
