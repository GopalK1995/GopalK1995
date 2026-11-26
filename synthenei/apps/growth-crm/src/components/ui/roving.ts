// Arrow-key navigation shared by the WAI-ARIA tablist and radiogroup patterns (roving tabindex).
/** Index to move to for a key press, or -1 when the key is not a navigation key. Wraps at both ends. */
export function rovingTarget(key: string, i: number, n: number): number {
  if (key === "ArrowRight" || key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (i + n - 1) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return -1;
}
