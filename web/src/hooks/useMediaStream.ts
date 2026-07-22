/**
 * HOOK: useMediaStream
 * 
 * PURPOSE:
 * Requests and manages access to the user's camera and microphone.
 * Returns a MediaStream object that contains audio and video tracks.
 * 
 * HOW IT WORKS:
 * 1. Calls navigator.mediaDevices.getUserMedia() to request camera/mic access
 * 2. Browser shows permission prompt to user
 * 3. Returns MediaStream with audio and video tracks
 * 4. Applies initial settings (muted/unmuted from pre-join screen)
 * 
 * MEDIASTREAM EXPLAINED:
 * - MediaStream = container for audio/video tracks
 * - Each track can be enabled/disabled independently
 * - track.enabled = false → mutes without stopping the stream
 * - Stopping a track completely ends the recording (camera light turns off)
 * 
 * @param initialSettings - Video/audio enabled state from pre-join screen
 * @returns {stream} - MediaStream object or null while loading
 */

import { useEffect, useRef, useState } from "react";
import { useGetMe } from "@/hooks/useUserQuery";
import { DEFAULT_FPS, clampFps } from "@/lib/recordingConstants";

interface MediaStreamSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
}

const useMediaStream = (initialSettings?: MediaStreamSettings) => {
  const [state, setState] = useState<MediaStream | null>(null);

  // The stream we own, so the cleanup can stop it even when the consumer has
  // long since re-rendered.
  const streamRef = useRef<MediaStream | null>(null);
  // Settings are only "initial" - read them via a ref so a new object identity
  // per render can't re-trigger acquisition.
  const initialSettingsRef = useRef(initialSettings);
  initialSettingsRef.current = initialSettings;
  // The user's recording frame-rate preference, read at acquisition time. This
  // is a capture HINT (`ideal`); the server's CFR normalization guarantees the
  // final constant rate regardless of what hardware actually delivers.
  const { data: me } = useGetMe();
  const targetFpsRef = useRef(DEFAULT_FPS);
  targetFpsRef.current = clampFps(me?.targetFps ?? DEFAULT_FPS);

  useEffect(() => {
    let cancelled = false;

    (async function initStream() {
      try {
        // Request camera and microphone access from the browser
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true, // Request microphone
          video: {
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: targetFpsRef.current },
            resizeMode: "none",
          } as MediaTrackConstraints,
        });
        const s = stream.getVideoTracks()[0]?.getSettings();
        console.log("[capture]", s?.width, "x", s?.height, "@", s?.frameRate);

        // Unmounted (or StrictMode-remounted) while the permission prompt was
        // up: stop the tracks immediately, otherwise this stream leaks as a
        // hidden live capture nothing references.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Apply initial settings if provided (from pre-join screen)
        const settings = initialSettingsRef.current;
        if (settings) {
          stream.getVideoTracks().forEach((track) => {
            track.enabled = settings.videoEnabled;
          });
          stream.getAudioTracks().forEach((track) => {
            track.enabled = settings.audioEnabled;
          });
        }

        streamRef.current = stream;
        setState(stream);
      } catch (error) {
        console.error("[MediaStream] Error getting media devices:", error);
        // Common errors: NotAllowedError (user denied), NotFoundError (no device)
      }
    })();

    return () => {
      // Fully release the devices on unmount/route change so the camera light
      // and the tab's media indicator turn off.
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream: state };
};

export default useMediaStream;

