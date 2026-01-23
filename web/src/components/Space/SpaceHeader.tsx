import { ThemeSwitcher } from "@/components/shared/ThemeSwitcher";
import { UserPlus } from "lucide-react";
import React, { useMemo } from "react";
import { BsPatchQuestion } from "react-icons/bs";
import AsapLogo from "@/components/ui/AsapLogo";
import { useParams } from "react-router-dom";
import { useGetSpaceByJoinCode } from "@/hooks/useSpace";
import type { RecordingState } from "@/hooks/useRecordingManager";

interface SpaceHeaderProps {
  prejoin?: boolean;
  recordingState?: RecordingState;
  recordingDurationMs?: number;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

const SpaceHeader = ({
  prejoin,
  recordingState = "idle",
  recordingDurationMs = 0,
}: SpaceHeaderProps) => {
  const params = useParams();
  const roomId = params.roomId as string;
  const { data: spaceData, isLoading } = useGetSpaceByJoinCode(roomId);

  const isRecording =
    recordingState === "recording" || recordingState === "stopping";

  const formattedDuration = useMemo(() => {
    return formatDuration(recordingDurationMs);
  }, [recordingDurationMs]);

  const recordingStatusText = useMemo(() => {
    switch (recordingState) {
      case "starting":
        return "Starting...";
      case "recording":
        return "Recording";
      case "stopping":
        return "Stopping...";
      default:
        return "";
    }
  }, [recordingState]);

  return (
    <header className="w-full px-2 select-none z-50">
      <div className="flex items-center justify-between py-2 w-full rounded-xl">
        <div className="flex items-center gap-2">
          <AsapLogo icon name />
          <div className="h-6 border-l border-primary-border mx-1" />
          <div className="text-secondary-text text-sm">
            {isLoading ? (
              <div className="animate-pulse">Loading space info...</div>
            ) : (
              spaceData?.title || "Untitled Space"
            )}
          </div>

          {/* Recording Indicator */}
          {isRecording && (
            <>
              <div className="h-6 border-l border-primary-border mx-1" />
              <div className="flex items-center gap-2 py-1.5 px-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <div className="relative">
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                  {recordingState === "recording" && (
                    <div className="absolute inset-0 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                  )}
                </div>
                <span className="text-red-400 font-medium text-sm">
                  {recordingStatusText}
                </span>
                {recordingState === "recording" && (
                  <span className="text-red-300 font-mono text-sm">
                    {formattedDuration}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher
            scrolled={false}
            className="p-2.5 border border-call-border rounded-xl hover:bg-primary-hover transition-all duration-200 bg-call-primary cursor-pointer select-none"
          />
          <div className="h-7 border-l border-primary-border mx-1" />
          <div className="flex items-center gap-2 py-2.5 px-3 border border-call-border rounded-xl hover:bg-primary-hover transition-all duration-200 bg-call-primary cursor-pointer select-none">
            <BsPatchQuestion size={17} />
            <span className="font-medium text-[15px] leading-tight">Help</span>
          </div>
          {!prejoin && (
            <div className="flex items-center gap-2 py-2.5 px-3 border border-call-border rounded-xl hover:bg-primary-hover transition-all duration-200 bg-call-primary cursor-pointer select-none">
              <UserPlus size={17} />
              <span className="font-medium text-[15px] leading-tight">
                Invite
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default SpaceHeader;
