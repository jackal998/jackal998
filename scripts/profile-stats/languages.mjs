// Maps a changed file to the language it counts towards, or null when the
// file should not count (unknown type, data/prose, generated or vendored).
// Names follow GitHub Linguist so they read the same as GitHub's own bars.

const BY_EXTENSION = {
  rb: 'Ruby', rake: 'Ruby', gemspec: 'Ruby', ru: 'Ruby', jbuilder: 'Ruby', arb: 'Ruby',
  erb: 'HTML+ERB', haml: 'Haml', slim: 'Slim', liquid: 'Liquid',
  py: 'Python', pyi: 'Python',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', coffee: 'CoffeeScript',
  ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  html: 'HTML', htm: 'HTML',
  css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', scala: 'Scala', groovy: 'Groovy',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++', hxx: 'C++', ino: 'C++',
  m: 'Objective-C', mm: 'Objective-C++', cs: 'C#', fs: 'F#',
  php: 'PHP', pl: 'Perl', pm: 'Perl', lua: 'Lua', r: 'R', jl: 'Julia', dart: 'Dart',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', clj: 'Clojure', cljs: 'Clojure', hs: 'Haskell', ml: 'OCaml',
  zig: 'Zig', nim: 'Nim', elm: 'Elm', sol: 'Solidity',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'fish', ps1: 'PowerShell',
  sql: 'SQL', tf: 'HCL', hcl: 'HCL', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protocol Buffer',
  mk: 'Makefile', dockerfile: 'Dockerfile',
};

const BY_FILENAME = {
  gemfile: 'Ruby', rakefile: 'Ruby', guardfile: 'Ruby', capfile: 'Ruby', podfile: 'Ruby', brewfile: 'Ruby',
  makefile: 'Makefile', gnumakefile: 'Makefile', dockerfile: 'Dockerfile', containerfile: 'Dockerfile',
};

// Vendored, built or generated paths: changes there are not hand-written code.
const EXCLUDED = [
  /(^|\/)(node_modules|vendor|bower_components|third_party|dist|build|coverage|tmp|log|\.yarn)\//i,
  /(^|\/)public\/(assets|packs|packs-test)\//i,
  /(^|\/)__snapshots__\//i,
  /(^|\/)sorbet\/rbi\//i,
  /(^|\/)db\/(schema\.rb|structure\.sql)$/i,
  /\.min\.(js|css)$/i,
  /(_pb2\.py|\.pb\.go|\.g\.dart)$/i,
  /\.generated\.[a-z]+$/i,
];

export function languageOf(path) {
  if (EXCLUDED.some((pattern) => pattern.test(path))) return null;
  const file = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (BY_FILENAME[file]) return BY_FILENAME[file];
  const dot = file.lastIndexOf('.');
  return dot > 0 ? BY_EXTENSION[file.slice(dot + 1)] ?? null : null;
}

// One enormous file change (a data migration, a pasted fixture) should not
// outweigh months of ordinary work, so each file counts at most this much per commit.
export const MAX_LINES_PER_FILE = 1000;

export function linesChanged(file) {
  return Math.min((file.additions ?? 0) + (file.deletions ?? 0), MAX_LINES_PER_FILE);
}
