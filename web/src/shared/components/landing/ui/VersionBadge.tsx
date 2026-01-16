import React from "react";

const VersionBadge = ({ text }: { text: string }) => {
  return (
    <div className="px-3 py-1 rounded-full text-xs font-semibold font-mono bg-green-100 border border-secondary-border text-black/90 select-none">
      {text}
    </div>
  );
};

export default VersionBadge;
