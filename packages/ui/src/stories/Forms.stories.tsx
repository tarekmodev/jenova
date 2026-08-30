/**
 * FormField wrappers: label/hint/error display, RTL-correct.
 */

import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "../shell/FormField";
import { pickCopy } from "./support";

const meta: Meta<typeof FormField> = {
  title: "Shell/FormField",
  component: FormField,
};
export default meta;

export const States: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: {
        name: "اسم الوكالة",
        nameHint: "كما سيظهر على القسائم",
        nationality: "الجنسية",
        nationalityHint: "معيار البحث الأساسي للأسعار",
        email: "البريد الإلكتروني",
        emailError: "صيغة البريد الإلكتروني غير صحيحة",
        sample: "وكالة تجريبية",
        saudi: "السعودية",
        uae: "الإمارات",
      },
      en: {
        name: "Agency name",
        nameHint: "As it appears on vouchers",
        nationality: "Nationality",
        nationalityHint: "Primary rate search parameter",
        email: "Email",
        emailError: "Not a valid email address",
        sample: "Synthetic Agency",
        saudi: "Saudi Arabia",
        uae: "United Arab Emirates",
      },
    });
    return (
      <Stack spacing={3} sx={{ maxWidth: 420 }}>
        <FormField label={copy.name} hint={copy.nameHint} required>
          {(fieldId) => <TextField id={fieldId} defaultValue={copy.sample} size="small" />}
        </FormField>
        <FormField label={copy.nationality} hint={copy.nationalityHint} required>
          {(fieldId) => (
            <TextField id={fieldId} select defaultValue="sa" size="small">
              <MenuItem value="sa">{copy.saudi}</MenuItem>
              <MenuItem value="ae">{copy.uae}</MenuItem>
            </TextField>
          )}
        </FormField>
        <FormField label={copy.email} error={copy.emailError}>
          {(fieldId) => <TextField id={fieldId} defaultValue="not-an-email" size="small" error />}
        </FormField>
      </Stack>
    );
  },
};
