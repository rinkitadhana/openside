export type FinalOutputType = "COMPOSITE" | "PER_PARTICIPANT";
export type FinalOutputMode = "MIXED" | "VIDEO_ONLY" | "AUDIO_ONLY";
export type FinalOutputVariant = "RAW" | "ALIGNED" | "CLOUD";
export type OutputStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";
export type DownloadFormat = "webm" | "mp4" | "mp3" | "wav";

export interface FinalOutput {
  id: string;
  recordingSessionId: string;
  spaceId: string;
  type: FinalOutputType;
  mode: FinalOutputMode;
  variant: FinalOutputVariant;
  targetParticipantId?: string | null;
  sourceRecordingId?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
  hasVideo?: boolean | null;
  hasAudio?: boolean | null;
  videoLabel?: string | null;
  audioLabel?: string | null;
  masterKey?: string | null;
  thumbnailKey?: string | null;
  /** Presigned URL for the stored poster thumbnail, attached by the space
   *  outputs endpoint. Null when no thumbnail exists (e.g. audio-only, or an
   *  older recording finalized before thumbnails were generated). */
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  durationMs?: number | null;
  fileSize?: string | null;
  status: OutputStatus;
  createdAt: string;
  recordingSession?: {
    id: string;
    title?: string | null;
    spaceRecordingSessionId: string;
    startedAt?: string;
    stoppedAt?: string | null;
  };
  sourceRecording?: {
    id: string;
    type: "AUDIO" | "VIDEO";
    isScreenShare?: boolean;
    participant?: {
      id: string;
      displayName?: string | null;
      role?: string;
      user?: { name?: string; avatar?: string | null } | null;
    } | null;
  } | null;
}

export interface GetOutputsBySpaceResponse {
  success: boolean;
  data: {
    outputs: FinalOutput[];
    count: number;
  };
  message: string;
}

export interface DownloadUrlResponse {
  success: boolean;
  data: {
    ready: boolean;
    url?: string;
    format: DownloadFormat;
    error?: string;
  };
  message: string;
}
