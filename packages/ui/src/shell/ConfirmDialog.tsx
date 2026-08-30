"use client";

/**
 * ConfirmDialog — the one confirmation pattern (destructive or not).
 * All labels arrive via props; `busy` locks the dialog during the action.
 */

import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import type { ReactNode } from "react";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Localized body; a string renders as DialogContentText, nodes render as-is. */
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Styles the confirm action as destructive (error color). */
  readonly destructive?: boolean;
  /** Confirm in flight: spinner on confirm, everything disabled. */
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const busy = props.busy === true;
  return (
    <Dialog
      open={props.open}
      onClose={busy ? undefined : props.onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby="jenova-confirm-title"
    >
      <DialogTitle id="jenova-confirm-title">{props.title}</DialogTitle>
      {props.description !== undefined && (
        <DialogContent>
          {typeof props.description === "string" ? (
            <DialogContentText>{props.description}</DialogContentText>
          ) : (
            props.description
          )}
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={props.onCancel} disabled={busy} color="inherit">
          {props.cancelLabel}
        </Button>
        <Button
          onClick={props.onConfirm}
          disabled={busy}
          variant="contained"
          color={props.destructive === true ? "error" : "primary"}
          {...(busy ? { startIcon: <CircularProgress color="inherit" size={16} /> } : {})}
        >
          {props.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
