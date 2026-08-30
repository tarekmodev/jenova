/**
 * ConfirmDialog, Toast system, PageHeader, StatusStates.
 */

import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, type ReactNode } from "react";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { PageHeader } from "../shell/PageHeader";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "../shell/StatusStates";
import { ToastProvider, useToast } from "../shell/Toast";
import { pickCopy } from "./support";

const meta: Meta = {
  title: "Shell/Feedback",
};
export default meta;

export const ConfirmCancellation: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: {
        title: "إلغاء الحجز؟",
        body: "سيتم تطبيق رسوم الإلغاء وفق سياسة الإلغاء المعروضة.",
        confirm: "تأكيد الإلغاء",
        cancel: "تراجع",
      },
      en: {
        title: "Cancel this booking?",
        body: "The displayed cancellation policy fee will apply.",
        confirm: "Confirm cancellation",
        cancel: "Keep booking",
      },
    });
    return (
      <ConfirmDialog
        open
        destructive
        title={copy.title}
        description={copy.body}
        confirmLabel={copy.confirm}
        cancelLabel={copy.cancel}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
  },
};

function ToastOnMount(props: { readonly message: string; readonly children: ReactNode }): ReactNode {
  const toast = useToast();
  const { message } = props;
  useEffect(() => {
    toast.show({ message, severity: "success", autoHideMs: 60000 });
  }, [toast, message]);
  return props.children;
}

export const Toasts: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: { toast: "تم حفظ الإعدادات", trigger: "إظهار إشعار" },
      en: { toast: "Settings saved", trigger: "Show toast" },
    });
    return (
      <ToastProvider>
        <ToastOnMount message={copy.toast}>
          <TriggerButton label={copy.trigger} message={copy.toast} />
        </ToastOnMount>
      </ToastProvider>
    );
  },
};

function TriggerButton(props: { readonly label: string; readonly message: string }): ReactNode {
  const toast = useToast();
  return (
    <Button
      variant="contained"
      onClick={() => toast.show({ message: props.message, severity: "info" })}
    >
      {props.label}
    </Button>
  );
}

export const Header: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: {
        home: "الرئيسية",
        section: "الحجوزات",
        title: "قائمة الحجوزات",
        subtitle: "جميع حجوزات الوكالة في مكان واحد",
        action: "حجز جديد",
      },
      en: {
        home: "Home",
        section: "Bookings",
        title: "Booking list",
        subtitle: "Every agency booking in one place",
        action: "New booking",
      },
    });
    return (
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        breadcrumbs={
          <Breadcrumbs>
            <Link underline="hover" color="inherit" href="#">
              {copy.home}
            </Link>
            <Typography color="text.primary">{copy.section}</Typography>
          </Breadcrumbs>
        }
        actions={<Button variant="contained">{copy.action}</Button>}
      />
    );
  },
};

export const States: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: {
        emptyTitle: "لا توجد نتائج",
        emptyHint: "عدّل معايير البحث وحاول مجدداً",
        errorTitle: "حدث خطأ ما",
        errorHint: "تعذر إكمال الطلب",
        retry: "إعادة المحاولة",
        forbiddenTitle: "لا تملك صلاحية الوصول",
        forbiddenHint: "اطلب الصلاحية من مدير الحساب",
        loading: "جارٍ التحميل…",
      },
      en: {
        emptyTitle: "No results",
        emptyHint: "Adjust the search criteria and try again",
        errorTitle: "Something went wrong",
        errorHint: "The request could not be completed",
        retry: "Retry",
        forbiddenTitle: "No access",
        forbiddenHint: "Ask an account admin for the permission",
        loading: "Loading…",
      },
    });
    return (
      <Stack spacing={2} divider={<hr style={{ border: "none", blockSize: 1 }} />}>
        <EmptyState title={copy.emptyTitle} description={copy.emptyHint} dense />
        <ErrorState
          title={copy.errorTitle}
          description={copy.errorHint}
          action={<Button variant="outlined">{copy.retry}</Button>}
          dense
        />
        <ForbiddenState title={copy.forbiddenTitle} description={copy.forbiddenHint} dense />
        <LoadingState label={copy.loading} dense />
      </Stack>
    );
  },
};
