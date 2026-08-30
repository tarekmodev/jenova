"use client";

/**
 * StatusStates — the four canonical non-content states every dashboard
 * surface renders the same way: empty, error, loading, forbidden.
 * All text arrives via props — the apps own the ar/en catalogs.
 */

import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export interface StatusStateProps {
  readonly title: string;
  readonly description?: string;
  /** Usually a retry/create Button. */
  readonly action?: ReactNode;
  /** Tighter paddings for inline placements (table bodies, cards). */
  readonly dense?: boolean;
}

interface AppearanceProps extends StatusStateProps {
  readonly icon: ReactNode;
}

function StatusStateBase(props: AppearanceProps): ReactNode {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1}
      sx={{ paddingBlock: props.dense ? 3 : 8, paddingInline: 3, textAlign: "center" }}
    >
      {props.icon}
      <Typography variant="h5" component="p">
        {props.title}
      </Typography>
      {props.description !== undefined && (
        <Typography variant="body1" color="text.secondary">
          {props.description}
        </Typography>
      )}
      {props.action !== undefined && <Box sx={{ paddingBlockStart: 1 }}>{props.action}</Box>}
    </Stack>
  );
}

export function EmptyState(props: StatusStateProps): ReactNode {
  return (
    <StatusStateBase
      {...props}
      icon={<InboxOutlinedIcon sx={{ fontSize: 44, color: "text.secondary" }} />}
    />
  );
}

export function ErrorState(props: StatusStateProps): ReactNode {
  return (
    <StatusStateBase
      {...props}
      icon={<ErrorOutlineIcon sx={{ fontSize: 44, color: "error.main" }} />}
    />
  );
}

export function ForbiddenState(props: StatusStateProps): ReactNode {
  return (
    <StatusStateBase
      {...props}
      icon={<LockOutlinedIcon sx={{ fontSize: 44, color: "warning.main" }} />}
    />
  );
}

export interface LoadingStateProps {
  /** Accessible label for the spinner (i18n via props). */
  readonly label?: string;
  readonly dense?: boolean;
}

export function LoadingState(props: LoadingStateProps): ReactNode {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={2}
      sx={{ paddingBlock: props.dense ? 3 : 8, paddingInline: 3 }}
    >
      <CircularProgress size={32} {...(props.label !== undefined ? { "aria-label": props.label } : {})} />
      {props.label !== undefined && (
        <Typography variant="body1" color="text.secondary">
          {props.label}
        </Typography>
      )}
    </Stack>
  );
}
