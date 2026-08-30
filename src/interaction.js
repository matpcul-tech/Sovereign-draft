/* Ephemeral interaction state shared between input handling and rendering.
 * Nothing here is part of the document or the undo history.
 */
export const ix = {
  pointers: new Map(),
  gesture: null,
  drag: null,
  polyPts: [],
  hoverPt: null,
  snapMark: null,
  pendingTextPt: null,
  editTextId: null,
  assignMode: false
};
