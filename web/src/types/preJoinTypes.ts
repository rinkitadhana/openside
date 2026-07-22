import type { LiveKitJoinConfig } from "./spaceTypes";

export interface PreJoinSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
  name: string;
  avatar?: string;
  audioDeviceId?: string;
  echoCancellation?: boolean;
  videoDeviceId?: string;
  audioOutputDeviceId?: string;
  livekit?: LiveKitJoinConfig;
}
