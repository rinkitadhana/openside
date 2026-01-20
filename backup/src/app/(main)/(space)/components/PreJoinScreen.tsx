import React, { useEffect, useRef, useState } from "react";
import { RiMicLine, RiMicOffLine } from "react-icons/ri";
import { FiVideo, FiVideoOff } from "react-icons/fi";
import { Loader2 } from "lucide-react";
import Header from "./SpaceHeader";
import playClickSound from "@/shared/utils/ClickSound";
import UserMedia from "./UserMedia";
import MediaPermissionError from "./ui/MediaPermissionError";
import { useGetMe } from "@/shared/hooks/useUserQuery";
import { useGetSpaceByJoinCode } from "@/shared/hooks/useSpace";
import { useJoinSpace } from "@/shared/hooks/useParticipant";
import { PreJoinSettings } from "../[roomId]/page";
import { getOrCreateSessionId } from "@/shared/utils/ParticipantSessionId";

interface PreJoinScreenProps {
  onJoinCall: (settings: PreJoinSettings) => void;
  roomId: string;
}

const PreJoinScreen = ({ onJoinCall, roomId }: PreJoinScreenProps) => {
  const { data: user } = useGetMe();
  const { data: spaceData, isLoading: isLoadingSpace } =
    useGetSpaceByJoinCode(roomId);
  const joinSpace = useJoinSpace(spaceData?.id || "");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const participantSessionId = getOrCreateSessionId(roomId);

  const initializeStream = async () => {
    try {
      setIsLoading(true);
      setPermissionError(null);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);

      const videoTracks = mediaStream.getVideoTracks();
      const audioTracks = mediaStream.getAudioTracks();

      videoTracks.forEach((track) => {
        track.enabled = videoEnabled;
      });

      audioTracks.forEach((track) => {
        track.enabled = audioEnabled;
      });
    } catch (error) {
      console.error("Error accessing media devices:", error);
      if (error instanceof Error) {
        if (error.name === "NotAllowedError") {
          setPermissionError(
            "Camera and microphone access denied. Please allow access and try again."
          );
        } else if (error.name === "NotFoundError") {
          setPermissionError(
            "No camera or microphone found. Please check your devices."
          );
        } else {
          setPermissionError(
            "Unable to access camera and microphone. Please check your devices and permissions."
          );
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initializeStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fill user's name from backend
  useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user]);

  useEffect(() => {
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    videoTracks.forEach((track) => {
      track.enabled = videoEnabled;
    });

    audioTracks.forEach((track) => {
      track.enabled = audioEnabled;
    });
  }, [videoEnabled, audioEnabled, stream]);

  const handleVideoToggle = () => {
    setVideoEnabled((prev) => !prev);
  };

  const handleAudioToggle = () => {
    setAudioEnabled((prev) => !prev);
  };

  const handleJoinCall = () => {
    if (!spaceData?.id || !name.trim()) return;

    // Clear any previous join errors
    setJoinError(null);

    // Call the join space API
    joinSpace.mutate(
      {
        displayName: name.trim(),
        participantSessionId,
      },
      {
        onSuccess: (data) => {
          console.log("Successfully joined space:", data);
          // After successful API call, update the UI state
          onJoinCall({
            videoEnabled,
            audioEnabled,
            name,
            avatar: user?.avatar,
          });
        },
        onError: (error: unknown) => {
          console.error("Failed to join space:", error);
          // Extract error message from the API response
          let errorMessage = "Failed to join the space. Please try again.";
          if (error && typeof error === "object") {
            if (
              "response" in error &&
              error.response &&
              typeof error.response === "object"
            ) {
              if (
                "data" in error.response &&
                error.response.data &&
                typeof error.response.data === "object"
              ) {
                if (
                  "message" in error.response.data &&
                  typeof error.response.data.message === "string"
                ) {
                  errorMessage = error.response.data.message;
                }
              }
            } else if (
              "message" in error &&
              typeof error.message === "string"
            ) {
              errorMessage = error.message;
            }
          }
          setJoinError(errorMessage);
        },
      }
    );
  };

  return (
    <div className="relative bg-call-background h-screen flex flex-col p-2">
      {/* Full-screen loader while joining */}
      {joinSpace.isPending && (
        <div className="absolute inset-0 bg-call-background/95 backdrop-blur-sm z-50 flex items-center justify-center">
          <p className="text-foreground font-medium">Joining space...</p>
        </div>
      )}

      <Header prejoin={true} />
      <div className=" absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full flex flex-col items-center justify-center max-w-[800px] mx-auto">
        <div className="flex w-full flex-row items-center gap-10 justify-center">
          <div className="relative">
            <div className="w-[450px] h-[250px] bg-call-primary border border-call-border rounded-xl overflow-hidden">
              {isLoading ? (
                <div className="w-full h-full flex items-center justify-center bg-call-primary">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2
                      className="animate-spin text-foreground"
                      size={30}
                    />
                  </div>
                </div>
              ) : permissionError ? (
                <MediaPermissionError
                  error={permissionError}
                  onRetry={initializeStream}
                />
              ) : (
                <UserMedia
                  url={stream}
                  muted={true}
                  playing={videoEnabled}
                  className="w-full h-full object-cover"
                  myVideo={true}
                  name={name}
                  avatar={user?.avatar}
                  preJoin={true}
                  hideElements={true}
                />
              )}
            </div>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2">
              <button
                onClick={() => {
                  handleAudioToggle();
                  playClickSound();
                }}
                className="flex items-center justify-center p-3 rounded-xl bg-primary-hover/50  text-xl font-medium cursor-pointer hover:bg-primary-hover/70 transition-all duration-200"
                disabled={isLoading || !!permissionError}
              >
                {audioEnabled ? <RiMicLine /> : <RiMicOffLine />}
              </button>

              <button
                onClick={() => {
                  handleVideoToggle();
                  playClickSound();
                }}
                className="flex items-center justify-center p-3 rounded-xl bg-primary-hover/50  text-xl font-medium cursor-pointer hover:bg-primary-hover/70 transition-all duration-200"
                disabled={isLoading || !!permissionError}
              >
                {videoEnabled ? <FiVideo /> : <FiVideoOff />}
              </button>
            </div>
          </div>

          <div className="flex flex-col items-start gap-4 w-full">
            <div className="flex flex-col gap-1.5 mb-2">
              <p className="text-xs text-secondary-text font-medium">
                {isLoadingSpace
                  ? "Loading space info..."
                  : spaceData
                    ? `You are about to join ${spaceData.host?.name || "Host"}'s space`
                    : "You are about to join a space"}
              </p>
              <h1 className="text-xl font-semibold">
                {spaceData?.title || "Let's check your cam and mic"}
              </h1>
            </div>
            <div className="flex w-full gap-2 items-center">
              <div className="flex-1 flex items-center justify-center text-foreground/80 gap-2 py-2.5 bg-call-primary border border-call-border rounded-lg w-full font-medium text-sm select-none cursor-not-allowed transition-all duration-200">
                sample
              </div>
              <div className="flex-1 flex items-center justify-center text-foreground/80 gap-2 py-2.5 bg-call-primary border border-call-border rounded-lg w-full font-medium text-sm select-none cursor-not-allowed transition-all duration-200">
                sample
              </div>
            </div>
            <div className="w-full">
              <input
                type="text"
                id="name"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 bg-call-primary border border-call-border rounded-lg text-sm focus:outline-none transition-all duration-200"
              />
            </div>

            {/* Error message display */}
            {joinError && (
              <div className="w-full p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{joinError}</p>
              </div>
            )}

            <button
              onClick={handleJoinCall}
              disabled={
                isLoading ||
                !!permissionError ||
                !name.trim() ||
                joinSpace.isPending ||
                !spaceData?.id
              }
              className="py-2.5 w-full select-none text-center bg-purple-400/80 hover:bg-purple-400/60 font-medium disabled:bg-purple-400/40 disabled:text-foreground/40 disabled:cursor-not-allowed text-sm rounded-lg cursor-pointer transition-all duration-200"
            >
              <span>Join Call</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreJoinScreen;
