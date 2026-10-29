import { Noto_Sans_Tamil } from "next/font/google";

/** Declared at module level (next/font requirement); the root layout applies it only when locale = ta. */
export const notoSansTamil = Noto_Sans_Tamil({ subsets: ["tamil"], display: "swap", preload: false, variable: "--font-tamil" });
