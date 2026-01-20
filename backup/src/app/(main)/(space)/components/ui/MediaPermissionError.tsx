import React from "react";

interface MediaPermissionErrorProps {
  error: string;
  onRetry: () => void;
}

const MediaPermissionError: React.FC<MediaPermissionErrorProps> = ({
  error,
  onRetry,
}) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-call-primary/50 p-6">
      <div className="text-red-400 text-center text-sm mb-4">{error}</div>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-call-background border border-call-border cursor-pointer text-foreground rounded-xl hover:bg-call-primary transition-colors"
      >
        Retry
      </button>
    </div>
  );
};

export default MediaPermissionError;
