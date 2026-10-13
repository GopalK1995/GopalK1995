import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow] duration-150 ease-out disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-strong shadow-1",
        secondary: "bg-surface text-ink border border-line-strong hover:bg-paper-2 shadow-1",
        ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink",
        navy: "bg-navy-900 text-navy-ink hover:bg-navy-800",
        danger: "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
        link: "text-accent hover:underline underline-offset-4 px-0",
      },
      size: { sm: "h-8 px-3 text-[13px] rounded-sm", md: "h-9 px-4 text-[13px] rounded-sm", lg: "h-10 px-5 text-sm rounded-sm", icon: "size-8 rounded-sm" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
