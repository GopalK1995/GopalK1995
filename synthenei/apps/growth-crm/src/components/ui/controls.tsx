"use client";
// Form controls on Radix, restyled to tokens: Select, Popover, Switch, Checkbox, RadioGroup.
import * as S from "@radix-ui/react-select";
import * as P from "@radix-ui/react-popover";
import * as SW from "@radix-ui/react-switch";
import * as CB from "@radix-ui/react-checkbox";
import * as RG from "@radix-ui/react-radio-group";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DisabledReason } from "./disabled-reason";

const field = "h-8 rounded-control border border-line-strong bg-surface px-2.5 text-13 text-ink placeholder:text-ink-3 aria-invalid:border-danger disabled:opacity-45 aria-disabled:opacity-45";

export type Option = { value: string; label: string; disabled?: boolean };

export function Select({ value, onValueChange, options, placeholder = "Select", disabled, disabledReason, invalid, id, className, ...aria }: {
  value?: string; onValueChange?: (v: string) => void; options: Option[]; placeholder?: string; disabled?: boolean; disabledReason?: string;
  invalid?: boolean; id?: string; className?: string; "aria-label"?: string; "aria-describedby"?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled || !!disabledReason}>
      <DisabledReason reason={disabledReason}>
        <S.Trigger id={id} aria-invalid={invalid || undefined} {...aria} className={cn(field, "inline-flex w-full min-w-40 items-center justify-between gap-2", className)}>
          <S.Value placeholder={placeholder} />
          <S.Icon><ChevronDown className="size-3.5 text-ink-3" aria-hidden /></S.Icon>
        </S.Trigger>
      </DisabledReason>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-control border border-line bg-surface p-1 shadow-pop">
          <S.Viewport>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="flex h-8 cursor-default select-none items-center gap-2 rounded-chip px-2 text-13 text-ink outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-paper-2">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="ml-auto"><Check className="size-3.5 text-accent" aria-hidden /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ children, className, align = "start" }: { children: ReactNode; className?: string; align?: "start" | "center" | "end" }) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={6} className={cn("zone-work z-50 w-72 rounded-control border border-line bg-surface shadow-pop focus:outline-none", className)}>{children}</P.Content>
    </P.Portal>
  );
}

export function Switch({ className, disabledReason, ...p }: SW.SwitchProps & { disabledReason?: string }) {
  return (
    <DisabledReason reason={disabledReason}>
      <SW.Root {...p} disabled={p.disabled} className={cn("relative h-5 w-9 shrink-0 rounded-round border border-line-strong bg-paper-2 transition-colors duration-150 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45 aria-disabled:opacity-45", className)}>
        <SW.Thumb className="block size-3.5 translate-x-0.5 rounded-round bg-surface shadow-none ring-1 ring-line-strong transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:ring-0" />
      </SW.Root>
    </DisabledReason>
  );
}

export function Checkbox({ className, disabledReason, ...p }: CB.CheckboxProps & { disabledReason?: string }) {
  return (
    <DisabledReason reason={disabledReason}>
      <CB.Root {...p} className={cn("grid size-4 shrink-0 place-items-center rounded-chip border border-line-strong bg-surface data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:opacity-45 aria-disabled:opacity-45", className)}>
        <CB.Indicator className="text-accent-ink"><Check className="size-3" strokeWidth={2.5} aria-hidden /></CB.Indicator>
      </CB.Root>
    </DisabledReason>
  );
}

export function RadioGroup({ options, className, ...p }: RG.RadioGroupProps & { options: Option[] }) {
  return (
    <RG.Root {...p} className={cn("grid gap-2", className)}>
      {options.map((o) => {
        const id = `${p.name ?? "rg"}-${o.value}`;
        return (
          <div key={o.value} className="flex items-center gap-2">
            <RG.Item id={id} value={o.value} disabled={o.disabled} className="grid size-4 place-items-center rounded-round border border-line-strong bg-surface data-[state=checked]:border-accent disabled:opacity-45">
              <RG.Indicator className="size-2 rounded-round bg-accent" />
            </RG.Item>
            <label htmlFor={id} className="text-13 text-ink">{o.label}</label>
          </div>
        );
      })}
    </RG.Root>
  );
}
