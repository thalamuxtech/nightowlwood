/**
 * Transactional email.
 *
 * The provider sits behind the `Mailer` interface so feature code never
 * references Brevo directly, swapping to Resend or SMTP later means adding one
 * implementation, not touching every call site.
 *
 * The API key is read from Secret Manager at call time via the injected secret,
 * never from source and never from a NEXT_PUBLIC_* variable that would ship to
 * the browser.
 */

export interface MailAddress {
  email: string;
  name?: string;
}

/** A file sent with the message, e.g. the invoice PDF. */
export interface MailAttachment {
  /** Filename the recipient sees. Include the extension. */
  name: string;
  content: Buffer;
}

export interface SendMailInput {
  to: MailAddress[];
  subject: string;
  html: string;
  /** Plain-text alternative. Generated from the HTML when omitted. */
  text?: string;
  replyTo?: MailAddress;
  /** Tags for provider-side reporting, e.g. ["invoice"]. */
  tags?: string[];
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface Mailer {
  send(input: SendMailInput): Promise<SendMailResult>;
}

/** Sender identity. Must be a domain authenticated with the provider. */
export interface SenderConfig {
  email: string;
  name: string;
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Crude HTML→text fallback for the plain-text part.
 *
 * Not a general-purpose converter: it only needs to make our own templates
 * readable in a text-only client. Sending HTML with no text alternative hurts
 * deliverability, so this always produces something.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8377;|&naira;/g, "₦")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class BrevoMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly sender: SenderConfig
  ) {}

  async send(input: SendMailInput): Promise<SendMailResult> {
    if (!this.apiKey) {
      return { ok: false, error: "BREVO_API_KEY is not configured." };
    }
    if (input.to.length === 0) {
      return { ok: false, error: "No recipients." };
    }

    try {
      const res = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.sender.email, name: this.sender.name },
          to: input.to.map((t) => ({ email: t.email, name: t.name })),
          subject: input.subject,
          htmlContent: input.html,
          textContent: input.text ?? htmlToText(input.html),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.tags?.length ? { tags: input.tags } : {}),
          // Brevo takes attachments as base64 under `attachment`. A 10MB total
          // message cap applies; an invoice PDF is a few tens of KB, so the
          // limit only matters if this is ever reused for something larger.
          ...(input.attachments?.length
            ? {
                attachment: input.attachments.map((a) => ({
                  name: a.name,
                  content: a.content.toString("base64"),
                })),
              }
            : {}),
        }),
      });

      if (!res.ok) {
        // Brevo returns a JSON body with `message` on failure; fall back to the
        // status line if the body isn't JSON.
        const body = await res.text();
        let detail = body;
        try {
          const parsed = JSON.parse(body) as { message?: string };
          if (parsed.message) detail = parsed.message;
        } catch {
          /* keep raw body */
        }
        return { ok: false, error: `Brevo ${res.status}: ${detail}` };
      }

      const data = (await res.json()) as { messageId?: string };
      return { ok: true, messageId: data.messageId };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown mail transport error.",
      };
    }
  }
}

/** No-op mailer for local runs without a key: logs instead of sending. */
export class ConsoleMailer implements Mailer {
  async send(input: SendMailInput): Promise<SendMailResult> {
    console.log("[mail:dry-run]", {
      to: input.to.map((t) => t.email),
      subject: input.subject,
      attachments: input.attachments?.map((a) => `${a.name} (${a.content.length}B)`),
    });
    return { ok: true, messageId: "dry-run" };
  }
}
