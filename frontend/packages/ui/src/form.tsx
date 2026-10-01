"use client";
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icons } from "./icons";

interface FieldProps { label: ReactNode; htmlFor?: string; required?: boolean; optional?: boolean; help?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }

export function FormField({ label, htmlFor, required, optional, help, error, children, className }: FieldProps) {
  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="field__required" aria-hidden>*</span>}
        {optional && <span className="field__optional">(optional)</span>}
      </label>
      {children}
      {error ? <div className="field__error" role="alert">{error}</div> : help ? <div className="field__help">{help}</div> : null}
    </div>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="form-section" aria-label={title}>
      <div className="form-section__header">
        <h3 className="form-section__title">{title}</h3>
        {description && <p className="form-section__description">{description}</p>}
      </div>
      {children}
    </section>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} className={`input${className ? ` ${className}` : ""}`} aria-invalid={invalid || undefined} {...rest} />;
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className, children, ...rest }, ref) {
  return <select ref={ref} className={`select${className ? ` ${className}` : ""}`} aria-invalid={invalid || undefined} {...rest}>{children}</select>;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} className={`textarea${className ? ` ${className}` : ""}`} aria-invalid={invalid || undefined} {...rest} />;
});

/** Rupee input. Keeps the raw string so users can type freely; parent parses. */
export function MoneyInput({ value, onChange, invalid, id, ...rest }: Omit<InputProps, "value" | "onChange"> & { value: string | number; onChange: (value: string) => void }) {
  return (
    <div className="input-group">
      <span className="input-group__prefix" aria-hidden>₹</span>
      <Input id={id} inputMode="decimal" className="input--money" value={value} invalid={invalid} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

export function PasswordInput({ invalid, id, ...rest }: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-group">
      <Input id={id} type={visible ? "text" : "password"} invalid={invalid} style={{ paddingLeft: 12, paddingRight: 44 }} {...rest} />
      <button type="button" className="btn btn--ghost btn--sm btn--icon input-group__suffix" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
        {visible ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
      </button>
    </div>
  );
}

export function Checkbox({ label, checked, onChange, id, disabled, description }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; id?: string; disabled?: boolean; description?: ReactNode }) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label className="checkbox" htmlFor={inputId}>
      <input id={inputId} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span>{label}</span>
        {description && <span className="field__help" style={{ display: "block" }}>{description}</span>}
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", id, label = "Search" }: { value: string; onChange: (value: string) => void; placeholder?: string; id?: string; label?: string }) {
  return (
    <div className="search">
      <span className="search__icon"><Icons.Search size={16} /></span>
      <Input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </div>
  );
}

/** Radio-like choice card group. */
export function ChoiceCard({ selected, onSelect, title, description, points, icon, disabled }: { selected: boolean; onSelect: () => void; title: ReactNode; description?: ReactNode; points?: string[]; icon?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="choice" aria-pressed={selected} onClick={onSelect} disabled={disabled}>
      <span className="choice__title">{icon}{title}{selected && <Icons.CheckCircle size={16} style={{ marginLeft: "auto", color: "var(--color-primary-700)" }} />}</span>
      {description && <span className="choice__desc">{description}</span>}
      {points && <ul className="choice__list">{points.map((point) => <li key={point}>{point}</li>)}</ul>}
    </button>
  );
}
