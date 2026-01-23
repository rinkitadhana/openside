import { Disc2 } from "lucide-react";
import React from "react";

const RecordingBadge = () => {
  return (
    <div className="select-none flex gap-2 justify-center items-center border border-secondary-border px-3 py-1 text-xs my-3 rounded-full shadow-sm shadow-primary-shadow bg-secondary">
      <Disc2 className="text-red-500 animate-pulse" size={14} />
      <span>Recording</span>
    </div>
  );
};

export default RecordingBadge;
