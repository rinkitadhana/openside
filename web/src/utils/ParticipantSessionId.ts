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
