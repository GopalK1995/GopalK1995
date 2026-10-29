import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom type scale (--text-12 ... --text-26 in globals.css). Without this, tailwind-merge reads
// `text-12` as a colour and drops it when a text colour follows (the Kbd 12px bug found at gate 1).
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["12", "13", "14", "15", "19", "22", "26"] }] } },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
