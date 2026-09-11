"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonVariant } from "./button";
import { Icons } from "./icons";
import { Textarea, FormField } from "./form";

function useLockedBody(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
}

function useFocusTrap(open: boolean, ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const first = focusable()[0];
    (first ?? node)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0]!, lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previouslyFocused?.focus?.(); };
  }, [open, ref, onClose]);
}

const noop = () => () => undefined;
function Portal({ children }: { children: ReactNode }) {
  // Render into document.body only on the client, without a setState-in-effect.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return mounted ? createPortal(children, document.body) : null;
}

export function Dialog({ open, onClose, title, description, children, footer, size, icon }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "lg"; icon?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLockedBody(open);
  useFocusTrap(open, ref, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={ref} className={`dialog${size ? ` dialog--${size}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="dialog__header">
            {icon}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id={titleId} className="dialog__title">{title}</h2>
              {description && <p className="text-secondary" style={{ marginTop: 4 }}>{description}</p>}
            </div>
            <Button variant="ghost" size="sm" iconOnly icon={<Icons.X size={18} />} onClick={onClose}>Close</Button>
          </div>
          {children && <div className="dialog__body">{children}</div>}
          {footer && <div className="dialog__footer">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** Consequence-specific details shown as a list or summary. */
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ButtonVariant;
  tone?: "danger" | "warning" | "primary";
  /** When set, a required textarea is rendered and its value passed to onConfirm. */
  reason?: { label: string; placeholder?: string; help?: string };
}

export function ConfirmDialog({ open, onClose, onConfirm, options, busy }: { open: boolean; onClose: () => void; onConfirm: (reason?: string) => Promise<void> | void; options: ConfirmOptions; busy?: boolean }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  function reset() { setReason(""); setTouched(false); }
  function close() { reset(); onClose(); }
  const needsReason = !!options.reason;
  const reasonMissing = needsReason && reason.trim().length === 0;
  const tone = options.tone ?? (options.variant === "danger" ? "danger" : "primary");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (reasonMissing) return;
    await onConfirm(needsReason ? reason.trim() : undefined);
    reset();
  }
  return (
    <Dialog open={open} onClose={busy ? () => undefined : close} title={options.title} description={options.description}
      icon={<span className={`dialog__icon dialog__icon--${tone}`}>{tone === "primary" ? <Icons.HelpCircle size={22} /> : <Icons.Alert size={22} />}</span>}>
      <form onSubmit={submit} className="stack" id="confirm-form">
        {options.details}
        {options.reason && (
          <FormField label={options.reason.label} required help={options.reason.help} error={touched && reasonMissing ? "Please provide a reason." : undefined} htmlFor="confirm-reason">
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={options.reason.placeholder} rows={3} maxLength={1000} invalid={touched && reasonMissing} autoFocus />
          </FormField>
        )}
        <div className="dialog__footer" style={{ padding: 0 }}>
          <Button variant="secondary" onClick={close} disabled={busy}>{options.cancelLabel ?? "Cancel"}</Button>
          <Button type="submit" variant={options.variant ?? "primary"} loading={busy}>{options.confirmLabel ?? "Confirm"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLockedBody(open);
  useFocusTrap(open, ref, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="overlay overlay--drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="drawer__header">
            <h2 id={titleId} className="h-section">{title}</h2>
            <Button variant="ghost" size="sm" iconOnly icon={<Icons.X size={18} />} onClick={onClose}>Close</Button>
          </div>
          <div className="drawer__body">{children}</div>
          {footer && <div className="drawer__footer">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
