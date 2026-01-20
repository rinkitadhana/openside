/**
 * COMPONENT: UserMedia
 *
 * PURPOSE:
 * Renders a participant's video/audio in the call.
 * Handles both live MediaStream and recorded video URLs.
 *
 * KEY FEATURES:
 * - Displays video when camera is on
 * - Shows avatar/initials when camera is off
 * - Mirrors your own video (so it looks like a mirror)
 * - Handles audio muting via speaker control
 * - Always keeps video element mounted (even when camera off) to maintain audio
 *
 * MEDIASTREAM vs STRING URL:
 * - MediaStream: Live camera/mic from getUserMedia (real-time call)
 * - String URL: Recorded video file (playback)
 *
 * WHY KEEP VIDEO MOUNTED WHEN CAMERA OFF:
 * - MediaStream contains BOTH audio and video tracks
 * - If we unmount video element, we lose audio too
 * - Solution: Keep video mounted but hidden, show avatar instead
 *
 * @param url - MediaStream (live) or string (recorded video)
 * @param muted - Is their mic muted?
 * @param playing - Is their camera on?
 * @param myVideo - Is this YOUR video? (for mirror effect)
 * @param name - Display name
 * @param avatar - Profile picture URL
 * @param speakerMuted - Have YOU muted their audio?
 * @param hideElements - Hide name label and status icons (for prejoin screen)
 */

import { useEffect, useRef } from "react";
import StatusIndicators from "./ui/StatusIndicators";
import UserAvatar from "./ui/UserAvatar";

interface UserMediaProps {
  url: string | MediaStream | null;
  muted: boolean;
  playing: boolean;
  className: string;
  myVideo?: boolean;
  name?: string;
  avatar?: string;
  preJoin?: boolean;
  speakerMuted?: boolean;
  hideElements?: boolean;
}

const UserMedia = ({
  url,
  muted,
  playing,
  className,
  myVideo,
  name,
  avatar,
  preJoin = false,
  speakerMuted = false,
  hideElements = false,
}: UserMediaProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // ============================================================================
  // EFFECT: HANDLE VIDEO PLAYBACK
  // ============================================================================

  /**
   * When url or playing state changes, update the video element
   *
   * FOR MEDIASTREAM (live video):
   * - Always keep playing to maintain audio
   * - Track visibility controlled by "playing" prop and CSS
   *
   * FOR STRING URL (recorded video):
   * - Actually pause/play the video element
   */
  useEffect(() => {
    if (videoRef.current && url instanceof MediaStream) {
      // Set srcObject only if it changed (avoids unnecessary updates)
      if (videoRef.current.srcObject !== url) {
        videoRef.current.srcObject = url;
      }

      // For MediaStream, always play (to maintain audio)
      const playVideo = async () => {
        try {
          // Small delay to ensure video element is ready
          await new Promise((resolve) => setTimeout(resolve, 100));
          await videoRef.current?.play();
        } catch (error) {
          console.error("[UserMedia] Error playing video:", error);
        }
      };
      playVideo();
    } else if (videoRef.current && typeof url === "string") {
      // For string URLs (recorded videos), handle play/pause normally
      if (playing) {
        const playVideo = async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 100));
            await videoRef.current?.play();
          } catch (error) {
            console.error("[UserMedia] Error playing video:", error);
          }
        };
        playVideo();
      } else {
        videoRef.current.pause();
      }
    }
  }, [playing, url]);

  // ============================================================================
  // EFFECT: HANDLE SPEAKER MUTING
  // ============================================================================

  /**
   * Control volume of incoming audio
   * This is different from "muted" (their mic) - this is YOUR speaker
   *
   * HOW IT WORKS:
   * - video.volume = 0 → You can't hear them
   * - video.volume = 1 → You can hear them normally
   */
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = speakerMuted ? 0 : 1;
    }
  }, [speakerMuted]);

  // ============================================================================
  // EARLY RETURN: NO URL
  // ============================================================================

  if (!url) {
    return null;
  }

  // ============================================================================
  // STYLES
  // ============================================================================

  // Base styles to prevent layout issues
  const baseVideoStyles =
    "max-w-full max-h-full min-w-0 min-h-0 object-contain";

  // Mirror your own video so it looks like a mirror
  const mirrorStyle = myVideo ? "scale-x-[-1]" : "";

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="relative w-full h-full">
      {/* FOR MEDIASTREAM (live video) */}
      {url instanceof MediaStream ? (
        <>
          {/* Video element - always mounted to maintain audio */}
          <video
            ref={videoRef}
            autoPlay
            controls={false}
            playsInline
            muted={myVideo ? true : muted} // Your video always muted (no echo)
            className={
              playing
                ? `${baseVideoStyles} ${className} ${mirrorStyle}`
                : "hidden" // Hide but keep mounted when camera off
            }
          />

          {/* Show avatar when camera is off */}
          {!playing && (
            <UserAvatar name={name} avatar={avatar || ""} preJoin={preJoin} />
          )}
        </>
      ) : (
        // FOR STRING URL (recorded video)
        <>
          {playing ? (
            <video
              ref={videoRef}
              autoPlay
              controls={false}
              playsInline
              muted={myVideo ? true : muted}
              src={url}
              className={`${baseVideoStyles} ${className} ${mirrorStyle}`}
            />
          ) : (
            <UserAvatar name={name} avatar={avatar || ""} preJoin={preJoin} />
          )}
        </>
      )}

      {/* Status indicators (mic/speaker icons) */}
      {!hideElements && (
        <StatusIndicators muted={muted} speakerMuted={speakerMuted} />
      )}

      {/* Name label */}
      {!hideElements && name && (
        <div className="select-none absolute bottom-3 left-3 bg-call-primary/80 px-3 py-1 rounded-full text-foreground text-sm font-medium">
          {name}
        </div>
      )}
    </div>
  );
};

export default UserMedia;
