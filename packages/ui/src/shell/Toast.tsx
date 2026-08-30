"use client";

/**
 * Toast system — ToastProvider renders a single Snackbar queue;
 * `useToast()` enqueues. Messages are localized by the caller.
 *
 * Anchored bottom-"left": the per-direction emotion cache flips the
 * physical CSS, so this is bottom-START in both directions.
 */

import Alert, { type AlertColor } from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ToastOptions {
  /** Localized message (apps own catalogs). */
  readonly message: ReactNode;
  readonly severity?: AlertColor;
  readonly autoHideMs?: number;
  /** Trailing action, e.g. an undo Button. */
  readonly action?: ReactNode;
}

export interface ToastApi {
  readonly show: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error("useToast requires a <ToastProvider> ancestor (mount it inside AppShell)");
  }
  return api;
}

interface QueuedToast extends ToastOptions {
  readonly key: number;
}

export function ToastProvider(props: { readonly children: ReactNode }): ReactNode {
  const queueRef = useRef<QueuedToast[]>([]);
  const nextKeyRef = useRef(0);
  const [current, setCurrent] = useState<QueuedToast | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback((toast: ToastOptions) => {
    queueRef.current.push({ ...toast, key: nextKeyRef.current++ });
    setCurrent((active) => {
      if (active !== null) return active; // exited handler advances the queue
      const next = queueRef.current.shift() ?? null;
      if (next !== null) setOpen(true);
      return next;
    });
  }, []);

  const handleClose = useCallback((_event: unknown, reason?: string) => {
    if (reason === "clickaway") return;
    setOpen(false);
  }, []);

  const handleExited = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    setCurrent(next);
    if (next !== null) setOpen(true);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      {current !== null && (
        <Snackbar
          key={current.key}
          open={open}
          autoHideDuration={current.autoHideMs ?? 5000}
          onClose={handleClose}
          slotProps={{ transition: { onExited: handleExited } }}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        >
          <Alert
            severity={current.severity ?? "info"}
            variant="filled"
            onClose={() => setOpen(false)}
            {...(current.action !== undefined ? { action: current.action } : {})}
            sx={{ minWidth: 280 }}
          >
            {current.message}
          </Alert>
        </Snackbar>
      )}
    </ToastContext.Provider>
  );
}
