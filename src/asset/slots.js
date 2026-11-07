const SLOTS = new Set(["paint", "glass", "rubber", "metal", "concrete", "brick", "asphalt", "light"]);
export function isSlot(value){
  return SLOTS.has(String(value || "").toLowerCase());
}
