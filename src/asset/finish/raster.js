import { decodePng, encodePng } from "./png.js";
import webpDecoder from "@jsquash/webp/codec/dec/webp_dec.js";

let webpReady;
async function webpModule() {
  if (!webpReady) {
    let wasmBinary;
    if (typeof window === "undefined" && typeof process !== "undefined" && process.versions && process.versions.node) {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const path = fileURLToPath(new URL("../../../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm", import.meta.url));
      wasmBinary = await readFile(path);
    } else {
      const response = await fetch("/node_modules/@jsquash/webp/codec/dec/webp_dec.wasm");
      if (!response.ok) throw new Error("The WebP decoder could not be loaded.");
      wasmBinary = new Uint8Array(await response.arrayBuffer());
    }
    webpReady = webpDecoder({ wasmBinary });
  }
  return webpReady;
}

export async function decodeRaster(bytes, mime) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isPng(data)) return decodePng(data);
  if (mime === "image/webp" || isWebp(data)) {
    const module = await webpModule();
    const image = module.decode(data);
    return {
      width: image.width,
      height: image.height,
      rgba: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    };
  }
  throw new Error("This image is not a PNG or a WebP.");
}

export function encodeRaster(width, height, rgba) {
  return encodePng(width, height, rgba);
}

function isPng(bytes) {
  return bytes.length > 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
}

function isWebp(bytes) {
  return bytes.length > 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70;
}
