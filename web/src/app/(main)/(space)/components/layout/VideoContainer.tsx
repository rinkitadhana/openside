import React from "react";
import { RxEnterFullScreen, RxExitFullScreen } from "react-icons/rx";

interface VideoContainerProps {
  children: React.ReactNode;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  showFullScreenButton?: boolean;
  className?: string;
}

const VideoContainer: React.FC<VideoContainerProps> = ({
  children,
  isFullScreen,
  onToggleFullScreen,
  showFullScreenButton = true,
  className = "",
}) => {
  return (
    <div
      className={`relative group/video-container overflow-hidden ${className}`}
    >
      <div className="bg-call-primary overflow-hidden rounded-2xl h-full w-full border border-call-border relative">
        {children}
      </div>
      {showFullScreenButton && (
        <button
          onClick={onToggleFullScreen}
          className="select-none opacity-0 group-hover/video-container:opacity-100 absolute bottom-0 right-0 p-2 m-2 rounded-xl bg-secondary hover:bg-primary-hover border border-call-border cursor-pointer transition-all duration-300"
        >
          {isFullScreen ? (
            <RxExitFullScreen size={20} />
          ) : (
            <RxEnterFullScreen size={20} />
          )}
        </button>
      )}
    </div>
  );
};

export default VideoContainer;
