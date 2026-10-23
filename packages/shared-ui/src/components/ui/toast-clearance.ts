export const TOAST_BOTTOM_CLEARANCE_PROPERTY = "--bb-toast-bottom-clearance";

export function setToastBottomClearance(
  document: Document,
  clearance: number | null,
): void {
  const style = document.documentElement.style;
  if (clearance === null) {
    style.removeProperty(TOAST_BOTTOM_CLEARANCE_PROPERTY);
    return;
  }
  style.setProperty(
    TOAST_BOTTOM_CLEARANCE_PROPERTY,
    `${Math.max(0, Math.round(clearance))}px`,
  );
}
