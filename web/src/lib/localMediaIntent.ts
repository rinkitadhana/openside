// Distinguishes "I clicked mute" from "a host/server muted me".
//
// Every UI control that changes the local mic/camera marks its action here.
// The watcher in LiveKitControls then only notifies the user about an
// off-switch that happened with NO recent local action - i.e. a moderator
// stopped their track (or the device died) - instead of staying silent.

let lastActionAt = 0;

export const markLocalMediaAction = () => {
  lastActionAt = Date.now();
};

export const hasRecentLocalMediaAction = (windowMs = 2500) =>
  Date.now() - lastActionAt < windowMs;
