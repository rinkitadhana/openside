/**
 * Normalize a raw enumerateDevices() list for display in a device picker:
 * - Drop permission-gated placeholder entries (empty deviceId) - they can't be
 *   selected and render as blank/duplicate rows.
 * - Pin the OS "default" device to the top, then Windows' "communications"
 *   device, then the rest in enumeration order (stable sort).
 */
export function sortMediaDevices(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const rank = (device: MediaDeviceInfo) =>
    device.deviceId === "default"
      ? 0
      : device.deviceId === "communications"
        ? 1
        : 2;

  return devices
    .filter((device) => device.deviceId)
    .map((device, index) => ({ device, index }))
    .sort((a, b) => rank(a.device) - rank(b.device) || a.index - b.index)
    .map(({ device }) => device);
}

/**
 * Strip the trailing USB vendor:product id Chrome appends to device labels,
 * e.g. "MacBook Pro Camera (0000:0001)" → "MacBook Pro Camera". It's noise to
 * users and only there to disambiguate identical hardware.
 */
export function cleanDeviceLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
}

/** Whether this browser supports choosing an audio output device (setSinkId). */
export const canSelectAudioOutput =
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype;

/** Best-effort sinkId switch; no-ops where unsupported or on failure. */
export async function applyAudioOutput(
  element: HTMLMediaElement | null,
  deviceId: string,
): Promise<void> {
  if (!element || !deviceId || !canSelectAudioOutput) return;

  try {
    await (
      element as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }
    ).setSinkId(deviceId);
  } catch (error) {
    console.error("Unable to set audio output device:", error);
  }
}
