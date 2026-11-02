// Enums
export type RecordingType = "AUDIO" | "VIDEO";
export type RecordingSessionStatus =
  | "ACTIVE"
  | "STOPPED"
  | "PROCESSING"
  | "READY"
  | "FAILED";
export type RecordingFileStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "PROCESSING"
  | "READY"
  | "FAILED";
type SegmentStatus = "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED";

// RecordingSession
export interface RecordingSession {
  id: string;
  spaceId: string;
  title?: string | null;
  description?: string | null;
  spaceRecordingSessionId: string;
  startedAt: string;
  stoppedAt?: string;
  status: RecordingSessionStatus;
  /** Public link id once the Space host enables sharing for this session. */
  shareToken?: string | null;
  /** Share-page opens by anyone other than the host. */
  viewCount?: number;
  targetFps?: number;
  videoResolution?: number;
  audioSampleRate?: number;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  recordingMode?: "VIDEO_AND_AUDIO" | "AUDIO_ONLY";
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
  videoLabel?: string;
  audioLabel?: string;
  startOffsetMs?: number;
  durationMs?: number;
  lastChunkAt?: string;
  mergedFileKey?: string;
  thumbnailKey?: string | null;
  /** Presigned URL for this track's poster thumbnail, attached by the sessions
   *  endpoint. Available early (from the first chunk) - before finalization. */
  thumbnailUrl?: string | null;
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
    livekitIdentity?: string | null;
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
  // Raw-PCM segments only (nullable otherwise).
  sampleRate?: number | null;
  bitDepth?: number | null;
  channelCount?: number | null;
}

// Payloads
export interface StartSessionPayload {
  spaceId: string;
  spaceRecordingSessionId: string;
  participantSessionId: string;
  /** Per-session cloud backup opt-in (honored only when the plan allows it). */
  cloudBackup?: boolean;
}

export interface StopSessionPayload {
  spaceId: string;
  participantSessionId: string;
}

export interface CreateParticipantRecordingPayload {
  recordingSessionId: string;
  spaceId: string;
  participantSessionId: string;
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
  startOffsetMs?: number;
  /** Camera/PCM tracks: continue this participant's existing track for the
   *  session (a refreshed tab, a rejoin) instead of creating a second one. */
  resumable?: boolean;
}

/** Where a (possibly resumed) track continues: the next free sequence number
 *  and the track's own timeline origin. */
export interface ParticipantRecordingResume {
  nextSequenceNumber: number;
  startOffsetMs: number | null;
}

export interface PresignSegmentResponse {
  success: boolean;
  data: {
    uploadUrl: string;
    assetKey: string;
  };
  message: string;
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

export interface GetActiveSessionResponse {
  success: boolean;
  data: RecordingSession | null;
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
  data: ParticipantRecording & { resume?: ParticipantRecordingResume };
  message: string;
}

export interface CreateSegmentResponse {
  success: boolean;
  data: RecordingSegment;
  message: string;
}
