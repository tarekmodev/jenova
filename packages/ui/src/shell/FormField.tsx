"use client";

/**
 * FormField — the labeled/validated wrapper every form control sits in.
 *
 * Label above the control (both directions — logical flow handles RTL),
 * helper line shows the error when present, else the hint. All strings
 * arrive via props.
 */

import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import { useId, type ReactNode } from "react";

export interface FormFieldProps {
  readonly label: string;
  /** Localized validation message; its presence styles the field as errored. */
  readonly error?: string;
  readonly hint?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** id of the wrapped control; generated when omitted (use `fieldId` render arg). */
  readonly htmlFor?: string;
  readonly fullWidth?: boolean;
  /** The control itself — receives the field id for label association. */
  readonly children: ReactNode | ((fieldId: string) => ReactNode);
}

export function FormField(props: FormFieldProps): ReactNode {
  const generatedId = useId();
  const fieldId = props.htmlFor ?? generatedId;
  const helper = props.error ?? props.hint;

  return (
    <FormControl
      error={props.error !== undefined}
      required={props.required === true}
      disabled={props.disabled === true}
      fullWidth={props.fullWidth !== false}
    >
      <FormLabel
        htmlFor={fieldId}
        sx={{ marginBlockEnd: 0.75, fontWeight: 600, color: "text.primary", fontSize: "0.875rem" }}
      >
        {props.label}
      </FormLabel>
      {typeof props.children === "function" ? props.children(fieldId) : props.children}
      {helper !== undefined && (
        <FormHelperText sx={{ marginInline: 0 }}>{helper}</FormHelperText>
      )}
    </FormControl>
  );
}
