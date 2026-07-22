import React from "react";
import { X, MonitorUp } from "lucide-react";

interface ScreenRecorderInfoSidebarProps {
  onClose: () => void;
}

// Local screen recorder has no space/server, so this drops the invite link,
// email invite and recording-code rows entirely - it's just local context.
const ScreenRecorderInfoSidebar: React.FC<ScreenRecorderInfoSidebarProps> = ({
  onClose,
}) => {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Details</h3>
        <button
          onClick={onClose}
          className="select-none cursor-pointer rounded-full border border-border bg-background p-1.5 transition-all duration-300 hover:bg-primary"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>

      <div className="scrollbar-thin -mr-1 mt-5 flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="min-w-0 break-words text-xl font-semibold text-foreground">
            Screen Recorder
          </p>
          <p className="break-words text-sm leading-relaxed text-foreground/65">
            This is a local recording session. Nothing is sent to a server and
            no one else can join - your camera, microphone and screen are
            captured on this device only.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-foreground/70">
            <MonitorUp size={18} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              Local session
            </span>
            <span className="text-xs text-foreground/60">Not connected</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScreenRecorderInfoSidebar;
