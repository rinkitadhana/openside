const SILENCE_DB = -55;
const MAX_METER_DB = -10;

export const calculateMicLevel = (samples: Uint8Array<ArrayBuffer>) => {
  let sumSquares = 0;

  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sumSquares += normalized * normalized;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms === 0) return 0;

  const decibels = 20 * Math.log10(rms);
  const normalizedLevel = (decibels - SILENCE_DB) / (MAX_METER_DB - SILENCE_DB);

  return Math.round(Math.min(1, Math.max(0, normalizedLevel)) * 100);
};
