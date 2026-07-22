import { useEffect, useState } from "react";

interface PaletteOptions {
  count?: number; // how many distinct colors to return
}

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// Shortest distance between two hues on the [0,1) color wheel.
const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
};

interface Cand {
  h: number;
  s: number;
  l: number;
  count: number;
}

// Cache resolved palettes across mounts so revisiting the page doesn't recompute
// (and visibly flash from fallback colors to the extracted palette each time).
const paletteCache = new Map<string, string[]>();

/**
 * Samples an image and returns `count` colors taken from the image whose HUES
 * are as far apart as possible, then renders each as a light, dull (muted)
 * shade. Returns null until it resolves (or if reading the canvas is blocked).
 */
export const useImagePalette = (
  src: string,
  { count = 4 }: PaletteOptions = {}
): string[] | null => {
  const cacheKey = `${src}|${count}`;
  const [colors, setColors] = useState<string[] | null>(
    () => paletteCache.get(cacheKey) ?? null
  );

  useEffect(() => {
    // Already computed in a previous mount - reuse it, no flicker.
    const cached = paletteCache.get(cacheKey);
    if (cached) {
      setColors(cached);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;

    img.onload = () => {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return;

      const scale = Math.min(1, 200 / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);

      try {
        const { data } = ctx.getImageData(0, 0, w, h);

        // Bucket by quantized hue so we group colors by their color family.
        const HUE_BINS = 36; // 10° each
        const bins = new Map<
          number,
          { r: number; g: number; b: number; count: number }
        >();
        for (let p = 0; p < data.length; p += 4) {
          if (data[p + 3] < 128) continue;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const [hh, ss] = rgbToHsl(r, g, b);
          // skip near-grayscale pixels - they carry no real hue
          if (ss < 0.12) continue;
          const key = Math.floor(hh * HUE_BINS) % HUE_BINS;
          const bin = bins.get(key);
          if (bin) {
            bin.r += r;
            bin.g += g;
            bin.b += b;
            bin.count += 1;
          } else {
            bins.set(key, { r, g, b, count: 1 });
          }
        }

        // Average each hue family into a candidate.
        const candidates: Cand[] = Array.from(bins.values())
          .map((bk) => {
            const [hh, ss, ll] = rgbToHsl(
              bk.r / bk.count,
              bk.g / bk.count,
              bk.b / bk.count
            );
            return { h: hh, s: ss, l: ll, count: bk.count };
          })
          .sort((a, b) => b.count - a.count);

        if (candidates.length === 0) return;

        // Greedily pick the most common hue, then the hue farthest from all
        // already-picked hues - guaranteeing distinct color families.
        const chosen: Cand[] = [candidates[0]];
        while (chosen.length < count && chosen.length < candidates.length) {
          let best: Cand | null = null;
          let bestScore = -1;
          for (const c of candidates) {
            if (chosen.includes(c)) continue;
            let minD = Infinity;
            for (const s of chosen) minD = Math.min(minD, hueDist(c.h, s.h));
            // weight a little by presence so we don't pick fringe specks
            const score = minD + Math.min(c.count, 500) / 50000;
            if (score > bestScore) {
              bestScore = score;
              best = c;
            }
          }
          if (!best) break;
          chosen.push(best);
        }

        // Render each as a BRIGHT, vivid shade: keep the hue, boost saturation,
        // use a mid lightness so colors pop (and white text stays readable).
        const result = chosen.slice(0, count).map((c) => {
          const s = Math.min(0.9, Math.max(0.62, c.s));
          const l = 0.52;
          return hslToHex(c.h, s, l);
        });

        paletteCache.set(cacheKey, result);
        if (!cancelled) setColors(result);
      } catch {
        // tainted canvas / read blocked - leave palette null so caller falls back
      }
    };

    return () => {
      cancelled = true;
    };
  }, [src, count, cacheKey]);

  return colors;
};
