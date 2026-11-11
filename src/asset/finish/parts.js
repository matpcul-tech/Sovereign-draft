export const STRUCTURES = [
  { id: "door_fl", label: "Door FL", seDoor: "fl" },
  { id: "door_fr", label: "Door FR", seDoor: "fr" },
  { id: "door_rl", label: "Door RL", seDoor: "rl" },
  { id: "door_rr", label: "Door RR", seDoor: "rr" },
  { id: "wheel_fl", label: "Wheel FL", steer: true },
  { id: "wheel_fr", label: "Wheel FR", steer: true },
  { id: "wheel_rl", label: "Wheel RL", steer: false },
  { id: "wheel_rr", label: "Wheel RR", steer: false }
];

export const MATERIAL_ROLES = [
  { id: "paint", label: "Paint" },
  { id: "glass", label: "Glass" },
  { id: "trim", label: "Trim" },
  { id: "light", label: "Lights" }
];

export function structureById(id) {
  return STRUCTURES.find((item) => item.id === id) || null;
}

export function isDoor(id) {
  return id.startsWith("door_");
}

export function isWheel(id) {
  return id.startsWith("wheel_");
}
