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
  return split(activity.calendarTotal, activity.restricted, 'past 12 months');
}

// { language: weight } -> the top languages by share, the tail folded into
// "Other" (only when it holds more than one language).
export function rankLanguages(weights, { top = 6 } = {}) {
  const positive = Object.entries(weights).filter(([, lines]) => lines > 0);
  const total = positive.reduce((acc, [, n]) => acc + n, 0);
  const ranked = positive
    .map(([name, lines]) => ({ name, lines, share: lines / total }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  const shown = ranked.length > top + 1 ? ranked.slice(0, top) : ranked;
  const rest = ranked.slice(shown.length);
  const otherLines = rest.reduce((acc, item) => acc + item.lines, 0);
  return {
    items: shown,
    other: rest.length ? { name: 'Other', lines: otherLines, share: otherLines / total, count: rest.length } : null,
  };
}

export function summarizeStack(stack, { top = 6 } = {}) {
  return {
    ...rankLanguages(stack.languages, { top }),
    commits: stack.commits,
    lines: stack.lines,
    includesPrivate: stack.privateRepos > 0,
    capped: stack.capped,
  };
}

export function buildStats(raw) {
  return {
    profile: raw.profile,
    login: raw.login,
    generatedAt: raw.generatedAt,
    contributions: summarizeContributions(raw.activity),
    stack: summarizeStack(raw.stack),
  };
}
