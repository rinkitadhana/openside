import React from "react";
import { RiMicOffLine } from "react-icons/ri";
import { RxSpeakerOff } from "react-icons/rx";

interface StatusIndicatorsProps {
  muted: boolean;
  speakerMuted: boolean;
}

const StatusIndicators: React.FC<StatusIndicatorsProps> = ({
  muted,
  speakerMuted,
}) => {
  if (!muted && !speakerMuted) return null;

  return (
    <div className="absolute top-3 right-3 bg-call-primary/50 p-2 rounded-full flex gap-2.5">
      {muted && <RiMicOffLine size={18} className="text-foreground" />}
      {speakerMuted && <RxSpeakerOff size={18} className="text-foreground" />}
    </div>
  );
};

export default StatusIndicators;
