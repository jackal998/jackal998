// What each audience gets to see. The fetchers and aggregate.mjs collect every
// detail they can; these projections decide what leaves, so the renderer can
// only print - and the public logs can only mention - what a view hands over.
//
// The full stats go to the private weekly report (report.mjs). The profile
// README is a résumé: it keeps what shows ability and is visible on a GitHub
// profile anyway (contributions per week and in total, how consistent), the
// language mix as shares, and the main languages at work and on side
// projects. Habits and private detail stay out: contributions by type, commit
// hours, busiest days, current streak, line, commit and repository counts,
// and any number per kind of repository.

// A focus group needs this many commits before it says anything about me.
const MIN_FOCUS_COMMITS = 10;
// Languages named for a focus group: the main one, plus any other this big.
const FOCUS_SHARE = 0.15;
const FOCUS_LANGUAGES = 2;

export function publicView(stats) {
  const { contributions: c, calendar: cal, stack: s } = stats;
  return {
    profile: stats.profile,
    login: stats.login,
    generatedAt: stats.generatedAt,
    contributions: { total: c.total, public: c.public, private: c.private },
    calendar: {
      weeks: cal.weeks.map(({ start, count, month }) => ({ start, count, month })),
      days: cal.days,
      activeDays: cal.activeDays,
      longestStreak: cal.longestStreak,
    },
    stack: {
      items: s.items.map(({ name, share }) => ({ name, share })),
      other: s.other ? { name: s.other.name, share: s.other.share, count: s.other.count } : null,
      includesPrivate: s.includesPrivate,
      focus: s.focus
        .filter((group) => group.commits >= MIN_FOCUS_COMMITS)
        .map((group) => ({
          key: group.key,
          languages: group.languages
            .filter((language, i) => i === 0 || language.share >= FOCUS_SHARE)
            .slice(0, FOCUS_LANGUAGES)
            .map((language) => language.name),
        })),
    },
  };
}
