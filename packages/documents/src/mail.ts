/**
 * Outbound mail seam (issue #100). SMTP implementation targets mailpit in
 * dev (docker-compose, no auth) and any real SMTP relay in production; the
 * port keeps the delivery consumer and its tests independent of transport.
 */

import { createTransport, type Transporter } from "nodemailer";

export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface OutboundMail {
  readonly to: string;
  readonly subject: string;
  /** Plain-text body (bilingual — Arabic and English, CLAUDE.md rule 9). */
  readonly text: string;
  readonly attachments: readonly MailAttachment[];
}

export interface MailSender {
  send(mail: OutboundMail): Promise<void>;
}

export interface SmtpMailSenderConfig {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  /** Absent for mailpit/dev; required by authenticated relays. */
  readonly user?: string;
  readonly password?: string;
}

export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: SmtpMailSenderConfig) {
    this.from = config.from;
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      ...(config.user === undefined || config.password === undefined
        ? {}
        : { auth: { user: config.user, pass: config.password } }),
    });
  }

  async send(mail: OutboundMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: Buffer.from(attachment.bytes),
      })),
    });
  }
}

/** Test double: records what was sent; can be armed to fail. */
export class RecordingMailSender implements MailSender {
  readonly sent: OutboundMail[] = [];
  failuresRemaining = 0;

  send(mail: OutboundMail): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new Error("smtp unavailable (armed test failure)"));
    }
    this.sent.push(mail);
    return Promise.resolve();
  }
}
