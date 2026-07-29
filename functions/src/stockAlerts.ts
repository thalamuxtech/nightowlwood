import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { BrevoMailer, ConsoleMailer, type Mailer } from "./mailer";
import {
  detailTable,
  paragraph,
  renderEmail,
  type CompanyDetails,
} from "./emailTemplate";

/**
 * Scheduled alerts: low stock and overdue tools.
 *
 * One digest per morning rather than an email per event. A system that mails on
 * every crossing of a reorder level trains people to ignore it, and the item
 * that matters arrives in a thread nobody opens.
 *
 * Two rules keep the digest honest:
 *
 *  1. **Nothing is sent when there is nothing to report.** A daily "all clear"
 *     is the fastest way to make the alert invisible.
 *  2. **An item is not re-reported while it stays low.** `lastAlertedAt` is
 *     stamped on each item, and anything alerted within the cooldown is skipped.
 *     Without that, a slow-moving item out of stock for a month generates thirty
 *     identical emails and the genuinely new shortage is lost among them.
 */

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const REGION = "europe-west1";
const SENDER = { email: "info@nightowl.com.ng", name: "Nightowl Woodworks" };

/** Days before the same item is reported again. */
const ALERT_COOLDOWN_DAYS = 3;

const FALLBACK_COMPANY: CompanyDetails = {
  name: "Nightowl Woodworks Ltd",
  tagline: "Precision in Every Cut",
  email: "info@nightowl.com.ng",
  website: "nightowl.com.ng",
};

function mailer(): Mailer {
  const key = BREVO_API_KEY.value();
  return key ? new BrevoMailer(key, SENDER) : new ConsoleMailer();
}

async function companyDetails(): Promise<CompanyDetails> {
  try {
    const snap = await getFirestore().doc("settings/company").get();
    if (!snap.exists) return FALLBACK_COMPANY;
    const d = snap.data() ?? {};
    return {
      name: d.name ?? FALLBACK_COMPANY.name,
      tagline: d.tagline ?? FALLBACK_COMPANY.tagline,
      email: d.email ?? FALLBACK_COMPANY.email,
      phone: d.phone || undefined,
      website: d.website || undefined,
      address: d.address || undefined,
    };
  } catch {
    return FALLBACK_COMPANY;
  }
}

/**
 * Recipients for operational alerts.
 *
 * Managers and admins, read from the user records rather than a hardcoded
 * address, so adding a manager does not mean editing a function. Falls back to
 * the company address if nobody is listed, since an alert with no recipient is
 * worse than one sent to the general inbox.
 */
async function alertRecipients(): Promise<Array<{ email: string; name?: string }>> {
  const db = getFirestore();
  try {
    const snap = await db
      .collection("users")
      .where("active", "==", true)
      .where("role", "in", ["admin", "manager"])
      .get();
    const list = snap.docs
      .map((d) => ({ email: String(d.data().email ?? ""), name: d.data().name as string }))
      .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
    if (list.length > 0) return list;
  } catch {
    /* fall through */
  }
  const company = await companyDetails();
  return [{ email: company.email, name: company.name }];
}

interface LowItem {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  reorderLevel: number;
  supplier?: string;
}

interface OverdueTool {
  requestNumber: string;
  jobName: string;
  requestedByName: string;
  daysOverdue: number;
}

function daysAgo(ts: Timestamp | null | undefined): number | null {
  const ms = ts?.toMillis?.();
  if (!ms) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

/**
 * The daily digest.
 *
 * 07:00 Africa/Lagos, before the working day, so a reorder can be raised the
 * same morning rather than after the suppliers have taken the day's orders.
 */
export const dailyOperationsDigest = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "Africa/Lagos",
    region: REGION,
    secrets: [BREVO_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const cooldownBefore = Date.now() - ALERT_COOLDOWN_DAYS * 86_400_000;

    // --- Low stock --------------------------------------------------------
    const invSnap = await db.collection("inventoryCompany").get();
    const low: LowItem[] = [];
    const toStamp: string[] = [];

    for (const d of invSnap.docs) {
      const x = d.data();
      if (x.active === false) continue;
      const onHand = Number(x.quantityOnHand ?? 0);
      const reorder = Number(x.reorderLevel ?? 0);
      if (reorder <= 0 || onHand > reorder) continue;

      // Skip anything already reported inside the cooldown window.
      const lastMs = x.lastAlertedAt?.toMillis?.() ?? 0;
      if (lastMs > cooldownBefore) continue;

      low.push({
        id: d.id,
        name: String(x.name ?? ""),
        unit: String(x.unit ?? ""),
        onHand,
        reorderLevel: reorder,
        supplier: x.supplier ?? undefined,
      });
      toStamp.push(d.id);
    }

    // --- Overdue tools ----------------------------------------------------
    const toolSnap = await db
      .collection("toolRequests")
      .where("status", "in", ["issued", "partially_returned"])
      .get();

    const overdue: OverdueTool[] = [];
    for (const d of toolSnap.docs) {
      const x = d.data();
      const days = daysAgo(x.expectedReturnDate);
      if (days === null || days <= 0) continue;
      overdue.push({
        requestNumber: String(x.requestNumber ?? ""),
        jobName: String(x.jobName ?? ""),
        requestedByName: String(x.requestedByName ?? ""),
        daysOverdue: days,
      });
    }

    // Silence is the correct output when nothing needs attention.
    if (low.length === 0 && overdue.length === 0) {
      console.log("[digest] nothing to report");
      return;
    }

    const company = await companyDetails();
    const recipients = await alertRecipients();

    const sections: string[] = [];

    if (low.length > 0) {
      const out = low.filter((i) => i.onHand === 0);
      sections.push(
        paragraph(
          out.length > 0
            ? `${out.length} item${out.length === 1 ? " is" : "s are"} out of stock and ${low.length} in total ${low.length === 1 ? "is" : "are"} at or below the reorder level.`
            : `${low.length} item${low.length === 1 ? " is" : "s are"} at or below the reorder level.`
        ) +
          detailTable(
            low.map(
              (i) =>
                [
                  i.supplier ? `${i.name} (${i.supplier})` : i.name,
                  `${i.onHand} of ${i.reorderLevel} ${i.unit}`,
                ] as [string, string]
            )
          )
      );
    }

    if (overdue.length > 0) {
      sections.push(
        paragraph(
          `${overdue.length} tool request${overdue.length === 1 ? "" : "s"} ${overdue.length === 1 ? "is" : "are"} past the expected return date.`
        ) +
          detailTable(
            overdue.map(
              (t) =>
                [
                  `${t.requestNumber} · ${t.jobName}`,
                  `${t.requestedByName}, ${t.daysOverdue} day${t.daysOverdue === 1 ? "" : "s"} late`,
                ] as [string, string]
            )
          )
      );
    }

    const html = renderEmail({
      company,
      eyebrow: "Daily digest",
      heading:
        low.length > 0 && overdue.length > 0
          ? "Stock and tools need attention"
          : low.length > 0
            ? "Stock needs reordering"
            : "Tools are overdue for return",
      body: sections.join(""),
      footerNote: `Sent once a day when there is something to report. Items already reported in the last ${ALERT_COOLDOWN_DAYS} days are not repeated.`,
    });

    const sent = await mailer().send({
      to: recipients,
      subject:
        low.length > 0 && overdue.length > 0
          ? `${low.length} item(s) low, ${overdue.length} tool(s) overdue`
          : low.length > 0
            ? `${low.length} inventory item(s) need reordering`
            : `${overdue.length} tool request(s) overdue`,
      html,
      tags: ["operations-digest"],
    });

    if (!sent.ok) {
      // Thrown so the failure appears in the scheduler's retry history rather
      // than passing silently as a successful run.
      throw new Error(`Digest send failed: ${sent.error}`);
    }

    // Stamp only after a successful send, so a delivery failure does not start
    // the cooldown and suppress tomorrow's alert.
    if (toStamp.length > 0) {
      const batch = db.batch();
      for (const id of toStamp) {
        batch.update(db.doc(`inventoryCompany/${id}`), {
          lastAlertedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    console.log(
      `[digest] sent to ${recipients.length} recipient(s): ${low.length} low, ${overdue.length} overdue`
    );
  }
);
