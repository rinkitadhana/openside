import type { Participant, Space } from "./spaceTypes";

export interface JoinSpacePayload {
  displayName: string;
  participantSessionId: string;
}

export interface JoinSpaceResponse {
  success: boolean;
  data: {
    participant: Participant;
    space: Space;
    isRejoin: boolean;
  };
  message: string;
}

export interface LeaveSpacePayload {
  participantSessionId: string;
}

export interface LeaveSpaceResponse {
  success: boolean;
  data: Participant;
  message: string;
}

export interface ParticipantsListResponse {
  success: boolean;
  data: {
    participants: Participant[];
    count: number;
  };
  message: string;
}

export interface UpdateRolePayload {
  role: "CO_HOST" | "GUEST";
}

export interface UpdateRoleResponse {
  success: boolean;
  data: Participant;
  message: string;
}

export interface KickParticipantResponse {
  success: boolean;
  data: Participant;
  message: string;
}
