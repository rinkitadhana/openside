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

export interface Host {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

export interface Participant {
  id: string;
  userId: string;
  spaceId: string;
  participantSessionId: string;
  livekitIdentity?: string;
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
  startTime: string;
  endTime?: string;
  expiresAt?: string;
  duration?: number;
  host?: Host;
  participants?: Participant[];
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
