// Runs the heavy work off the page, so the screen stays live on a phone.
import { finishModel, inspectModel } from "./engine.js";
import { finishCar } from "./car.js";
import { browserCodec } from "./codec.js";
import { validate } from "./validate.js";

self.onmessage = async (event) => {
  const { id, kind, bytes, options, name } = event.data;
  const env = { codec: browserCodec, validate, onProgress: (label, fraction) => self.postMessage({ id, progress: { label, fraction } }) };
  try {
    let result;
    if (kind === "inspect") result = await inspectModel(bytes);
    else if (kind === "car") result = await finishCar(bytes, name, options, env);
    else result = await finishModel(bytes, options, env);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
};
