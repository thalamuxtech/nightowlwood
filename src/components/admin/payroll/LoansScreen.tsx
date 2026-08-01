"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { HandCoins, Loader2, PenLine, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { LOAN_STATUS_LABELS, LOAN_TYPES, type LoanStatus, type LoanType } from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import {
  approveLoan,
  cancelLoanRequest,
  rejectLoan,
  requestLoan,
  updateLoanRequest,
} from "@/lib/erp/payroll";
import { LOAN_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  EmptyState,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { StaffPicker, type PickedStaff } from "@/components/admin/services/StaffPicker";

interface LoanRow {
  id: string;
  staffId: string;
  staffName: string;
  type: LoanType;
  amountKobo: number;
  purpose: string;
  status: LoanStatus;
  repaidKobo: number;
  outstandingKobo: number;
  requestedAtMs: number | null;
}

/**
 * Loans and salary advances.
 *
 * Requesting is open to any staff member; approving is admin-only, because an
 * approval commits company money and creates a deduction against future wages.
 * The outstanding balance is what the wage run reads, so this ledger is the
 * single source for what someone still owes.
 */
export function LoansScreen() {
  const session = useErpSession();
  // Approving and settling loans, which an admin may delegate.
  const isAdmin = session.can("loan.approve");
  const canRequest = session.can("loan.request");

  const [rows, setRows] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  /** The pending request being corrected, or null when raising a new one. */
  const [editing, setEditing] = useState<LoanRow | null>(null);

  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [type, setType] = useState<LoanType>("advance");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");

  useEffect(() => {
    const q = query(collection(getDb(), COL.loans), orderBy("requestedAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              staffId: x.staffId ?? "",
              staffName: x.staffName ?? "",
              type: (x.type as LoanType) ?? "advance",
              amountKobo: x.amountKobo ?? 0,
              purpose: x.purpose ?? "",
              status: (x.status as LoanStatus) ?? "requested",
              repaidKobo: x.repaidKobo ?? 0,
              outstandingKobo: x.outstandingKobo ?? 0,
              requestedAtMs: x.requestedAt?.toMillis?.() ?? null,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "operator",
    }),
    [session.user, session.role]
  );

  const totalOutstanding = useMemo(
    () => rows.reduce((sum, r) => sum + r.outstandingKobo, 0),
    [rows]
  );
  const pending = useMemo(() => rows.filter((r) => r.status === "requested").length, [rows]);

  async function submit() {
    if (!staff) {
      setError("Select the staff member.");
      return;
    }
    const kobo = parseNairaInput(amount);
    if (kobo <= 0) {
      setError("Enter an amount.");
      return;
    }
    setBusyId(editing?.id ?? "new");
    setError("");
    try {
      const input = {
        staffId: staff.id,
        staffName: staff.name,
        type,
        amountKobo: kobo,
        purpose: purpose.trim() || "Not stated",
      };
      // The same form serves both paths, so a correction cannot drift from what a
      // new request accepts.
      if (editing) {
        await updateLoanRequest(getDb(), actor, editing.id, input);
      } else {
        await requestLoan(getDb(), actor, input);
      }
      setStaff(null);
      setAmount("");
      setPurpose("");
      setAdding(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the request.");
    } finally {
      setBusyId(null);
    }
  }

  /** Loads a pending request back into the form. */
  function beginEdit(row: LoanRow) {
    setEditing(row);
    setStaff({ id: row.staffId, name: row.staffName });
    setType(row.type);
    setAmount(String(row.amountKobo / 100));
    setPurpose(row.purpose === "Not stated" ? "" : row.purpose);
    setAdding(true);
    setError("");
  }

  async function withdraw(row: LoanRow) {
    setBusyId(row.id);
    setError("");
    try {
      await cancelLoanRequest(getDb(), actor, row.id, row.staffName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw the request.");
    } finally {
      setBusyId(null);
    }
  }

  async function decide(row: LoanRow, approve: boolean) {
    setBusyId(row.id);
    setError("");
    try {
      if (approve) {
        await approveLoan(getDb(), actor, row.id, row.staffName, row.amountKobo);
      } else {
        await rejectLoan(getDb(), actor, row.id, row.staffName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the request.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Payroll</p>
          <h1 className="text-title mt-3 text-cream-50">Loans &amp; advances</h1>
        </div>
        {canRequest && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> New request
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p role="alert" className="mt-6 flex items-center gap-2 text-sm text-red-400">
          <ShieldAlert size={16} /> {error}
        </p>
      )}

      {isAdmin && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Tile label="Outstanding" value={formatNaira(totalOutstanding)} tone="warn" />
          <Tile label="Awaiting decision" value={String(pending)} />
        </div>
      )}

      {adding && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <HandCoins size={18} className="text-brass-400" />{" "}
            {editing ? `Edit request from ${editing.staffName}` : "New request"}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <StaffPicker
              value={staff}
              onChange={setStaff}
              createdBy={actor.uid}
              label="Staff member"
              required
            />
            <SelectField
              id="loan-type"
              label="Type"
              value={type}
              onChange={(v) => setType(v as LoanType)}
              options={LOAN_TYPES.map((t) => ({
                value: t,
                label: t === "loan" ? "Loan" : "Salary advance",
              }))}
            />
            <NumberField
              id="loan-amount"
              label="Amount (₦)"
              value={amount}
              onChange={setAmount}
            />
            <TextField
              id="loan-purpose"
              label="Purpose"
              value={purpose}
              onChange={setPurpose}
              placeholder="Deposit salary"
            />
          </div>
          <p className="mt-3 text-xs text-cream-500">
            Nothing is owed until an admin approves and disburses, so a pending
            request does not appear as a deduction on the next wage run.
          </p>
          <div className="mt-5 flex gap-3">
            <Button onClick={submit} busy={busyId === (editing?.id ?? "new")}>
              Submit request
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}

      <section className="mt-8">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={24} aria-label="Loading" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No loans or advances"
            hint="Requests appear here for an admin to approve or reject."
          />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-night-700/60">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Staff</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Purpose</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-4">
                      <p className="text-cream-100">{r.staffName}</p>
                      {r.requestedAtMs && (
                        <p className="text-xs text-cream-500">
                          {new Date(r.requestedAtMs).toLocaleDateString("en-GB")}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-cream-400">
                      {r.type === "loan" ? "Loan" : "Advance"}
                    </td>
                    <td className="px-5 py-4 text-cream-400">{r.purpose}</td>
                    <td className="px-5 py-4 text-right text-cream-200">
                      {formatNaira(r.amountKobo)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span
                        className={
                          r.outstandingKobo > 0 ? "text-amber-300" : "text-cream-500"
                        }
                      >
                        {r.outstandingKobo > 0 ? formatNaira(r.outstandingKobo) : "-"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill tone={LOAN_STATUS_TONE[r.status]}>
                        {LOAN_STATUS_LABELS[r.status]}
                      </StatusPill>
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-4">
                        {r.status === "requested" && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={() => decide(r, true)} busy={busyId === r.id}>
                              Approve
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => decide(r, false)}
                              busy={busyId === r.id}
                            >
                              Reject
                            </Button>
                            {/* Only a pending request is editable. Once disbursed the
                                amount is a fact about money that has moved, and the
                                lib refuses it. */}
                            <button
                              type="button"
                              aria-label="Edit request"
                              onClick={() => beginEdit(r)}
                              className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
                            >
                              <PenLine size={15} />
                            </button>
                            <button
                              type="button"
                              aria-label="Withdraw request"
                              onClick={() => withdraw(r)}
                              className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          tone === "warn" ? "text-amber-300" : "text-cream-50"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
