import React from "react";
import { X } from "lucide-react";

interface SidebarContentProps {
  onClose: () => void;
}

const UsersSidebar: React.FC<SidebarContentProps> = ({ onClose }) => {
  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">People</h3>
        <button
          onClick={onClose}
          className="select-none p-1.5 rounded-full bg-call-background hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
        >
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 space-y-3 my-8">
        <div className="text-sm text-secondary-text text-center">
          No people yet.
        </div>
      </div>
    </div>
  );
};

export default UsersSidebar;
