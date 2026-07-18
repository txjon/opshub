"use client";
import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { T } from "@/lib/theme";

type Opts = { title: string; message: string; confirmLabel?: string; confirmColor?: string };
type State = Opts & { resolve: (v: boolean) => void };

// Promise-based styled confirm (DESIGN.md: no browser confirm()). Drop-in for
// `if (!window.confirm(msg)) return;` → `if (!await confirm({title, message})) return;`.
// Render the returned element once in the component; control flow is preserved
// exactly, so destructive-action guards stay intact.
export function useConfirm(): [(o: Opts) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<State | null>(null);
  const confirm = useCallback((o: Opts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  const el = (
    <ConfirmDialog
      open={!!state}
      title={state?.title || ""}
      message={state?.message || ""}
      confirmLabel={state?.confirmLabel}
      confirmColor={state?.confirmColor ?? T.red}
      onConfirm={() => done(true)}
      onCancel={() => done(false)}
    />
  );
  return [confirm, el];
}
