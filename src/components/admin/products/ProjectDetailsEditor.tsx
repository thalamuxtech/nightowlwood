"use client";

import { useState } from "react";
import { PenLine } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { updateProjectDetails } from "@/lib/erp/projects";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import type { AuditActor } from "@/lib/erp/audit";
import { Button, TextAreaField, TextField } from "@/components/admin/ui/Fields";
import { CustomerPicker, type PickedCustomer } from "@/components/admin/services/CustomerPicker";

export interface EditableProject {
  title: string;
  customerId: string;
  customerName: string;
  location?: string;
  targetDateMs: number | null;
  notes?: string;
}

/**
 * Edits an existing project's details.
 *
 * A project runs for weeks and its particulars move: the client changes the target
 * date, the site address turns out to be wrong, the title was typed in a hurry.
 * Until now none of it could be changed, and `deleteProject` was never wired to the
 * UI either, so a project created with a typo carried it to completion.
 *
 * The project number is not editable. It is quoted on estimates and invoices and to
 * the client, so renumbering would break every document that already cites it.
 * Costs are not editable either: they are rolled up from the priced features, and
 * typing over them would put the header out of step with the lines beneath it.
 */
export function ProjectDetailsEditor({
  projectId,
  projectNumber,
  project,
  actor,
  onClose,
  onError,
}: {
  projectId: string;
  projectNumber: string;
  project: EditableProject;
  actor: AuditActor;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [customer, setCustomer] = useState<PickedCustomer | null>({
    id: project.customerId,
    name: project.customerName,
  });
  const [location, setLocation] = useState(project.location ?? "");
  const [targetDate, setTargetDate] = useState(
    project.targetDateMs ? toDateInputValue(new Date(project.targetDateMs)) : ""
  );
  const [notes, setNotes] = useState(project.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) {
      onError("A project needs a title.");
      return;
    }
    if (!customer) {
      onError("A project needs a client.");
      return;
    }
    setBusy(true);
    try {
      await updateProjectDetails(getDb(), actor, projectId, {
        title,
        customerId: customer.id,
        customerName: customer.name,
        location,
        // Clearing the field removes the date rather than leaving the old one.
        targetDate: targetDate ? fromDateInputValue(targetDate) : null,
        notes,
      });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/50 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <PenLine size={17} className="text-brass-400" /> Edit {projectNumber}
      </h2>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextField id="proj-title" label="Title" value={title} onChange={setTitle} required />
        <TextField
          id="proj-location"
          label="Location"
          value={location}
          onChange={setLocation}
          placeholder="Lekki Phase 1"
        />
        <div className="sm:col-span-2">
          <CustomerPicker value={customer} onChange={setCustomer} createdBy={actor.uid} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm text-cream-300">Target date</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full rounded-xl border border-night-600 bg-night-950/60 px-4 py-2.5 text-sm text-cream-100 outline-none transition-colors focus:border-brass-500"
          />
        </label>
        <div className="sm:col-span-2">
          <TextAreaField id="proj-notes" label="Notes" value={notes} onChange={setNotes} />
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <Button onClick={save} busy={busy}>
          Save changes
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
