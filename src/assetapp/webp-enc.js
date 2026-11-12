// WebP encoder for browsers whose canvas cannot write WebP (Safari). Loaded only when needed.
import enc from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import wasmUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url";

let ready = null;
export async function encodeWebp(rgba, width, height, quality) {
  if (!ready) ready = fetch(wasmUrl).then((r) => r.arrayBuffer()).then((wasmBinary) => enc({ wasmBinary }));
  const module = await ready;
  const out = module.encode(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, { ...defaultOptions, quality: Math.round(quality * 100) });
  return out ? new Uint8Array(out) : null;
}
