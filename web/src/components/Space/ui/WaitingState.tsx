import React from "react";
import { X } from "lucide-react";

interface WaitingStateProps {
  onClose: () => void;
  isVisible: boolean;
}

const WaitingState: React.FC<WaitingStateProps> = ({ onClose, isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="relative group/close pointer-events-auto">
      <div className="bg-call-primary/95 border border-call-border rounded-xl min-w-[260px] max-w-[360px] px-6 py-5 shadow-lg flex justify-center items-center">
        <div className="text-muted-foreground text-sm font-medium text-center">
          Waiting for others to join...
        </div>
      </div>
      <button
        onClick={onClose}
        className="select-none opacity-0 group-hover/close:opacity-100 absolute -top-2 -right-2 p-1.5 rounded-full bg-secondary hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
      >
        <X size={18} />
      </button>
    </div>
  );
};

export default WaitingState;
