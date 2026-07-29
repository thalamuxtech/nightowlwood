"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  BOARD_TYPES,
  BOARD_TYPE_LABELS,
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  type BoardType,
  type ServiceType,
} from "@/lib/erp/enums";
import { formatNaira, lineAmountKobo, parseNairaInput, sumKobo, toNaira } from "@/lib/erp/money";
import { createServiceJob, receiveServiceInventory } from "@/lib/erp/serviceJobs";
import {
  DEFAULT_SERVICE_RATE_CARD,
  SETTINGS_DOC,
  type ServiceRateCardSettings,
} from "@/lib/erp/settings";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { CustomerPicker, type PickedCustomer } from "./CustomerPicker";
import {
  Button,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";

/** Board fields from the paper tracker's checkbox row. */
const BOARD_FIELDS: Array<{ key: string; label: string }> = [
  { key: "mdf", label: "MDF" },
  { key: "egger", label: "Egger" },
  { key: "hdf", label: "HDF" },
  { key: "quarter", label: "Quarter" },
  { key: "kwali", label: "Kwali" },
  { key: "tape", label: "Tape" },
];

interface DraftLine {
  key: string;
  serviceType: ServiceType | "";
  boardType: BoardType | "";
  quantity: string;
  unitPriceNaira: string;
}

let lineSeq = 0;
const newLine = (): DraftLine => ({
  key: `l${lineSeq++}`,
  serviceType: "",
  boardType: "",
  quantity: "",
  unitPriceNaira: "",
});

interface StaffOption {
  id: string;
  name: string;
}

/**
 * Job intake, the digital Job Order Tracker.
 *
 * Field order deliberately follows the paper form so staff transcribing from it
 * read top-to-bottom without hunting: customer, staff, boards, accessories,
 * driver, then priced work.
 */
export function JobIntakeForm() {
  const router = useRouter();
  const session = useErpSession();
  const canCreate = session.can("job.create");

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [staffId, setStaffId] = useState("");
  const [boards, setBoards] = useState<Record<string, string>>({});
  const [colour, setColour] = useState("");
  const [otherBoard, setOtherBoard] = useState("");
  const [accessories, setAccessories] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [rateCard, setRateCard] = useState<ServiceRateCardSettings>(DEFAULT_SERVICE_RATE_CARD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query(collection(getDb(), COL.staff), where("active", "==", true));
    return onSnapshot(
      q,
      (snap) =>
        setStaff(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? "" }))),
      () => {}
    );
  }, []);

  // Rate card is optional; the seeded defaults stand in until an admin saves one.
  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.serviceRateCard))
      .then((snap) => {
        if (snap.exists()) setRateCard(snap.data() as ServiceRateCardSettings);
      })
      .catch(() => {});
  }, []);

  const totalKobo = useMemo(
    () =>
      sumKobo(
        lines.map((l) =>
          lineAmountKobo(Number(l.quantity) || 0, parseNairaInput(l.unitPriceNaira))
        )
      ),
    [lines]
  );

  const boardTotal = useMemo(
    () => BOARD_FIELDS.reduce((sum, f) => sum + (Number(boards[f.key]) || 0), 0),
    [boards]
  );

  /**
   * Applies the rate card when a service type is chosen.
   *
   * Only fills a price the user hasn't typed into, overwriting a manual entry
   * because the row changed would be hostile.
   */
  function setLineService(key: string, serviceType: ServiceType) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const entry = rateCard.autofillEnabled
          ? rateCard.entries.find((e) => e.serviceType === serviceType)
          : undefined;
        const shouldFill = entry && entry.defaultPriceKobo > 0 && !l.unitPriceNaira;
        return {
          ...l,
          serviceType,
          unitPriceNaira: shouldFill
            ? String(toNaira(entry.defaultPriceKobo))
            : l.unitPriceNaira,
        };
      })
    );
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!customer) {
      setError("Select or create a customer.");
      return;
    }
    const ready = lines.filter((l) => l.serviceType && Number(l.quantity) > 0);
    if (ready.length === 0) {
      setError("Add at least one work line with a quantity.");
      return;
    }

    setBusy(true);
    setError("");
    const actor = {
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    };

    try {
      const boardCounts: Record<string, number | string> = {};
      for (const f of BOARD_FIELDS) {
        const n = Number(boards[f.key]);
        if (n > 0) boardCounts[f.key] = n;
      }
      if (colour.trim()) boardCounts.colour = colour.trim();
      if (otherBoard.trim()) boardCounts.otherBoard = otherBoard.trim();

      const { jobId, jobNumber } = await createServiceJob(getDb(), actor, {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        staffId: staffId || undefined,
        staffName: staff.find((s) => s.id === staffId)?.name,
        boards: boardCounts,
        accessories: accessories.trim() || undefined,
        driverName: driverName.trim() || undefined,
        driverPhone: driverPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: ready.map((l) => ({
          serviceType: l.serviceType as ServiceType,
          boardType: (l.boardType || undefined) as BoardType | undefined,
          quantity: Number(l.quantity),
          unitPriceKobo: parseNairaInput(l.unitPriceNaira),
        })),
      });

      // Customer-brought boards become service inventory we hold, not own.
      await Promise.all(
        BOARD_FIELDS.filter((f) => Number(boards[f.key]) > 0).map((f) =>
          receiveServiceInventory(getDb(), actor, {
            customerId: customer.id,
            customerName: customer.name,
            jobId,
            jobNumber,
            boardType: f.key as BoardType,
            quantity: Number(boards[f.key]),
          })
        )
      );

      // Static export can't prerender per-job routes, so job detail is a
      // query-param page (same approach as /admin/blog/post).
      router.push(`/admin/jobs/detail/?id=${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the job.");
      setBusy(false);
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-red-500/30 bg-red-500/5 p-8 text-center">
        <ShieldAlert className="mx-auto text-red-400" size={30} />
        <h1 className="mt-4 font-display text-xl text-cream-100">Not permitted</h1>
        <p className="mt-2 text-sm text-cream-400">
          Creating service jobs requires manager or admin access.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl pb-24">
      <header>
        <p className="text-eyebrow">Services</p>
        <h1 className="text-title mt-3 text-cream-50">New job</h1>
        <p className="mt-3 text-sm text-cream-400">
          Mirrors the paper Job Order Tracker. A job number is assigned on save.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} /> {error}
        </p>
      )}

      {/* Customer & staff */}
      <Section title="Customer & staff">
        <div className="grid gap-5 sm:grid-cols-2">
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            createdBy={session.user?.uid ?? ""}
          />
          <SelectField
            id="staff"
            label="Received by"
            value={staffId}
            onChange={setStaffId}
            placeholder={staff.length ? "Select staff…" : "No staff records yet"}
            options={staff.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      </Section>

      {/* Boards */}
      <Section
        title="Boards received"
        hint={boardTotal > 0 ? `${boardTotal} board${boardTotal === 1 ? "" : "s"} total` : undefined}
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {BOARD_FIELDS.map((f) => (
            <NumberField
              key={f.key}
              id={`board-${f.key}`}
              label={f.label}
              value={boards[f.key] ?? ""}
              onChange={(v) => setBoards((p) => ({ ...p, [f.key]: v }))}
              placeholder="0"
            />
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField id="colour" label="Colour" value={colour} onChange={setColour} />
          <TextField
            id="other-board"
            label="Other board"
            value={otherBoard}
            onChange={setOtherBoard}
          />
        </div>
      </Section>

      {/* Work lines */}
      <Section
        title="Work & pricing"
        hint={rateCard.autofillEnabled ? "Prices prefill from the rate card" : undefined}
      >
        <div className="space-y-4">
          {lines.map((line, i) => {
            const amount = lineAmountKobo(
              Number(line.quantity) || 0,
              parseNairaInput(line.unitPriceNaira)
            );
            return (
              <div
                key={line.key}
                className="rounded-2xl border border-night-700/60 bg-night-900/40 p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-cream-500">
                    Line {i + 1}
                  </p>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setLines((p) => p.filter((l) => l.key !== line.key))}
                      className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <SelectField
                    id={`svc-${line.key}`}
                    label="Service"
                    value={line.serviceType}
                    onChange={(v) => setLineService(line.key, v as ServiceType)}
                    placeholder="Select…"
                    options={SERVICE_TYPES.map((s) => ({
                      value: s,
                      label: SERVICE_TYPE_LABELS[s],
                    }))}
                  />
                  <SelectField
                    id={`board-type-${line.key}`}
                    label="Board"
                    value={line.boardType}
                    onChange={(v) => updateLine(line.key, { boardType: v as BoardType })}
                    placeholder="-"
                    options={BOARD_TYPES.map((b) => ({ value: b, label: BOARD_TYPE_LABELS[b] }))}
                  />
                  <NumberField
                    id={`qty-${line.key}`}
                    label="Quantity"
                    value={line.quantity}
                    onChange={(v) => updateLine(line.key, { quantity: v })}
                    placeholder="0"
                  />
                  <NumberField
                    id={`price-${line.key}`}
                    label="Unit price (₦)"
                    value={line.unitPriceNaira}
                    onChange={(v) => updateLine(line.key, { unitPriceNaira: v })}
                    placeholder="0"
                  />
                </div>
                {amount > 0 && (
                  <p className="mt-3 text-right text-sm text-brass-300">
                    {formatNaira(amount)}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setLines((p) => [...p, newLine()])}
          className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
        >
          <Plus size={16} /> Add another line
        </button>
      </Section>

      {/* Handover */}
      <Section title="Accessories & driver">
        <TextAreaField
          id="accessories"
          label="Accessories"
          value={accessories}
          onChange={setAccessories}
          rows={2}
          placeholder="Hinges, handles, rollers…"
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            id="driver-name"
            label="Driver's name"
            value={driverName}
            onChange={setDriverName}
          />
          <TextField
            id="driver-phone"
            label="Driver's phone"
            value={driverPhone}
            onChange={setDriverPhone}
          />
        </div>
        <div className="mt-4">
          <TextAreaField
            id="notes"
            label="Notes"
            value={notes}
            onChange={setNotes}
            rows={2}
          />
        </div>
      </Section>

      {/* Sticky total + submit */}
      <div className="sticky bottom-0 mt-8 -mx-5 border-t border-night-700/60 bg-night-950/95 px-5 py-4 backdrop-blur-lg sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-cream-500">Job total</p>
            <p className="font-display text-2xl text-cream-50">{formatNaira(totalKobo)}</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button onClick={submit} busy={busy}>
              Create job
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg text-cream-100">{title}</h2>
        {hint && <span className="text-xs text-brass-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
