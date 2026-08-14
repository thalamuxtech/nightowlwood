"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  GripVertical,
  Layers,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  BOARD_TYPE_LABELS,
  CE_RATED_BOARD_TYPES,
  type BoardType,
  type ProductCategory,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  loadTemplates,
  resetTemplate,
  saveTemplate,
  type StoredTemplate,
  type StoredTemplateItem,
} from "@/lib/erp/templateStore";
import {
  Button,
  CheckboxField,
  NairaField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The estimate templates, editable.
 *
 * They were a hard-coded constant, so adding a line or correcting a price meant a code change and a
 * redeploy — which the workshop cannot do, and which meant the paper spreadsheet and the system
 * drifted apart. An edit here shows up on the next project that adds that component.
 *
 * Prices are defaults, not fixed rates: they pre-fill the estimate and are typed over when a
 * supplier moves. That is the difference between saving somebody from retyping eight board prices
 * from memory and pretending a price never changes.
 */
export function EstimateTemplatesEditor() {
  const session = useErpSession();

  const [templates, setTemplates] = useState<StoredTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  /** Which template is expanded. One at a time — six open lists of thirty rows is unreadable. */
  const [openKey, setOpenKey] = useState<ProductCategory | null>(null);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "admin",
    }),
    [session.user, session.role]
  );

  const load = useCallback(() => {
    setLoading(true);
    loadTemplates(getDb())
      .then(setTemplates)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read the templates.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, version]);

  /** Edits one template in local state; nothing is written until Save. */
  function patch(category: ProductCategory, next: Partial<StoredTemplate>) {
    setTemplates((prev) =>
      prev.map((t) => (t.category === category ? { ...t, ...next } : t))
    );
  }

  function patchItem(
    category: ProductCategory,
    index: number,
    next: Partial<StoredTemplateItem>
  ) {
    setTemplates((prev) =>
      prev.map((t) =>
        t.category === category
          ? {
              ...t,
              items: t.items.map((it, i) => (i === index ? { ...it, ...next } : it)),
            }
          : t
      )
    );
  }

  async function save(template: StoredTemplate) {
    setError("");
    setBusy(true);
    try {
      await saveTemplate(getDb(), actor, template);
      setNotice(
        `${template.label} saved. New components of that kind will use it — projects already estimated are untouched.`
      );
      setTimeout(() => setNotice(""), 9000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the template.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(template: StoredTemplate) {
    const ok = window.confirm(
      `Put ${template.label} back to the standard list?\n\nYour changes to this template are discarded. Projects already estimated keep what they had.`
    );
    if (!ok) return;

    setError("");
    setBusy(true);
    try {
      await resetTemplate(getDb(), actor, template.category);
      setNotice(`${template.label} restored to the standard list.`);
      setTimeout(() => setNotice(""), 8000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Layers size={18} className="text-brass-400" /> Estimate templates
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          The checklist of lines a new component starts with, and what each is priced at by default.
          Edited here rather than in code, so a price correction reaches the next project without a
          release.
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
      {notice && (
        <p
          role="status"
          className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {loading ? (
        <p className="mt-5 text-sm text-cream-500">Loading templates…</p>
      ) : (
        <div className="mt-6 space-y-3">
          {templates.map((t) => {
            const expanded = openKey === t.category;
            const boards = t.items.filter((i) => i.isBoard).length;
            const priced = t.items.filter((i) => (i.defaultPriceKobo ?? 0) > 0).length;

            return (
              <div
                key={t.category}
                className="overflow-hidden rounded-2xl border border-night-700/60 bg-night-900/30"
              >
                <button
                  type="button"
                  onClick={() => setOpenKey(expanded ? null : t.category)}
                  aria-expanded={expanded}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 p-4 text-left"
                >
                  <span>
                    <span className="block text-cream-100">{t.label}</span>
                    <span className="mt-0.5 block text-xs text-cream-500">
                      {t.items.length} lines · {priced} priced
                      {boards > 0 && ` · ${boards} board types`}
                      {t.updatedAtMs === null && " · standard list"}
                    </span>
                  </span>
                  <ChevronDown
                    size={17}
                    className={`shrink-0 text-cream-500 transition-transform ${
                      expanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {expanded && (
                  <div className="border-t border-night-700/60 p-4">
                    <div className="mb-4 max-w-md">
                      <TextField
                        id={`tpl-label-${t.category}`}
                        label="Template name"
                        value={t.label}
                        onChange={(v) => patch(t.category, { label: v })}
                      />
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[52rem] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wider text-cream-600">
                          <tr>
                            <th className="pb-2 font-medium">Line</th>
                            <th className="pb-2 font-medium">Kind</th>
                            <th className="pb-2 font-medium">Default price</th>
                            <th className="pb-2 font-medium">Boards?</th>
                            <th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-night-800/70">
                          {t.items.map((item, i) => (
                            <tr key={`${t.category}-${i}`}>
                              <td className="py-2 pr-3">
                                <div className="flex items-center gap-2">
                                  <GripVertical
                                    size={13}
                                    className="shrink-0 text-cream-700"
                                    aria-hidden
                                  />
                                  <input
                                    value={item.item}
                                    onChange={(e) =>
                                      patchItem(t.category, i, { item: e.target.value })
                                    }
                                    aria-label={`Line ${i + 1} name`}
                                    className="w-full min-w-[12rem] rounded-lg border border-night-700 bg-night-950/50 px-2.5 py-1.5 text-sm text-cream-100 outline-none focus:border-brass-500/60"
                                  />
                                </div>
                              </td>
                              <td className="py-2 pr-3">
                                {/* Materials are quantity times price; derived lines are lump sums
                                    or percentages of the material subtotal. Getting this wrong puts
                                    the margin inside the base it is calculated from. */}
                                <select
                                  value={item.kind}
                                  onChange={(e) =>
                                    patchItem(t.category, i, {
                                      kind: e.target.value as StoredTemplateItem["kind"],
                                    })
                                  }
                                  aria-label={`Line ${i + 1} kind`}
                                  className="cursor-pointer rounded-lg border border-night-700 bg-night-950/50 px-2.5 py-1.5 text-sm text-cream-200 outline-none focus:border-brass-500/60"
                                >
                                  <option value="material">Material</option>
                                  <option value="derived">Derived</option>
                                </select>
                              </td>
                              <td className="py-2 pr-3">
                                <input
                                  inputMode="decimal"
                                  value={
                                    item.defaultPriceKobo
                                      ? String(toNaira(item.defaultPriceKobo))
                                      : ""
                                  }
                                  onChange={(e) =>
                                    patchItem(t.category, i, {
                                      defaultPriceKobo: e.target.value
                                        ? parseNairaInput(e.target.value)
                                        : undefined,
                                    })
                                  }
                                  placeholder="—"
                                  aria-label={`Line ${i + 1} default price`}
                                  className="w-28 rounded-lg border border-night-700 bg-night-950/50 px-2.5 py-1.5 text-sm tabular-nums text-cream-100 outline-none focus:border-brass-500/60"
                                />
                              </td>
                              <td className="py-2 pr-3">
                                {/* Ticking this is what makes the line count toward the cutting and
                                    edging charge, and the board type is what prices that per
                                    material — MFC 9x7 at 6,400 against Kwali at 1,500. */}
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={item.isBoard ?? false}
                                    onChange={(e) =>
                                      patchItem(t.category, i, {
                                        isBoard: e.target.checked,
                                        boardType: e.target.checked
                                          ? (item.boardType ?? "mdf")
                                          : undefined,
                                      })
                                    }
                                    aria-label={`Line ${i + 1} is boards`}
                                    className="size-4 cursor-pointer accent-brass-500"
                                  />
                                  {item.isBoard && (
                                    <select
                                      value={item.boardType ?? "mdf"}
                                      onChange={(e) =>
                                        patchItem(t.category, i, {
                                          boardType: e.target.value as BoardType,
                                        })
                                      }
                                      aria-label={`Line ${i + 1} board type`}
                                      className="cursor-pointer rounded-lg border border-night-700 bg-night-950/50 px-2 py-1.5 text-xs text-cream-200 outline-none focus:border-brass-500/60"
                                    >
                                      {CE_RATED_BOARD_TYPES.map((b) => (
                                        <option key={b} value={b}>
                                          {BOARD_TYPE_LABELS[b]}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    patch(t.category, {
                                      items: t.items.filter((_, x) => x !== i),
                                    })
                                  }
                                  aria-label={`Remove ${item.item}`}
                                  className="cursor-pointer text-cream-600 transition-colors hover:text-red-300"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          patch(t.category, {
                            items: [
                              ...t.items,
                              { item: "", kind: "material" as const },
                            ],
                          })
                        }
                      >
                        <span className="flex items-center gap-1.5">
                          <Plus size={14} /> Add a line
                        </span>
                      </Button>
                      <Button onClick={() => save(t)} busy={busy}>
                        Save {t.label}
                      </Button>
                      <Button variant="ghost" onClick={() => reset(t)}>
                        <span className="flex items-center gap-1.5">
                          <RotateCcw size={14} /> Standard list
                        </span>
                      </Button>
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-cream-500">
                      Saving affects components added <em>after</em> it. A project already estimated
                      keeps the lines and prices it was built with, which is what stops a price
                      correction quietly restating a quote the client has already seen.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
