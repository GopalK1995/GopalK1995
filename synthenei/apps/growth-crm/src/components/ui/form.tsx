"use client";
// Form + Field wrappers. Field = label + control + help + error, wired with ids and aria. Form = react-hook-form provider.
import { Children, cloneElement, isValidElement, useId, type FormHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Controller, FormProvider, useFormContext, type FieldValues, type UseFormReturn, type Control, type FieldPath } from "react-hook-form";
import { cn } from "@/lib/utils";

export type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

export function Field({ label, help, error, required, className, children }: {
  label: ReactNode; help?: ReactNode; error?: ReactNode; required?: boolean; className?: string;
  /** A control element (gets id and aria props injected) or a render function receiving them. */
  children: ReactElement<Record<string, unknown>> | ((p: ControlProps) => ReactNode);
}) {
  const uid = useId();
  const id = `${uid}-c`, helpId = `${uid}-h`, errId = `${uid}-e`;
  const describedBy = [error ? errId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;
  const props: ControlProps = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };
  const control = typeof children === "function" ? children(props) : isValidElement(Children.only(children)) ? cloneElement(children, props as unknown as Record<string, unknown>) : children;
  return (
    <div className={cn("grid gap-1", className)}>
      <label htmlFor={id} className="text-13 font-medium text-ink">{label}{required && <span className="text-danger" aria-hidden> *</span>}</label>
      {control}
      {help && <p id={helpId} className="text-12 text-ink-3">{help}</p>}
      {error && <p id={errId} role="alert" className="text-12 text-danger">{error}</p>}
    </div>
  );
}

const inputCls = "h-8 w-full rounded-control border border-line-strong bg-surface px-2.5 text-13 text-ink placeholder:text-ink-3 aria-invalid:border-danger disabled:opacity-45";
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...p} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, "min-h-20 py-1.5", className)} {...p} />;
}

/** `<form>` bound to a react-hook-form instance (use zodResolver for field_defs driven schemas). */
export function Form<T extends FieldValues>({ form, onSubmit, className, children, ...p }: Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  form: UseFormReturn<T>; onSubmit: (values: T) => void | Promise<void>;
}) {
  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className={cn("grid gap-4", className)} {...p}>{children}</form>
    </FormProvider>
  );
}

/** Field bound to a form value; shows the validation message under the control. */
export function FormField<T extends FieldValues>({ name, label, help, required, control, render }: {
  name: FieldPath<T>; label: ReactNode; help?: ReactNode; required?: boolean; control?: Control<T>;
  render: (p: ControlProps & { value: unknown; onChange: (v: unknown) => void; onBlur: () => void; name: string }) => ReactNode;
}) {
  const ctx = useFormContext<T>();
  return (
    <Controller name={name} control={control ?? ctx.control} render={({ field, fieldState }) => (
      <Field label={label} help={help} required={required} error={fieldState.error?.message}>
        {(c) => render({ ...c, value: field.value, onChange: field.onChange, onBlur: field.onBlur, name: field.name })}
      </Field>
    )} />
  );
}
