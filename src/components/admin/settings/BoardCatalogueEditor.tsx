"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Eye, EyeOff, Layers, RotateCcw, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { BOARD_TYPES, BOARD_TYPE_LABELS, type BoardType } from "@/lib/erp/enums";
import {
  defaultBoardCatalogue,
  defaultBoardImage,
  loadBoardCatalogue,
  saveBoardCatalogue,
  type BoardCatalogueSettings,
} from "@/lib/erp/boardCatalogue";
import {
  Button,
  CheckboxField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The board catalogue — what each material looks like on the public site.
 *
 * Ships with a generated swatch per board so the site has something to show from the first
 * deploy. Replacing one is a matter of pasting the address of a real photograph: upload it to
 * Storage or to wherever the workshop keeps its photos, and paste the link. Each row previews
 * what it will look like, because a wrong link is otherwise only discovered by a customer.
 */
export function BoardCatalogueEditor() {
  const session = useErpSession();

  const [catalogue, setCatalogue] = useState<BoardCatalogueSettings>(defaultBoardCatalogue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  /** Which row is expanded for editing. One at a time — twelve open forms is unreadable. */
  const [openType, setOpenType] = useState<BoardType | null>(null);

  useEffect(() => {
    loadBoardCatalogue(getDb())
      .then(setCatalogue)
      .catch(() => setError("Could not load the board catalogue."))
      .finally(() => setLoading(false));
  }, []);

  const actor = useAuditActor();

  function patch(type: BoardType, next: Partial<BoardCatalogueSettings["entries"][BoardType]>) {
    setCatalogue((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [type]: { ...prev.entries[type]!, ...next },
      },
    }));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      await saveBoardCatalogue(getDb(), actor, catalogue);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed. Check permissions and try again.");
    } finally {
      setSaving(false);
    }
  }

  const shownCount = BOARD_TYPES.filter((t) => catalogue.entries[t]?.published).length;

  if (loading) {
    return (
      <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
        <p className="text-sm text-cream-500">Loading the board catalogue…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Layers size={18} className="text-brass-400" /> Boards on the website
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          The materials shown to customers, on the site and beside the material picker in the
          cutting-list builder. Each board ships with a drawn swatch — paste the address of a
          real photograph to replace it.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-5">
        <CheckboxField
          id="bc-enabled"
          label="Show the materials section on the public site"
          checked={catalogue.enabled}
          onChange={(v) => setCatalogue((p) => ({ ...p, enabled: v }))}
        />
        <p className="mt-2 text-xs text-cream-500">
          {shownCount} of {BOARD_TYPES.length} boards are marked to show.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {BOARD_TYPES.map((type) => {
          const entry = catalogue.entries[type]!;
          const expanded = openType === type;
          const isDefaultImage = entry.imageUrl === defaultBoardImage(type);

          return (
            <div
              key={type}
              className="overflow-hidden rounded-2xl border border-night-700/60 bg-night-900/30"
            >
              <div className="flex flex-wrap items-center gap-4 p-4">
                {/* The swatch or photograph, as the customer will see it. Unoptimised because
                    the source is an arbitrary admin-supplied URL, which the image optimiser
                    would need whitelisted per host. */}
                <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-night-600">
                  <Image
                    src={entry.imageUrl}
                    alt={`${entry.displayName} sample`}
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                </span>

                <button
                  type="button"
                  onClick={() => setOpenType(expanded ? null : type)}
                  className="flex-1 cursor-pointer text-left"
                  aria-expanded={expanded}
                >
                  <span className="block text-cream-100">{entry.displayName}</span>
                  <span className="mt-0.5 block text-xs text-cream-500">
                    {BOARD_TYPE_LABELS[type]}
                    {entry.sheetSize ? ` · ${entry.sheetSize}` : ""}
                    {isDefaultImage ? " · drawn swatch" : " · photograph"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => patch(type, { published: !entry.published })}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    entry.published
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-night-600 text-cream-500 hover:text-cream-300"
                  }`}
                  aria-pressed={entry.published}
                >
                  {entry.published ? <Eye size={13} /> : <EyeOff size={13} />}
                  {entry.published ? "Shown" : "Hidden"}
                </button>
              </div>

              {expanded && (
                <div className="border-t border-night-700/60 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      id={`bc-name-${type}`}
                      label="Name shown to customers"
                      value={entry.displayName}
                      onChange={(v) => patch(type, { displayName: v })}
                      required
                    />
                    <TextField
                      id={`bc-size-${type}`}
                      label="Sheet size"
                      value={entry.sheetSize ?? ""}
                      onChange={(v) => patch(type, { sheetSize: v })}
                      placeholder="8ft × 4ft"
                    />
                    <TextField
                      id={`bc-thickness-${type}`}
                      label="Thicknesses"
                      value={entry.thickness ?? ""}
                      onChange={(v) => patch(type, { thickness: v })}
                      placeholder="18mm, 15mm"
                    />
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <TextField
                          id={`bc-image-${type}`}
                          label="Image address"
                          value={entry.imageUrl}
                          onChange={(v) => patch(type, { imageUrl: v })}
                          hint="a path or https:// link"
                        />
                      </div>
                      {!isDefaultImage && (
                        <button
                          type="button"
                          onClick={() => patch(type, { imageUrl: defaultBoardImage(type) })}
                          className="mb-1 cursor-pointer rounded-xl border border-night-600 p-3 text-cream-500 transition-colors hover:text-brass-300"
                          aria-label={`Restore the drawn swatch for ${entry.displayName}`}
                          title="Back to the drawn swatch"
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <TextAreaField
                        id={`bc-blurb-${type}`}
                        label="One line about it"
                        value={entry.blurb}
                        onChange={(v) => patch(type, { blurb: v })}
                        rows={2}
                        hint="what it is used for, in a customer's words"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save board catalogue
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setCatalogue(defaultBoardCatalogue());
            setError("");
          }}
        >
          Reset to defaults
        </Button>
        {saved && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400"
          >
            <CheckCircle2 size={16} /> Saved
          </span>
        )}
      </div>
    </section>
  );
}
