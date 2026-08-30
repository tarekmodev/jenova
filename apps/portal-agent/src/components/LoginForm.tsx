"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormField,
  Stack,
  TextField,
  Typography,
} from "@jenova/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMessages } from "../i18n/I18nProvider";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function LoginForm(): ReactNode {
  const messages = useMessages();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setFailed(false);
    try {
      const response = await fetch("/portal-session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      router.replace("/search");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "background.default",
        padding: 2,
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 420 }}>
        <CardContent>
          <Stack spacing={3} component="form" onSubmit={(event: FormEvent) => void submit(event)}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="h4" component="h1">
                  {messages.login.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {messages.login.subtitle}
                </Typography>
              </Box>
              <LocaleSwitcher />
            </Stack>

            {failed && <Alert severity="error">{messages.login.invalidCredentials}</Alert>}

            <FormField label={messages.login.email} required fullWidth>
              {(fieldId) => (
                <TextField
                  id={fieldId}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  fullWidth
                  autoComplete="username"
                  slotProps={{ htmlInput: { dir: "ltr", "data-testid": "login-email" } }}
                />
              )}
            </FormField>
            <FormField label={messages.login.password} required fullWidth>
              {(fieldId) => (
                <TextField
                  id={fieldId}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  fullWidth
                  autoComplete="current-password"
                  slotProps={{ htmlInput: { dir: "ltr", "data-testid": "login-password" } }}
                />
              )}
            </FormField>

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting || email.length === 0 || password.length === 0}
              data-testid="login-submit"
            >
              {submitting ? messages.login.submitting : messages.login.submit}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
