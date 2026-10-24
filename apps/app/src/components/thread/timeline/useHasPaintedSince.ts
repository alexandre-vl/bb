import { useEffect, useState } from "react";

export function useHasPaintedSince(key: string | null): boolean {
  const [paintedKey, setPaintedKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null || paintedKey === key) return;
    let timeout: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => setPaintedKey(key), 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [key, paintedKey]);
  return key === null || paintedKey === key;
}
