export interface CreateSpacePayload {
  joinCode: string;
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
  displayName: string;
  role: string;
  isActive: boolean;
  isGuest: boolean;
  joinedAt: string;
  leftAt?: string;
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
  hostId: string;
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  host?: Host;
  participants?: Participant[];
}

export interface SpaceResponse {
  success: boolean;
  data: Space;
  message: string;
}
