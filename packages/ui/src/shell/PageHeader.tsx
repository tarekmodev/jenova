"use client";

/**
 * PageHeader — title row every dashboard page opens with:
 * breadcrumbs (slot), title + subtitle, trailing actions.
 */

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Usually <Breadcrumbs> with the app's localized trail. */
  readonly breadcrumbs?: ReactNode;
  /** Trailing actions (primary Button etc.). */
  readonly actions?: ReactNode;
}

export function PageHeader(props: PageHeaderProps): ReactNode {
  return (
    <Box sx={{ marginBlockEnd: 3 }}>
      {props.breadcrumbs !== undefined && (
        <Box sx={{ marginBlockEnd: 1 }}>{props.breadcrumbs}</Box>
      )}
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
        useFlexGap
        flexWrap="wrap"
      >
        <Box>
          <Typography variant="h4" component="h1">
            {props.title}
          </Typography>
          {props.subtitle !== undefined && (
            <Typography variant="body1" color="text.secondary" sx={{ marginBlockStart: 0.5 }}>
              {props.subtitle}
            </Typography>
          )}
        </Box>
        {props.actions !== undefined && (
          <Stack direction="row" spacing={1} alignItems="center">
            {props.actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
