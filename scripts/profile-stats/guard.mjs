// Last line of defence against leaking private details into this public
// repository: its git history (the committed receipt) and its Actions logs
// are both public and permanent. Every text about to be published is checked
// for the names of private repositories seen during the run, and the
// organisations that own them; any hit aborts before anything is written.

export function findLeaks(text, secretNames) {
  const haystack = String(text).toLowerCase();
  return secretNames.filter((name) => name && haystack.includes(name.toLowerCase()));
}

export function assertNoLeak(label, text, secretNames) {
  const leaks = findLeaks(text, secretNames);
  if (leaks.length) {
    // Say how many, never which: the names themselves are the secret.
    throw new Error(`Refusing to publish ${label}: it mentions ${leaks.length} private name(s)`);
  }
}
