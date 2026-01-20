// Enums
export type RecordingType = "AUDIO" | "VIDEO";
export type RecordingSessionStatus = "ACTIVE" | "STOPPED" | "PROCESSING" | "READY" | "FAILED";
export type RecordingFileStatus = "UPLOADING" | "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
export type SegmentStatus = "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED";
export type VideoQuality = "P360" | "P480" | "P720" | "P1080" | "P1440" | "P2160";
export type AudioQuality = "SR_22050" | "SR_44100" | "SR_48000" | "SR_96000";

// RecordingSession
export interface RecordingSession {
  id: string;
  spaceId: string;
  spaceRecordingSessionId: string;
  startedAt: string;
  stoppedAt?: string;
  status: RecordingSessionStatus;
  createdAt: string;
  space?: {
    id: string;
    title: string;
    joinCode: string;
    hostId?: string;
  };
  participantRecordings?: ParticipantRecording[];
}

// ParticipantRecording
export interface ParticipantRecording {
  id: string;
  recordingSessionId: string;
  participantId: string;
  type: RecordingType;
  isScreenShare: boolean;
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoQuality?: VideoQuality;
  audioQuality?: AudioQuality;
  videoLabel?: string;
  audioLabel?: string;
  startOffsetMs?: number;
  durationMs?: number;
  lastChunkAt?: string;
  mergedFileKey?: string;
  fileSize?: string;
  checksum?: string;
  mimeType?: string;
  status: RecordingFileStatus;
  processingJobId?: string;
  processingError?: string;
  expectedSegments?: number;
  uploadedSegments: number;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
  participant?: {
    id: string;
    displayName?: string;
    spaceId?: string;
    role?: string;
    user?: {
      id: string;
      name: string;
      avatar?: string;
    };
  };
  recordingSession?: {
    id: string;
    spaceRecordingSessionId: string;
    spaceId: string;
    status: RecordingSessionStatus;
  };
  segments?: RecordingSegmentSummary[];
}

export interface RecordingSegmentSummary {
  id: string;
  sequenceNumber: number;
  status: SegmentStatus;
}

// RecordingSegment
export interface RecordingSegment {
  id: string;
  participantRecordingId: string;
  spaceRecordingSessionId: string;
  spaceId: string;
  participantId: string;
  sequenceNumber: number;
  assetKey: string;
  startMs: number;
  durationMs: number;
  sizeBytes: string;
  checksum?: string;
  uploadedAt: string;
  status: SegmentStatus;
}

// Payloads
export interface StartSessionPayload {
  spaceId: string;
  spaceRecordingSessionId: string;
  participantSessionId: string;
}

export interface StopSessionPayload {
  spaceId: string;
  participantSessionId: string;
}

export interface CreateParticipantRecordingPayload {
  recordingSessionId: string;
  spaceId: string;
  participantId?: string;
  participantSessionId?: string;
  type: RecordingType;
  isScreenShare?: boolean;
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

export interface UpdateParticipantRecordingPayload {
  participantSessionId?: string;
  spaceId?: string;
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
  videoQuality?: VideoQuality;
  audioQuality?: AudioQuality;
  videoLabel?: string;
  audioLabel?: string;
  startOffsetMs?: number;
  durationMs?: number;
  expectedSegments?: number;
}

export interface MarkRecordingCompletePayload {
  expectedSegments: number;
  participantSessionId?: string;
  spaceId?: string;
}

export interface CreateSegmentPayload {
  participantRecordingId: string;
  spaceRecordingSessionId: string;
  spaceId: string;
  participantId?: string;
  participantSessionId?: string;
  sequenceNumber: number;
  assetKey: string;
  startMs: number;
  durationMs: number;
  sizeBytes: number;
  checksum?: string;
}

// Responses
export interface StartSessionResponse {
  success: boolean;
  data: RecordingSession;
  message: string;
}

export interface StopSessionResponse {
  success: boolean;
  data: RecordingSession;
  message: string;
}

export interface GetSessionResponse {
  success: boolean;
  data: RecordingSession;
  message: string;
}

export interface GetSessionsListResponse {
  success: boolean;
  data: {
    sessions: RecordingSession[];
    count: number;
  };
  message: string;
}

export interface CreateParticipantRecordingResponse {
  success: boolean;
  data: ParticipantRecording;
  message: string;
}

export interface UpdateParticipantRecordingResponse {
  success: boolean;
  data: ParticipantRecording;
  message: string;
}

export interface GetParticipantRecordingResponse {
  success: boolean;
  data: ParticipantRecording;
  message: string;
}

export interface GetRecordingsListResponse {
  success: boolean;
  data: {
    recordings: ParticipantRecording[];
    count: number;
  };
  message: string;
}

export interface MarkRecordingCompleteResponse {
  success: boolean;
  data: ParticipantRecording;
  message: string;
}

export interface CreateSegmentResponse {
  success: boolean;
  data: RecordingSegment;
  message: string;
}

export interface GetSegmentsListResponse {
  success: boolean;
  data: {
    segments: RecordingSegment[];
    count: number;
  };
  message: string;
}

