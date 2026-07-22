const SESSION_KEY_PREFIX = 'PARTICIPANT_SESSION_ID';

export function getOrCreateSessionId(spaceId: string): string {
  if (!spaceId) {
    throw new Error('spaceId is required');
  }

  const sessionKey = `${SESSION_KEY_PREFIX}_${spaceId}`;

  let sessionId = localStorage.getItem(sessionKey);

  if (sessionId) {
    return sessionId;
  }

  sessionId = crypto.randomUUID();
  localStorage.setItem(sessionKey, sessionId);

  return sessionId;
}

export function clearSessionId(spaceId: string): void {
  if (!spaceId) {
    throw new Error('spaceId is required');
  }

  const sessionKey = `${SESSION_KEY_PREFIX}_${spaceId}`;
  localStorage.removeItem(sessionKey);
}

export function getSessionId(spaceId: string): string | null {
  if (!spaceId) {
    throw new Error('spaceId is required');
  }

  const sessionKey = `${SESSION_KEY_PREFIX}_${spaceId}`;
  return localStorage.getItem(sessionKey);
}

export function clearAllSessionIds(): void {
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith(SESSION_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
}
