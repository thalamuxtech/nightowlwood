"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  APPROVAL_OPERATIONS,
  APPROVAL_OPERATION_HINTS,
  APPROVAL_OPERATION_LABELS,
  DEFAULT_APPROVAL_POLICY,
  loadApprovalPolicy,
  saveApprovalPolicy,
  type ApprovalOperation,
  type ApprovalPolicy,
} from "@/lib/erp/approvalPolicy";
import { Button, CheckboxField } from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Which operations need a second pair of eyes.
 *
 * Super admin only, and the reason is worth stating on the screen as well as in the code: an
 * admin who could edit this would be able to clear the requirement on their own next deletion.
 *
 * Nothing is gated by default. A gate that appeared without anybody choosing it would read as a
 * bug to a workshop that never asked for one, so the recommendation below is advice rather than
 * a preset.
 */
export function ApprovalPolicyEditor() {
  const session = useErpSession();
  const actor = useAuditActor();
  // The real role, not the acting one: this screen configures how the system treats the roles a
  // super admin can switch into, so it should not appear from inside one of them.
  const mayConfigure = session.canReally("approval.configure");

  const [policy, setPolicy] = useState<ApprovalPolicy>(DEFAULT_APPROVAL_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadApprovalPolicy(getDb())
      .then(setPolicy)
      .catch(() => setError("Could not read the approval policy."))
      .finally(() => setLoading(false));
  }, []);

  if (!mayConfigure) return null;

  function toggle(op: ApprovalOperation, on: boolean) {
    setPolicy((p) => ({
      ...p,
      required: on ? [...p.required, op] : p.required.filter((x) => x !== op),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await saveApprovalPolicy(getDb(), actor, policy);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the approval policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-night-700/70 bg-night-900 p-7">
      <h2 className="flex items-center gap-2 font-display text-xl text-cream-100">
        <ShieldCheck size={18} className="text-brass-400" /> Approvals
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
        Tick an operation to make it need a decision before it happens — for everybody,
        including administrators who could otherwise do it directly. Whoever acts still has to
        give a reason either way; the tick decides whether somebody else has to agree.
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-500">
        Worth being sparing. An approval queue means something when the person reading it is
        somebody else who will actually look — gate everything in a one-administrator workshop
        and it becomes a weekly formality, which is worse than no gate, because the record then
        claims a scrutiny that did not happen. The deletions that change what somebody is owed
        are the ones worth the friction.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-cream-500">Loading…</p>
      ) : (
        <>
          <div className="mt-6 space-y-3">
            {APPROVAL_OPERATIONS.map((op) => (
              <div
                key={op}
                className="rounded-xl border border-night-700/60 bg-night-950/40 px-4 py-3"
              >
                <CheckboxField
                  id={`ap-${op}`}
                  label={APPROVAL_OPERATION_LABELS[op]}
                  checked={policy.required.includes(op)}
                  onChange={(v) => toggle(op, v)}
                />
                <p className="mt-1 pl-7 text-xs leading-relaxed text-cream-500">
                  {APPROVAL_OPERATION_HINTS[op]}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-brass-500/30 bg-brass-500/5 px-4 py-3">
            <CheckboxField
              id="ap-super-only"
              label="Only the super admin can approve or refuse"
              checked={policy.superAdminDecidesOnly}
              onChange={(v) => setPolicy((p) => ({ ...p, superAdminDecidesOnly: v }))}
            />
            <p className="mt-1 pl-7 text-xs leading-relaxed text-cream-500">
              Administrators can still raise a request; only you decide it. Leave this off and
              anyone holding the approval grant may decide. Either way, withdrawing your own
              request stays open to whoever made it.
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center gap-4">
            <Button onClick={save} disabled={saving}>
              <span className="flex items-center gap-2">
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {saving ? "Saving…" : "Save approval policy"}
              </span>
            </Button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400" role="status">
                <CheckCircle2 size={16} /> Saved
              </span>
            )}
            <span className="text-xs text-cream-600">
              {policy.required.length === 0
                ? "Nothing needs approval"
                : `${policy.required.length} operation${policy.required.length === 1 ? "" : "s"} gated`}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
