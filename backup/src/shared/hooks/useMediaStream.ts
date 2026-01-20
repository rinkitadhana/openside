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

interface MediaStreamSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
}

const useMediaStream = (initialSettings?: MediaStreamSettings) => {
  const [state, setState] = useState<MediaStream | null>(null);
  
  // Use ref to prevent multiple calls to getUserMedia
  // Without this, React strict mode or re-renders would request camera access multiple times
  const isStreamSet = useRef(false);

  useEffect(() => {
    // Prevent duplicate initialization
    if (isStreamSet.current) return;
    isStreamSet.current = true;

    (async function initStream() {
      try {
        // Request camera and microphone access from the browser
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true, // Request microphone
          video: true, // Request camera
        });

        // Apply initial settings if provided (from pre-join screen)
        if (initialSettings) {
          const videoTracks = stream.getVideoTracks();
          const audioTracks = stream.getAudioTracks();

          // Enable/disable video track based on initial camera state
          videoTracks.forEach((track: MediaStreamTrack) => {
            track.enabled = initialSettings.videoEnabled;
          });

          // Enable/disable audio track based on initial mic state
          audioTracks.forEach((track: MediaStreamTrack) => {
            track.enabled = initialSettings.audioEnabled;
          });
        }

        console.log("[MediaStream] Stream initialized with settings:", initialSettings);
        setState(stream);
      } catch (error) {
        console.error("[MediaStream] Error getting media devices:", error);
        // Common errors: NotAllowedError (user denied), NotFoundError (no device)
      }
    })();
  }, [initialSettings]);

  return { stream: state };
};

export default useMediaStream;

