import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { DisabledReason } from "./disabled-reason";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color] duration-150 ease-out disabled:pointer-events-none disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-strong aria-disabled:hover:bg-accent",
        quiet: "bg-surface text-ink border border-line-strong hover:bg-paper-2 aria-disabled:hover:bg-surface",
        /** legacy name for `quiet`; kept so existing imports keep working */
        secondary: "bg-surface text-ink border border-line-strong hover:bg-paper-2 aria-disabled:hover:bg-surface",
        ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink",
        navy: "bg-navy-900 text-navy-ink hover:bg-navy-800",
        danger: "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
        link: "text-accent hover:underline underline-offset-4 px-0",
      },
      size: { sm: "h-7 px-2.5 text-13 rounded-control", md: "h-8 px-3 text-13 rounded-control", lg: "h-10 px-5 text-14 rounded-control", icon: "size-8 rounded-control" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renders the button disabled and explains why in a tooltip (missing permission, missing approval). */
  disabledReason?: string;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, disabledReason, ...props }, ref) => (
  <DisabledReason reason={disabledReason}>
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  </DisabledReason>
));
Button.displayName = "Button";
