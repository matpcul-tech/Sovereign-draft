import { loadAISettings } from "../ai/settings.js";

const ASSET_SYSTEM = `You build one original hard-surface asset for a mobile street game.
No people, faces, animals, or characters. No real car brands or trademarked names.
Output command lines only. No prose, no markdown. 8 to 22 lines.

Start with:
NAME short-kebab-name
SLOT paint #hex
BUDGET 6000
BLOCKOUT

Then solids. Meters. Y is up. Ground is y=0. A box's y is its center, so a box of height h on the ground uses y=h/2. Forward is +Z.

BOX x y z width height depth slot
CYL x y z radius height axis slot
CONE x y z radius height axis slot
SUB BOX x y z width height depth
SUB CYL x y z radius height axis
PIVOT name x y z

Slots: paint glass rubber metal concrete brick asphalt light
Axis: x y z
SUB cuts only the previous solid.
One object, readable from a third-person camera. Under 4 meters tall unless it is a street light.`;

const LEVEL_SYSTEM = `You lay out ONE city block for a mobile street game. No people, faces, animals, or characters. No real brands.
Output command lines only. No prose, no markdown.

NAME kebab-name
LEVEL
ROAD 32
SHOP x z #hex
CAR x z yaw #hex
BIN x z
LAMP x z
PROP name x z
BOX/CYL/CONE lines for that prop only, then END

The street runs along Z. The road is centered on x=0 and is 7 meters wide.
Shops on the left use x around -8. Shops on the right use x around 8. Space shops about 10 meters apart in z. Put shops on BOTH sides.
Cars stay in the lanes: x -1.5 or 1.5. yaw is 0 or 180.
Bins and lamps sit on the sidewalk, x around -5 or 5.
Use 4 shops, 2 cars, 2 bins, 4 lamps, and 1 small prop. ROAD from 28 to 40.
A prop is street furniture under 2 meters. Colors are #hex.`;

export const SAMPLE_LEVEL = [
  "NAME sample-block",
  "LEVEL",
  "ROAD 32",
  "SHOP -8 -8 #efe6d4",
  "SHOP 8 -8 #b5523a",
  "SHOP -8 8 #1c3d66",
  "SHOP 8 8 #c4b8a2",
  "CAR -1.5 2 0 #1c3d66",
  "CAR 1.5 -6 180 #6e2a2a",
  "BIN -5 12",
  "BIN 5 -12",
  "LAMP -5 -14",
  "LAMP 5 0",
  "LAMP -5 14",
  "LAMP 5 14",
  "PROP crate 5 6",
  "BOX 0 0.4 0 0.8 0.8 0.8 paint",
  "END"
];

function linesFrom(text) {
  return String(text || "")
    .replace(/```[\w]*\n?/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/^\d+[\).\]]\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
}

export async function askArtist({ brief, scope }) {
  const level = scope === "level";
  const user = level
    ? (brief ? `Lay out this block: ${brief}` : "Free rein. Lay out one city block with shops on both sides, two cars, bins, lamps, and one prop.")
    : (brief ? `Build this street asset: ${brief}` : "Free rein. Build one street asset: a vehicle, a shop mass, or a prop. Do not default to a plain sedan.");
  const hook = typeof window !== "undefined" && window.__assetArtist;
  if (typeof hook === "function") {
    const res = await hook({ brief: brief || "", scope: level ? "level" : "asset" });
    const lines = linesFrom(res && (res.lines ? res.lines.join("\n") : res.text)).slice(0, level ? 64 : 28);
    if (res && res.ok && lines.length) return { ok: true, lines };
    if (res && res.error) return { ok: false, error: res.error };
  }
  const key = (loadAISettings().xaiKey || "").trim();
  if (!key) {
    return {
      ok: false,
      sample: level,
      error: "The artist needs an xAI key in AI settings. SEDAN, SHOP, and BIN still build without one."
    };
  }
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "grok-4.5",
      reasoning_effort: "low",
      temperature: brief ? 0.4 : 0.8,
      max_tokens: level ? 1600 : 1200,
      messages: [
        { role: "system", content: level ? LEVEL_SYSTEM : ASSET_SYSTEM },
        { role: "user", content: user }
      ]
    })
  });
  if (!res.ok) return { ok: false, error: "The artist could not answer (" + res.status + ")." };
  const payload = await res.json();
  const lines = linesFrom(payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content).slice(0, level ? 64 : 28);
  if (!lines.length) return { ok: false, error: "The artist returned an empty drawing." };
  return { ok: true, lines };
}
