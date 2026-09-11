"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, type ConfirmOptions } from "@/components/ui/dialog";

export interface ConfirmResult { confirmed: boolean; reason?: string }
type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Promise-based confirmation so features can `await confirm({...})` instead of window.confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((result: ConfirmResult) => void) | null>(null);
  const confirm = useCallback<ConfirmFn>((next) => new Promise((resolve) => { resolver.current = resolve; setOptions(next); }), []);
  const close = useCallback((result: ConfirmResult) => { resolver.current?.(result); resolver.current = null; setOptions(null); }, []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && <ConfirmDialog open onClose={() => close({ confirmed: false })} onConfirm={(reason) => close({ confirmed: true, reason })} options={options} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used inside ConfirmProvider.");
  return context;
}
