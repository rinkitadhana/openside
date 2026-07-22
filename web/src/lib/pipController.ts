/**
 * Bridge so UI anywhere (e.g. the recorder controls) can drive the app-level
 * Document Picture-in-Picture window owned by RecorderPip. RecorderPip registers
 * its open/close functions here; callers invoke `pipController.open()` directly
 * inside a click handler so Chrome's user-activation requirement is satisfied.
 */
export const pipController: {
  open?: () => void;
  close?: () => void;
} = {};
