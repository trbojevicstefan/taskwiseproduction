import type { ChatSession } from '@/types/chat';
import type { ChatScope } from '@/types/general-chat';

export const findSessionForScope = <
  T extends Pick<ChatSession, 'scope' | 'sourceMeetingId'>,
>(
  sessions: T[],
  scope: ChatScope
): T | undefined =>
  sessions.find((session) => {
    const persisted = session.scope;
    const sourceMeetingId = session.sourceMeetingId?.trim() || '';
    if (sourceMeetingId) {
      return (
        scope.type === 'meeting' &&
        sourceMeetingId === scope.meetingId &&
        (!persisted ||
          (persisted.type === 'meeting' &&
            persisted.meetingId === scope.meetingId))
      );
    }
    if (!persisted || persisted.type !== scope.type) return false;
    switch (scope.type) {
      case 'meeting':
        return persisted.type === 'meeting' && persisted.meetingId === scope.meetingId;
      case 'client':
        return persisted.type === 'client' && persisted.clientId === scope.clientId;
      case 'person':
        return persisted.type === 'person' && persisted.personId === scope.personId;
      case 'workspace':
      case 'planner':
        return true;
    }
  });
