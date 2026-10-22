export const SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE =
  "data-sidebar-windowed-attention-counts";

export interface SidebarWindowedAttention {
  needsYou: number;
  failed: number;
}

export function encodeSidebarWindowedAttention({
  needsYou,
  failed,
}: SidebarWindowedAttention): string | undefined {
  return needsYou + failed > 0 ? `${needsYou} ${failed}` : undefined;
}

export function parseSidebarWindowedAttention(
  value: string | null,
): SidebarWindowedAttention | null {
  const [needsYou, failed] = (value ?? "").split(" ").map(Number);
  if (
    needsYou === undefined ||
    failed === undefined ||
    !Number.isInteger(needsYou) ||
    !Number.isInteger(failed) ||
    needsYou + failed <= 0
  ) {
    return null;
  }
  return { needsYou, failed };
}
