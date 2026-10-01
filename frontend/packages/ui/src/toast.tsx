"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icons } from "./icons";

type ToastVariant = "success" | "error" | "info";
interface Toast { id: number; variant: ToastVariant; title: string; description?: string }
interface ToastApi { success(title: string, description?: string): void; error(title: string, description?: string): void; info(title: string, description?: string): void }

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((variant: ToastVariant, title: string, description?: string) => {
    const id = ++counter.current;
    // Collapse duplicates so repeated operations don't stack identical toasts.
    setToasts((list) => [...list.filter((t) => !(t.title === title && t.description === description)), { id, variant, title, description }].slice(-4));
    window.setTimeout(() => dismiss(id), variant === "error" ? 7000 : 4500);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    success: (t, d) => push("success", t, d), error: (t, d) => push("error", t, d), info: (t, d) => push("info", t, d),
  }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toaster" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.variant}`} role={toast.variant === "error" ? "alert" : "status"}>
            <span className="toast__icon">{toast.variant === "success" ? <Icons.CheckCircle size={18} /> : toast.variant === "error" ? <Icons.Alert size={18} /> : <Icons.Info size={18} />}</span>
            <div style={{ minWidth: 0 }}>
              <div className="toast__title">{toast.title}</div>
              {toast.description && <div className="toast__desc">{toast.description}</div>}
            </div>
            <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><Icons.X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider.");
  return context;
}
