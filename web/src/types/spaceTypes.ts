export interface CreateSpacePayload {
  joinCode?: string;
  participantSessionId: string;
  title?: string;
  description?: string;
}

export interface UpdateSpacePayload {
  title?: string;
  description?: string;
}

export interface ScheduleSpacePayload {
  participantSessionId: string;
  title?: string;
  description?: string;
  // ISO datetime string for when the meeting should start.
  scheduledFor: string;
  // Meeting length in minutes (drives the calendar-invite end time).
  durationMinutes?: number;
  invitees?: string[];
}

export interface ActivateSpacePayload {
  spaceId: string;
  participantSessionId: string;
}

export interface Host {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

export interface Participant {
  id: string;
  displayName: string;
  role: string;
  isActive: boolean;
  isGuest: boolean;
  joinedAt: string;
  leftAt?: string;
  connectionState?: string;
  user?: {
    id: string;
    name: string;
    avatar?: string;
  };
}

export interface Space {
  id: string;
  title: string;
  description?: string;
  joinCode: string;
  livekitRoomName?: string;
  hostId: string;
  status: string;
  scheduledFor?: string;
  invitees?: string[];
  startTime: string;
  endTime?: string;
  expiresAt?: string;
  duration?: number;
  createdAt?: string;
  participantJoinedAt?: string;
  userRole?: string;
  participantRole?: string;
  host?: Host;
  participants?: Participant[];
  _count?: {
    participants?: number;
    recordingSessions?: number;
  };
}

export interface LiveKitJoinConfig {
  url: string;
  room: string;
  token: string;
  expiresAt: string;
}

export interface SpaceResponse {
  success: boolean;
  data: Space & {
    livekit?: LiveKitJoinConfig;
  };
  message: string;
}

export interface UserSpacesResponse {
  success: boolean;
  data: {
    spaces: Space[];
    count: number;
  };
  message: string;
}
