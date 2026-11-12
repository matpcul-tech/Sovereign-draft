// Image decode and encode with what the browser already has. Works on the page and in a worker.

function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  return c;
}

async function toBytes(canvas, mime, quality) {
  if (canvas.convertToBlob) {
    const blob = await canvas.convertToBlob({ type: mime, quality });
    return blob.type === mime ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  return blob && blob.type === mime ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export const browserCodec = {
  async decode(bytes, mime) {
    if (typeof createImageBitmap === "undefined") return null;
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime || "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = canvasOf(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    if (bitmap.close) bitmap.close();
    return { width: data.width, height: data.height, rgba: new Uint8Array(data.data.buffer) };
  },
  async encode(rgba, width, height, mime, quality = 0.9) {
    const canvas = canvasOf(width, height);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    const bytes = await toBytes(canvas, mime, quality);
    if (bytes || mime !== "image/webp") return bytes;
    const { encodeWebp } = await import("./webp-enc.js");
    return encodeWebp(rgba, width, height, quality);
  }
};
