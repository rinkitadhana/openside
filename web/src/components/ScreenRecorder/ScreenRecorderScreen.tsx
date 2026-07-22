import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import ScreenRecorderStage from "./ScreenRecorderStage";
import ScreenRecorderControls from "./ScreenRecorderControls";
import { useLocalMedia } from "./LocalMediaProvider";

// A fully local recording surface. There is NO LiveKit room and no server:
// local media (camera/mic via getUserMedia, screen via getDisplayMedia) is
// owned by LocalMediaProvider (now app-level so it survives navigation),
// presented as-is, and recorded locally - only the chunks go to R2.
const ScreenRecorderScreen = () => {
  const navigate = useNavigate();
  const { isCameraEnabled, isMicrophoneEnabled, toggleCamera, toggleMicrophone } =
    useLocalMedia();
  const autoEnabledRef = useRef(false);

  useEffect(() => {
    document.title = "Openside - Screen Recorder";
    return () => {
      document.title = "Openside";
    };
  }, []);

  // On entering the recorder, turn the mic + camera on once (best-effort; a
  // denied permission just leaves it off for the user to enable manually).
  useEffect(() => {
    if (autoEnabledRef.current) return;
    autoEnabledRef.current = true;
    if (!isCameraEnabled) void toggleCamera().catch(() => undefined);
    if (!isMicrophoneEnabled) void toggleMicrophone().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the recorder does NOT stop the camera/recording - the floating
  // widget keeps it alive and in control until the user stops it.
  const handleExit = () => {
    navigate("/dashboard/home");
  };

  return (
    <div className="relative flex h-full flex-col gap-2 bg-background">
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ScreenRecorderStage />
        </div>
      </div>
      {/* Floated over the stage so the screen preview uses the full height. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 px-2 pb-2">
        <div className="pointer-events-auto">
          <ScreenRecorderControls onExit={handleExit} />
        </div>
      </div>
    </div>
  );
};

export default ScreenRecorderScreen;
