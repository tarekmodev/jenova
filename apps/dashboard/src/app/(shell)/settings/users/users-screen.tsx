"use client";

/**
 * Users & roles (issue #91): list / invite / role assignment /
 * deactivate + the tenant's enforce-2FA policy switch. All writes go
 * through the BFF proxy with the api's own authorization; this screen
 * only renders server answers.
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  EmptyState,
  FormField,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  useToast,
  type DataTableColumn,
} from "@jenova/ui";

export interface StaffUserDto {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly totpEnrolled: boolean;
  readonly createdAt: string;
}

export interface PolicyDto {
  readonly enforceTotp: boolean;
}

const ROLES = ["admin", "operations", "finance", "viewer"] as const;

async function proxy<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/proxy${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { code: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.code ?? "internal_error");
  }
  return body;
}

export function UsersScreen(props: {
  readonly initialUsers: readonly StaffUserDto[];
  readonly initialPolicy: PolicyDto;
  readonly selfId: string;
}): ReactNode {
  const t = useTranslations("settings.users");
  const tr = useTranslations("roles");
  const toast = useToast();
  const [users, setUsers] = useState(props.initialUsers);
  const [policy, setPolicy] = useState(props.initialPolicy);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<StaffUserDto | null>(null);
  const [initialPassword, setInitialPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const body = await proxy<{ users: StaffUserDto[] }>("/staff/users");
    setUsers(body.users);
  };

  const assignRole = async (user: StaffUserDto, role: string): Promise<void> => {
    try {
      await proxy(`/staff/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      await refresh();
      toast.show({ message: t("roleSaved"), severity: "success" });
    } catch {
      toast.show({ message: t("errors.generic"), severity: "error" });
    }
  };

  const setStatus = async (user: StaffUserDto, action: "deactivate" | "activate"): Promise<void> => {
    setBusy(true);
    try {
      await proxy(`/staff/users/${user.id}/${action}`, { method: "POST" });
      await refresh();
      toast.show({
        message: action === "deactivate" ? t("deactivated") : t("activated"),
        severity: "success",
      });
    } catch {
      toast.show({ message: t("errors.generic"), severity: "error" });
    } finally {
      setBusy(false);
      setConfirmDeactivate(null);
    }
  };

  const setEnforceTotp = async (enforceTotp: boolean): Promise<void> => {
    try {
      const body = await proxy<{ policy: PolicyDto }>("/staff/policy", {
        method: "PUT",
        body: JSON.stringify({ enforceTotp }),
      });
      setPolicy(body.policy);
      toast.show({ message: t("policySaved"), severity: "success" });
    } catch {
      toast.show({ message: t("errors.generic"), severity: "error" });
    }
  };

  const columns: readonly DataTableColumn<StaffUserDto>[] = [
    {
      id: "name",
      header: t("columns.name"),
      cell: (user) => (
        <Stack>
          <Typography variant="body2">{user.displayName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {user.email}
          </Typography>
        </Stack>
      ),
      sortable: true,
      sortValue: (user) => user.displayName,
    },
    {
      id: "role",
      header: t("columns.role"),
      cell: (user) => (
        <Select
          size="small"
          value={user.role}
          onChange={(event) => void assignRole(user, event.target.value)}
          disabled={user.id === props.selfId}
          aria-label={t("columns.role")}
        >
          {ROLES.map((role) => (
            <MenuItem key={role} value={role}>
              {tr(role)}
            </MenuItem>
          ))}
        </Select>
      ),
    },
    {
      id: "totp",
      header: t("columns.totp"),
      cell: (user) =>
        user.totpEnrolled ? (
          <Chip size="small" color="success" label={t("totpOn")} />
        ) : (
          <Chip size="small" variant="outlined" label={t("totpOff")} />
        ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (user) =>
        user.status === "active" ? (
          <Chip size="small" color="success" variant="outlined" label={t("statusActive")} />
        ) : (
          <Chip size="small" color="default" label={t("statusDisabled")} />
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (user) =>
        user.id === props.selfId ? null : user.status === "active" ? (
          <Button size="small" color="error" onClick={() => setConfirmDeactivate(user)}>
            {t("deactivate")}
          </Button>
        ) : (
          <Button size="small" onClick={() => void setStatus(user, "activate")}>
            {t("activate")}
          </Button>
        ),
    },
  ];

  return (
    <Stack spacing={3}>
      <Card>
        <CardHeader
          title={t("listTitle")}
          action={
            <Button variant="contained" onClick={() => setInviteOpen(true)} data-testid="invite-user">
              {t("invite")}
            </Button>
          }
        />
        <CardContent>
          <DataTable
            columns={columns}
            rows={users}
            getRowId={(user) => user.id}
            label={t("listTitle")}
            emptyState={<EmptyState title={t("empty")} dense />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader title={t("policyTitle")} subheader={t("policySubtitle")} />
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={policy.enforceTotp}
                onChange={(event) => void setEnforceTotp(event.target.checked)}
                slotProps={{ input: { "aria-label": t("enforceTotp") } }}
                data-testid="enforce-totp"
              />
            }
            label={t("enforceTotp")}
          />
        </CardContent>
      </Card>

      <InviteDialog
        open={inviteOpen}
        busy={busy}
        onClose={() => setInviteOpen(false)}
        onInvited={(password) => {
          setInviteOpen(false);
          setInitialPassword(password);
          void refresh();
        }}
        setBusy={setBusy}
      />

      <Dialog open={initialPassword !== null} onClose={() => setInitialPassword(null)}>
        <DialogTitle>{t("initialPasswordTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="warning">{t("initialPasswordNote")}</Alert>
            <Typography
              variant="h5"
              sx={{ fontFamily: "monospace", userSelect: "all" }}
              data-testid="initial-password"
            >
              {initialPassword}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInitialPassword(null)}>{t("done")}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title={t("confirmDeactivateTitle")}
        description={confirmDeactivate?.email}
        confirmLabel={t("deactivate")}
        cancelLabel={t("cancel")}
        destructive
        busy={busy}
        onConfirm={() => {
          if (confirmDeactivate !== null) void setStatus(confirmDeactivate, "deactivate");
        }}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </Stack>
  );
}

function InviteDialog(props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onInvited: (initialPassword: string) => void;
  readonly setBusy: (busy: boolean) => void;
}): ReactNode {
  const t = useTranslations("settings.users");
  const tr = useTranslations("roles");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<string>("operations");
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    props.setBusy(true);
    setError(null);
    try {
      const body = await proxy<{ initialPassword: string }>("/staff/users", {
        method: "POST",
        body: JSON.stringify({ email, displayName, role }),
      });
      setEmail("");
      setDisplayName("");
      props.onInvited(body.initialPassword);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "email_taken"
          ? t("errors.emailTaken")
          : t("errors.generic"),
      );
    } finally {
      props.setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("inviteTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <FormField label={t("columns.name")} required fullWidth>
            {(fieldId) => (
              <TextField
                id={fieldId}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                data-testid="invite-name"
                size="small"
                fullWidth
              />
            )}
          </FormField>
          <FormField label={t("email")} required fullWidth>
            {(fieldId) => (
              <TextField
                id={fieldId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                data-testid="invite-email"
                size="small"
                fullWidth
              />
            )}
          </FormField>
          <FormField label={t("columns.role")} required fullWidth>
            {(fieldId) => (
              <Select
                id={fieldId}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                size="small"
                fullWidth
              >
                {ROLES.map((candidate) => (
                  <MenuItem key={candidate} value={candidate}>
                    {tr(candidate)}
                  </MenuItem>
                ))}
              </Select>
            )}
          </FormField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{t("cancel")}</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={props.busy || email === "" || displayName === ""}
          data-testid="invite-submit"
        >
          {t("invite")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
