// The album colour that lights the window: the most vivid well-represented
// colour of the artwork, made light enough to read on the night background.

import { useEffect, useState } from "react";
import { img } from "./api";

export type Tint = { glow: string; accent: string; rgb: [number, number, number] };

export const DEFAULT_TINT: Tint = { glow: "rgb(120 104 210)", accent: "rgb(201 190 255)", rgb: [120, 104, 210] };

const cache = new Map<string, Tint>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

export function extract(data: Uint8ClampedArray): Tint {
  // 12 hue buckets (plus one for greys); the winner is the most populated,
  // weighted by how vivid its pixels are.
  const buckets = Array.from({ length: 13 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.08 || l > 0.95) continue;
    const grey = s < 0.18;
    const k = grey ? 12 : Math.floor(h / 30) % 12;
    const w = grey ? 0.25 : 0.4 + s * (1 - Math.abs(l - 0.5));
    const bucket = buckets[k];
    bucket.w += w; bucket.r += r * w; bucket.g += g * w; bucket.b += b * w;
  }
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  if (!best.w) return DEFAULT_TINT;
  const rgb: [number, number, number] = [best.r / best.w, best.g / best.w, best.b / best.w];
  const [h, s, l] = rgbToHsl(...rgb);
  const sat = Math.min(0.85, Math.max(s, s < 0.18 ? s : 0.45));
  return {
    rgb: rgb.map(Math.round) as [number, number, number],
    glow: hsl(h, sat, Math.min(0.55, Math.max(0.38, l))),
    accent: hsl(h, Math.min(0.9, sat + 0.1), Math.max(0.72, l)),
  };
}

export function useTint(art?: string | null): Tint {
  const [tint, setTint] = useState<Tint>(() => (art && cache.get(art)) || DEFAULT_TINT);
  useEffect(() => {
    if (!art) return setTint(DEFAULT_TINT);
    const hit = cache.get(art);
    if (hit) return setTint(hit);
    let alive = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 40;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, 40, 40);
      const t = extract(ctx.getImageData(0, 0, 40, 40).data);
      cache.set(art, t);
      if (alive) setTint(t);
    };
    image.src = img(art)!;
    return () => { alive = false; };
  }, [art]);
  return tint;
}
