import type { LiveKitJoinConfig } from "./spaceTypes";

export interface PreJoinSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
  name: string;
  avatar?: string;
  livekit?: LiveKitJoinConfig;
}
