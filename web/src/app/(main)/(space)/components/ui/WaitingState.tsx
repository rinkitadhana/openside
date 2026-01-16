import React from "react";
import { X } from "lucide-react";

interface WaitingStateProps {
  onClose: () => void;
  isVisible: boolean;
}

const WaitingState: React.FC<WaitingStateProps> = ({ onClose, isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="flex-1 h-full min-w-0 relative group/close overflow-hidden">
      <div className="bg-call-primary border border-call-border rounded-2xl h-full w-full flex justify-center items-center">
        <div className="text-muted-foreground text-lg">
          Waiting for others to join...
        </div>
      </div>
      <button
        onClick={onClose}
        className="select-none opacity-0 group-hover/close:opacity-100 absolute top-0 right-0 p-1.5 m-2 rounded-full bg-secondary hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
      >
        <X size={18} />
      </button>
    </div>
  );
};

export default WaitingState;
