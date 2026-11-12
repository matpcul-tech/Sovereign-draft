// The Khronos glTF validator, loaded only when a finished file is checked.
export async function validate(bytes) {
  const mod = await import("gltf-validator");
  const run = mod.validateBytes || (mod.default && mod.default.validateBytes);
  const report = await run(bytes, { maxIssues: 50 });
  const first = report.issues.messages.find((m) => m.severity === 0);
  return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, first: first ? first.code + ": " + first.message : "" };
}
