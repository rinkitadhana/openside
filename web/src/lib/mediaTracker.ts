// Global media tracker.
//
// We kept hitting a bug where the camera/mic stayed live (the browser tab's
// "using your microphone" indicator) after leaving a call. The underlying
// MediaStreamTracks come from several places - our pre-join preview AND the
// LiveKit SDK's own internal getUserMedia calls - so stopping tracks we can
// reach via the LiveKit API isn't enough.
//
// To guarantee release, we monkey-patch getUserMedia/getDisplayMedia once at
// startup and keep a registry of every track ever handed out. stopAllLocalMedia()
// then stops all of them, which is what actually frees the OS device.

const activeTracks = new Set<MediaStreamTrack>();
let installed = false;

const registerStream = (stream: MediaStream) => {
  // `track.stop()` does NOT fire the "ended" event, so tracks stopped by the
  // app would otherwise accumulate forever. Prune dead ones as new streams
  // come in (acquisition is rare, so the sweep is cheap).
  for (const track of activeTracks) {
    if (track.readyState === "ended") activeTracks.delete(track);
  }

  for (const track of stream.getTracks()) {
    activeTracks.add(track);
    track.addEventListener("ended", () => activeTracks.delete(track));
  }
};

export function installMediaTracker() {
  if (installed) return;
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
  installed = true;

  const md = navigator.mediaDevices;

  const originalGetUserMedia = md.getUserMedia?.bind(md);
  if (originalGetUserMedia) {
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await originalGetUserMedia(constraints);
      registerStream(stream);
      return stream;
    };
  }

  const originalGetDisplayMedia = md.getDisplayMedia?.bind(md);
  if (originalGetDisplayMedia) {
    md.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
      const stream = await originalGetDisplayMedia(constraints);
      registerStream(stream);
      return stream;
    };
  }

  // Leaving the page (close/refresh/navigation). Normally the browser releases
  // devices on unload, but a page parked in the back/forward cache is frozen,
  // not unloaded - without this, the camera/mic could stay captured by a page
  // that isn't even visible anymore.
  window.addEventListener("pagehide", stopAllLocalMedia);
}

// Stop every camera/mic/screen track we've ever acquired, releasing the devices.
export function stopAllLocalMedia() {
  for (const track of activeTracks) {
    try {
      track.stop();
    } catch {
      // ignore - already stopped/detached
    }
  }
  activeTracks.clear();
}
