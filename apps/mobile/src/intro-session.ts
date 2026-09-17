let hasPlayedCinematicIntroThisSession = false;

export function getHasPlayedIntroThisSession(): boolean {
  return hasPlayedCinematicIntroThisSession;
}

export function markIntroAsPlayed(): void {
  hasPlayedCinematicIntroThisSession = true;
}

export function resetIntroSessionForTesting(): void {
  hasPlayedCinematicIntroThisSession = false;
}
