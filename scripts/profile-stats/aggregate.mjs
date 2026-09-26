// Turns the raw API numbers into what the receipts show. Pure functions, no I/O.

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

export const CONTRIBUTION_TYPES = ['commits', 'pullRequests', 'reviews', 'issues', 'repositories'];

// Contributions by type, public and private side by side, counted the same
// way from the repositories (commits from the stack, the rest from search).
// GitHub's own totals count slightly differently, so the rows are not meant
// to add up to them. `private` is null when no token could read private work.
export function summarizeTypes(types, stack) {
  const commits = stack.commitsByVisibility ?? { public: 0, private: 0 };
  const count = (visibility, key) => {
    if (!types[visibility]) return null;
    return key === 'commits' ? commits[visibility] : types[visibility][key] ?? 0;
  };
  return {
    items: CONTRIBUTION_TYPES.map((key) => ({ key, public: count('public', key), private: count('private', key) })),
    includesPrivate: Boolean(types.private),
    incomplete: Boolean(types.incomplete),
  };
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

// The contribution calendar's days (private contributions included, anonymously)
// as weekly totals and a few habits. The calendar starts on a Sunday, a few
// days more than a year back; the habits only look at the last `windowDays`.
export function summarizeCalendar(days, { windowDays = 365 } = {}) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  // Calendar weeks start on Sunday. A week that holds the 1st of a month
  // carries that month for the axis.
  const weeks = [];
  for (const day of sorted) {
    if (!weeks.length || weekdayOf(day.date) === 0) weeks.push({ start: day.date, count: 0, month: null });
    const week = weeks.at(-1);
    week.count += day.count;
    if (day.date.endsWith('-01')) week.month = Number(day.date.slice(5, 7)) - 1;
  }

  const recent = sorted.slice(-windowDays);
  let longestStreak = 0;
  let run = 0;
  for (const day of recent) {
    run = day.count > 0 ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  // Today may simply not have started yet, so a quiet today does not end the streak.
  let currentStreak = 0;
  let i = recent.length - 1;
  if (i >= 0 && recent[i].count === 0) i--;
  for (; i >= 0 && recent[i].count > 0; i--) currentStreak++;

  const byWeekday = Array(7).fill(0);
  let busiestDay = null;
  for (const day of recent) {
    byWeekday[weekdayOf(day.date)] += day.count;
    if (day.count > 0 && (!busiestDay || day.count > busiestDay.count)) busiestDay = day;
  }
  const top = Math.max(...byWeekday);

  return {
    weeks,
    days: recent.length,
    activeDays: recent.filter((day) => day.count > 0).length,
    longestStreak,
    currentStreak,
    busiestDay,
    busiestWeekday: top > 0 ? WEEKDAYS[byWeekday.indexOf(top)] : null,
  };
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

// Kinds of repository, in the order the receipt lists them.
export const SOURCES = ['organisation private', 'personal private', 'personal public', 'public, other owners'];

export function summarizeSources(categories = {}, totalLines) {
  return SOURCES.filter((key) => categories[key]?.commits > 0).map((key) => {
    const category = categories[key];
    const [main] = rankLanguages(category.languages).items;
    return {
      key,
      commits: category.commits,
      lines: category.lines,
      share: totalLines > 0 ? category.lines / totalLines : 0,
      main: main ?? null,
    };
  });
}

export function summarizeStack(stack, { top = 6 } = {}) {
  const hours = stack.hours ?? Array(24).fill(0);
  const busiest = Math.max(...hours);
  return {
    ...rankLanguages(stack.languages, { top }),
    commits: stack.commits,
    lines: stack.lines,
    added: stack.added,
    removed: stack.removed,
    repos: stack.reposWithCommits,
    privateRepos: stack.privateRepos,
    includesPrivate: stack.privateRepos > 0,
    capped: stack.capped,
    sources: summarizeSources(stack.categories, stack.lines),
    hours,
    peakHour: busiest > 0 ? hours.indexOf(busiest) : null,
    timeZone: stack.timeZone ?? 'UTC',
  };
}

export function buildStats(raw) {
  return {
    profile: raw.profile,
    login: raw.login,
    generatedAt: raw.generatedAt,
    contributions: summarizeContributions(raw.activity),
    types: summarizeTypes(raw.types, raw.stack),
    calendar: summarizeCalendar(raw.activity.days),
    stack: summarizeStack(raw.stack),
  };
}
