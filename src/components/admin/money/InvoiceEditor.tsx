"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { TAX_MODES, TAX_MODE_LABELS, type TaxMode } from "@/lib/erp/enums";
import { formatNaira, lineAmountKobo, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  computeInvoiceTotals,
  createStandaloneInvoice,
  invoiceSettings,
  subtotalOfLines,
  updateDraftInvoice,
} from "@/lib/erp/invoices";
import type { InvoiceLine } from "@/lib/erp/types";
import {
  Button,
  NairaField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { CustomerPicker, type PickedCustomer } from "@/components/admin/services/CustomerPicker";

/**
 * The invoice editor: raises a standalone invoice, or corrects a draft.
 *
 * One component for both, because they are the same document at different points in
 * its life and a separate "edit" form would drift from the "create" one — which is
 * how a field ends up settable on creation and impossible to correct.
 *
 * Standalone invoices exist because the workshop bills for things that never became a
 * job or a project: a delivery, a call-out, a one-off supply of boards to a trade
 * customer. Those were previously invoiced on paper, or a fake job was raised to hang
 * the invoice off — which left the job list full of records that were never work.
 */

/** A line as edited: naira in the boxes, kobo on the document. */
interface LineDraft {
  key: number;
  description: string;
  quantity: string;
  unitPriceNaira: string;
}

let nextKey = 1;
const blankLine = (): LineDraft => ({
  key: nextKey++,
  description: "",
  quantity: "1",
  unitPriceNaira: "",
});

export interface EditableInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  reference?: string;
  lines: InvoiceLine[];
  taxMode?: TaxMode;
  taxPercent?: number;
  taxLabel?: string;
  commissionPercent?: number;
  commissionNote?: string;
  discountPercent?: number;
  discountKobo?: number;
  notes?: string;
}

export function InvoiceEditor({
  actor,
  editing,
  onClose,
  onSaved,
}: {
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  /** Absent when raising a new standalone invoice. */
  editing?: EditableInvoice;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [customerName, setCustomerName] = useState(editing?.customerName ?? "");
  const [phone, setPhone] = useState(editing?.customerPhone ?? "");
  const [email, setEmail] = useState(editing?.customerEmail ?? "");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const [lines, setLines] = useState<LineDraft[]>(() =>
    editing && editing.lines.length > 0
      ? editing.lines.map((l) => ({
          key: nextKey++,
          description: l.description,
          quantity: String(l.quantity),
          unitPriceNaira: String(toNaira(l.unitPriceKobo)),
        }))
      : [blankLine()]
  );

  const [taxMode, setTaxMode] = useState<TaxMode>(editing?.taxMode ?? "none");
  const [taxPercent, setTaxPercent] = useState(String(editing?.taxPercent ?? 7.5));
  const [taxLabel, setTaxLabel] = useState(editing?.taxLabel ?? "VAT");
  const [commissionPercent, setCommissionPercent] = useState(
    String(editing?.commissionPercent ?? 0)
  );
  const [commissionNote, setCommissionNote] = useState(editing?.commissionNote ?? "");
  const [discountPercent, setDiscountPercent] = useState(
    String(editing?.discountPercent ?? 0)
  );
  const [discountAmount, setDiscountAmount] = useState(
    editing?.discountKobo ? String(toNaira(editing.discountKobo)) : ""
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /*
   * Defaults, loaded once for a new invoice only.
   *
   * Never applied when editing: a draft carries the treatment it was raised under,
   * and overwriting that with today's settings would silently change an invoice
   * someone had already priced.
   */
  useEffect(() => {
    if (editing) return;
    invoiceSettings(getDb())
      .then((s) => {
        setTaxMode(s.taxMode);
        setTaxPercent(String(s.taxPercent));
        setTaxLabel(s.taxLabel);
        setCommissionPercent(String(s.defaultCommissionPercent));
      })
      .catch(() => {
        // Settings are staff-readable; a denial just leaves the form defaults.
      });
  }, [editing]);

  /**
   * Picking a known customer fills the contact details it holds.
   *
   * Taken from the picked record rather than re-fetched: the picker already carries
   * phone and email, and reading the document again would only add a round trip and a
   * way for the two to disagree. Existing entries are not overwritten, so a phone
   * number corrected here for this one invoice survives.
   */
  useEffect(() => {
    if (!customer) return;
    setCustomerName(customer.name);
    if (customer.phone) setPhone((p) => p || customer.phone!);
    if (customer.email) setEmail((e) => e || customer.email!);
  }, [customer]);

  function patch(key: number, next: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  /** The lines as they would be stored, dropping anything unfilled. */
  const invoiceLines = useMemo<InvoiceLine[]>(
    () =>
      lines
        .filter((l) => l.description.trim() !== "")
        .map((l, i) => {
          const quantity = Number(l.quantity) || 0;
          const unitPriceKobo = parseNairaInput(l.unitPriceNaira);
          return {
            id: `l${i + 1}`,
            description: l.description.trim(),
            quantity,
            unitPriceKobo,
            amountKobo: lineAmountKobo(quantity, unitPriceKobo),
          };
        }),
    [lines]
  );

  /**
   * The totals, from the same function the write uses.
   *
   * Not a separate display calculation: an invoice that previews one figure and saves
   * another is the single worst failure this screen can have.
   */
  const totals = useMemo(
    () =>
      computeInvoiceTotals({
        subtotalKobo: subtotalOfLines(invoiceLines),
        discountPercent: Number(discountPercent) || 0,
        discountKobo: parseNairaInput(discountAmount),
        taxMode,
        taxPercent: Number(taxPercent) || 0,
        commissionPercent: Number(commissionPercent) || 0,
      }),
    [invoiceLines, discountPercent, discountAmount, taxMode, taxPercent, commissionPercent]
  );

  async function save() {
    setError("");
    if (!editing && !customerName.trim()) {
      setError("Name who the invoice is for.");
      return;
    }
    if (invoiceLines.length === 0) {
      setError("Add at least one line with a description.");
      return;
    }
    if (invoiceLines.some((l) => l.quantity <= 0)) {
      setError("Every line needs a quantity above zero.");
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        await updateDraftInvoice(getDb(), actor, editing.id, {
          customerName: customerName.trim(),
          customerPhone: phone,
          customerEmail: email,
          reference: reference.trim() || undefined,
          lines: invoiceLines,
          taxMode,
          taxPercent: Number(taxPercent) || 0,
          taxLabel: taxLabel.trim() || "Tax",
          commissionPercent: Number(commissionPercent) || 0,
          commissionNote: commissionNote.trim() || undefined,
          discountPercent: Number(discountPercent) || 0,
          discountKobo: parseNairaInput(discountAmount),
          notes: notes.trim() || undefined,
        });
        onSaved(`${editing.invoiceNumber} updated.`);
      } else {
        const res = await createStandaloneInvoice(getDb(), actor, {
          customerId: customer?.id,
          customerName: customerName.trim(),
          customerPhone: phone.trim() || undefined,
          customerEmail: email.trim() || undefined,
          reference: reference.trim() || undefined,
          lines: invoiceLines,
          taxMode,
          taxPercent: Number(taxPercent) || 0,
          taxLabel: taxLabel.trim() || "Tax",
          commissionPercent: Number(commissionPercent) || 0,
          commissionNote: commissionNote.trim() || undefined,
          discountPercent: Number(discountPercent) || 0,
          discountKobo: parseNairaInput(discountAmount),
          notes: notes.trim() || undefined,
        });
        onSaved(`${res.invoiceNumber} created as a draft.`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <FileText size={18} className="text-brass-400" />
        {editing ? `Edit ${editing.invoiceNumber}` : "New invoice"}
      </h2>
      {!editing && (
        <p className="mt-2 max-w-2xl text-sm text-cream-400">
          For work that is not a service job or a project: a delivery, a call-out, a
          one-off supply. Lines are typed by hand.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Who it is for */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {editing ? (
          <TextField
            id="inv-customer-name"
            label="Billed to"
            value={customerName}
            onChange={setCustomerName}
            required
          />
        ) : (
          <>
            <CustomerPicker
              value={customer}
              onChange={setCustomer}
              createdBy={actor.uid}
            />
            <TextField
              id="inv-customer-name"
              label="Billed to"
              value={customerName}
              onChange={setCustomerName}
              required
              hint={customer ? undefined : "or type a name for a one-off"}
            />
          </>
        )}
        <TextField id="inv-phone" label="Phone" value={phone} onChange={setPhone} />
        <TextField
          id="inv-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          hint="needed to send the invoice"
        />
        <div className="sm:col-span-2">
          <TextField
            id="inv-reference"
            label="Your reference (optional)"
            value={reference}
            onChange={setReference}
            placeholder="PO number, delivery note, site name"
          />
        </div>
      </div>

      {/* Lines */}
      <fieldset className="mt-7">
        <legend className="mb-3 text-sm text-cream-300">
          Lines <span className="text-brass-400">*</span>
        </legend>

        <div className="space-y-3">
          {lines.map((l, index) => {
            const amount = lineAmountKobo(
              Number(l.quantity) || 0,
              parseNairaInput(l.unitPriceNaira)
            );
            return (
              <div
                key={l.key}
                className="grid gap-3 sm:grid-cols-[1fr_6rem_9rem_auto] sm:items-end"
              >
                <TextField
                  id={`inv-desc-${l.key}`}
                  label={index === 0 ? "Description" : ""}
                  value={l.description}
                  onChange={(v) => patch(l.key, { description: v })}
                  placeholder="e.g. Delivery to Kano"
                />
                <NumberField
                  id={`inv-qty-${l.key}`}
                  label={index === 0 ? "Qty" : ""}
                  value={l.quantity}
                  onChange={(v) => patch(l.key, { quantity: v })}
                />
                <NairaField
                  id={`inv-price-${l.key}`}
                  label={index === 0 ? "Unit price" : ""}
                  valueKobo={l.unitPriceNaira}
                  onChangeKobo={(v) => patch(l.key, { unitPriceNaira: v })}
                />
                <div className="flex items-center gap-2">
                  <span className="min-w-[5.5rem] text-right text-sm tabular-nums text-cream-300">
                    {formatNaira(amount)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove this line"
                    disabled={lines.length === 1}
                    onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                    className="flex h-12 w-11 cursor-pointer items-center justify-center rounded-xl border border-night-600 text-cream-500 transition-colors hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setLines((p) => [...p, blankLine()])}
          className="mt-3 flex cursor-pointer items-center gap-1.5 text-sm text-brass-300 transition-colors hover:text-brass-200"
        >
          <Plus size={14} /> Add a line
        </button>
      </fieldset>

      {/* Tax, discount, commission */}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          id="inv-tax-mode"
          label="Tax"
          value={taxMode}
          onChange={setTaxMode}
          options={TAX_MODES.map((m) => ({ value: m, label: TAX_MODE_LABELS[m] }))}
        />
        <NumberField
          id="inv-tax-rate"
          label="Tax rate (%)"
          value={taxPercent}
          onChange={setTaxPercent}
          disabled={taxMode === "none"}
        />
        <TextField
          id="inv-tax-label"
          label="Tax called"
          value={taxLabel}
          onChange={setTaxLabel}
          disabled={taxMode === "none"}
        />
        <NumberField
          id="inv-discount-pct"
          label="Discount (%)"
          value={discountPercent}
          onChange={setDiscountPercent}
        />
        <NairaField
          id="inv-discount-amt"
          label="Further discount"
          valueKobo={discountAmount}
          onChangeKobo={setDiscountAmount}
          hint="a flat figure, on top of any %"
        />
        <NumberField
          id="inv-commission-pct"
          label="Commission (%)"
          value={commissionPercent}
          onChange={setCommissionPercent}
          hint="of the invoice total"
        />
      </div>

      {Number(commissionPercent) > 0 && (
        <div className="mt-4">
          <TextField
            id="inv-commission-note"
            label="Who the commission is for"
            value={commissionNote}
            onChange={setCommissionNote}
            placeholder="e.g. Introduced by Yusuf A."
          />
        </div>
      )}

      {/* The totals, worked through. Every figure here comes from the same
          function that writes the document. */}
      <dl className="mt-7 space-y-2 rounded-2xl border border-night-700/60 bg-night-950/40 p-5 text-sm">
        <Row label="Subtotal" value={formatNaira(totals.subtotalKobo)} />
        {totals.discountKobo > 0 && (
          <Row
            label={`Discount${
              totals.discountPercent > 0 ? ` (${totals.discountPercent}%)` : ""
            }`}
            value={`−${formatNaira(totals.discountKobo)}`}
            tone="warn"
          />
        )}
        {totals.taxMode !== "none" && (
          <Row
            label={
              `${taxLabel || "Tax"} (${totals.taxPercent}%)` +
              (totals.taxMode === "inclusive" ? " — included" : "")
            }
            value={
              totals.taxMode === "inclusive"
                ? `${formatNaira(totals.taxKobo)} of the total`
                : formatNaira(totals.taxKobo)
            }
          />
        )}
        <div className="flex items-baseline justify-between gap-4 border-t border-night-700/60 pt-2.5">
          <dt className="text-cream-200">Customer pays</dt>
          <dd className="font-display text-xl text-brass-300">
            {formatNaira(totals.totalKobo)}
          </dd>
        </div>
        {totals.commissionKobo > 0 && (
          <>
            <Row
              label={`Commission (${totals.commissionPercent}% of total)`}
              value={formatNaira(totals.commissionKobo)}
              tone="warn"
            />
            <p className="pt-1 text-xs leading-relaxed text-cream-500">
              A cost to the business, recorded against this invoice but not charged to
              the customer, so it is not part of what they pay.
            </p>
          </>
        )}
      </dl>

      <div className="mt-5">
        <TextAreaField
          id="inv-notes"
          label="Notes on the invoice (optional)"
          value={notes}
          onChange={setNotes}
          rows={2}
        />
      </div>

      <div className="mt-6 flex gap-3">
        <Button onClick={save} busy={busy}>
          {editing ? "Save changes" : "Create draft"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {!editing && (
        <p className="mt-3 text-xs text-cream-500">
          Saved as a draft. Issuing it is a separate step, so nothing reaches a
          customer until you say so.
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-cream-400">{label}</dt>
      <dd
        className={`tabular-nums ${tone === "warn" ? "text-amber-300" : "text-cream-200"}`}
      >
        {value}
      </dd>
    </div>
  );
}
