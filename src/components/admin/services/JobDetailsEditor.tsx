"use client";

import { useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { PenLine } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { BOARD_TYPE_LABELS, type BoardType } from "@/lib/erp/enums";
import { writeAudit, type AuditActor } from "@/lib/erp/audit";
import type { BoardBreakdown } from "@/lib/erp/types";
import {
  Button,
  NumberField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { StaffPicker, type PickedStaff } from "./StaffPicker";

/** Board fields that hold counts, matching the intake form. */
const BOARD_FIELDS: Array<{ key: keyof BoardBreakdown; label: string }> = [
  { key: "mdf", label: BOARD_TYPE_LABELS.mdf },
  { key: "egger", label: BOARD_TYPE_LABELS.egger },
  { key: "hdf", label: BOARD_TYPE_LABELS.hdf },
  { key: "quarter", label: BOARD_TYPE_LABELS.quarter },
  { key: "kwali", label: BOARD_TYPE_LABELS.kwali },
  { key: "tape", label: "Tape" },
];

export interface EditableJob {
  customerName: string;
  customerPhone?: string;
  staffId?: string;
  staffName?: string;
  boards: BoardBreakdown;
  accessories?: string;
  repName?: string;
  repPhone?: string;
  pickupBy?: string;
  pickupPhone?: string;
  notes?: string;
}

/**
 * Edits the details of an existing job.
 *
 * Intake is done at speed with a customer waiting, so information arrives late:
 * the rep's phone number, a corrected board count, who collected it. Without
 * this the only fix was to delete and re-enter the job, which would lose the job
 * number and its payment history.
 *
 * Customer name and phone are edited on the job rather than the customer record.
 * The job keeps a denormalised copy for list views, and correcting a typo here
 * should not silently rewrite the customer's own record, which other jobs share.
 */
export function JobDetailsEditor({
  jobId,
  job,
  actor,
  onClose,
  onError,
}: {
  jobId: string;
  job: EditableJob;
  actor: AuditActor;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [customerName, setCustomerName] = useState(job.customerName);
  const [customerPhone, setCustomerPhone] = useState(job.customerPhone ?? "");
  const [staff, setStaff] = useState<PickedStaff | null>(
    job.staffId && job.staffName ? { id: job.staffId, name: job.staffName } : null
  );
  const [boards, setBoards] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of BOARD_FIELDS) {
      const v = job.boards[f.key];
      if (typeof v === "number" && v > 0) out[f.key] = String(v);
    }
    return out;
  });
  const [colour, setColour] = useState(job.boards.colour ?? "");
  const [otherBoard, setOtherBoard] = useState(job.boards.otherBoard ?? "");
  const [accessories, setAccessories] = useState(job.accessories ?? "");
  const [repName, setRepName] = useState(job.repName ?? "");
  const [repPhone, setRepPhone] = useState(job.repPhone ?? "");
  const [pickupBy, setPickupBy] = useState(job.pickupBy ?? "");
  const [pickupPhone, setPickupPhone] = useState(job.pickupPhone ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!customerName.trim()) {
      onError("Customer name cannot be empty.");
      return;
    }
    setBusy(true);
    try {
      const nextBoards: BoardBreakdown = {};
      for (const f of BOARD_FIELDS) {
        const n = Number(boards[f.key]);
        if (n > 0) (nextBoards as Record<string, number>)[f.key as string] = n;
      }
      if (colour.trim()) nextBoards.colour = colour.trim();
      if (otherBoard.trim()) nextBoards.otherBoard = otherBoard.trim();

      // `null` rather than undefined: Firestore rejects undefined, and null is
      // what clears a field that previously had a value.
      const patch = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        staffId: staff?.id ?? null,
        staffName: staff?.name ?? null,
        boards: nextBoards,
        accessories: accessories.trim() || null,
        repName: repName.trim() || null,
        repPhone: repPhone.trim() || null,
        pickupBy: pickupBy.trim() || null,
        pickupPhone: pickupPhone.trim() || null,
        notes: notes.trim() || null,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      };

      await updateDoc(doc(getDb(), COL.serviceJobs, jobId), patch);

      await writeAudit(getDb(), {
        actor,
        action: "update",
        collectionName: COL.serviceJobs,
        docId: jobId,
        summary: "Edited job details",
        before: {
          customerName: job.customerName,
          repName: job.repName ?? null,
          staffName: job.staffName ?? null,
        },
        after: {
          customerName: patch.customerName,
          repName: patch.repName,
          staffName: patch.staffName,
        },
      });

      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/40 p-5">
      <h3 className="flex items-center gap-2 text-sm font-medium text-brass-300">
        <PenLine size={15} /> Edit job details
      </h3>

      <div className="mt-5 space-y-6">
        <Fieldset legend="Customer">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="edit-cust-name"
              label="Customer name"
              value={customerName}
              onChange={setCustomerName}
              required
            />
            <TextField
              id="edit-cust-phone"
              label="Customer phone"
              value={customerPhone}
              onChange={setCustomerPhone}
            />
          </div>
          <p className="mt-2 text-xs text-cream-600">
            Changes here apply to this job only, not the customer record shared by
            their other jobs.
          </p>
        </Fieldset>

        <Fieldset legend="Staff">
          <StaffPicker
            value={staff}
            onChange={setStaff}
            createdBy={actor.uid}
            label="Received by"
          />
        </Fieldset>

        <Fieldset legend="Boards received">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {BOARD_FIELDS.map((f) => (
              <NumberField
                key={String(f.key)}
                id={`edit-board-${String(f.key)}`}
                label={f.label}
                value={boards[f.key as string] ?? ""}
                onChange={(v) => setBoards((p) => ({ ...p, [f.key as string]: v }))}
                placeholder="0"
              />
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField id="edit-colour" label="Colour" value={colour} onChange={setColour} />
            <TextField
              id="edit-other-board"
              label="Other board"
              value={otherBoard}
              onChange={setOtherBoard}
            />
          </div>
        </Fieldset>

        <Fieldset legend="Client / rep and handover">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="edit-rep-name"
              label="Client / rep name"
              value={repName}
              onChange={setRepName}
            />
            <TextField
              id="edit-rep-phone"
              label="Client / rep phone"
              value={repPhone}
              onChange={setRepPhone}
            />
            <TextField
              id="edit-pickup-by"
              label="Collected by"
              value={pickupBy}
              onChange={setPickupBy}
            />
            <TextField
              id="edit-pickup-phone"
              label="Collector phone"
              value={pickupPhone}
              onChange={setPickupPhone}
            />
          </div>
        </Fieldset>

        <Fieldset legend="Other">
          <TextAreaField
            id="edit-accessories"
            label="Accessories"
            value={accessories}
            onChange={setAccessories}
            rows={2}
          />
          <div className="mt-4">
            <TextAreaField
              id="edit-notes"
              label="Notes"
              value={notes}
              onChange={setNotes}
              rows={2}
            />
          </div>
        </Fieldset>
      </div>

      <div className="mt-6 flex gap-3">
        <Button onClick={save} busy={busy}>
          Save changes
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Fieldset({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs uppercase tracking-wider text-brass-400">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}
