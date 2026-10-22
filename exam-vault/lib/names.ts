// Display aliases for the demo cast. The free-tier licence left us five linked accounts,
// so the committee is played by the realm users committee2/committee3; the UI shows them
// as committee1/committee2. Usernames in TideCloak, tokens and the database are unchanged.
const ALIASES: Record<string, string> = {
  committee2: 'committee1',
  committee3: 'committee2',
}

export const displayName = (username?: string | null) =>
  username ? ALIASES[username] ?? username : ''
