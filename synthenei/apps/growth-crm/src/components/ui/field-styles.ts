// ONE shared text-input class. Every Input, Textarea, Select trigger and ad-hoc field uses these so the resting
// border (--field-line, 3:1 on the surface: WCAG 1.4.11) and the focus ring (.focus-ring) cannot drift apart.
/** Border, fill, placeholder, focus ring, invalid and disabled states. No size: compose with `fieldCls` or your own height. */
export const fieldBase =
  "rounded-sm border border-field-line bg-surface text-ink placeholder:text-ink-3 focus-ring focus:border-ring aria-invalid:border-danger disabled:opacity-60";
/** The common 36 px form field. */
export const fieldCls = `${fieldBase} h-9 w-full px-2.5 text-[13px]`;
