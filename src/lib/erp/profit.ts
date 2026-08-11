import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import {
  COST_GROUPS,
  EXPENSE_COST_GROUP,
  type CostGroup,
  type ExpenseCategory,
} from "./enums";
import { sumKobo } from "./money";

/**
 * Profit and loss.
 *
 * The hard part of this report is not the subtraction — it is counting each naira
 * exactly once. Several modules already write to the expense ledger, so the naive
 * version of this screen double-counts:
 *
 * - **Payroll** books its net pay to `expenses` when a run is marked paid. So wages
 *   and salaries are read *from the expense ledger*, never re-summed from the runs.
 *   Summing both would double the workshop's largest cost.
 * - **Project purchases** book to `expenses` on save, carrying `sourceCollection`.
 *   Again: read from expenses, not from the purchase records.
 * - **Power** is the exception, and deliberately. Meter readings are their own
 *   ledger and are *not* booked as expenses, so they are added from
 *   `meterReadings`. Any expense a user has *also* typed under the `power` category
 *   is counted too, because that is a real bill (a diesel delivery, a PHCN top-up)
 *   distinct from metered consumption.
 * - **Cost of goods sold** comes from the sales themselves, not from expenses. Stock
 *   was bought at some earlier date and that purchase is already an expense; adding
 *   COGS to the expense total would count the same stock twice. It is therefore
 *   netted against sales revenue rather than added to costs — see `salesMarginKobo`.
 *
 * The rule, stated once: **the expense ledger is the single source of truth for money
 * paid out.** Anything that books itself there is read from there and from nowhere
 * else. Only metered power and cost of goods are computed outside it, and both are
 * documented above.
 */

export interface RevenueBreakdown {
  /** Service jobs, by their recorded total. */
  serviceKobo: number;
  /** Projects, at contract value where agreed, estimate otherwise. */
  productKobo: number;
  /** Counter sales, net of tax — tax collected is not the workshop's money. */
  salesKobo: number;
  /** Tax collected on counter sales, owed onward rather than earned. */
  salesTaxKobo: number;
  /** What the goods sold at the counter had cost to buy. */
  salesCostKobo: number;
  totalKobo: number;
}

export interface CostBreakdown {
  /** Every expense-ledger category, summed. */
  byCategory: Partial<Record<ExpenseCategory, number>>;
  byGroup: Record<CostGroup, number>;
  /** Metered power, which is not in the expense ledger. */
  meteredPowerKobo: number;
  /** Commission committed on issued invoices. */
  commissionKobo: number;
  totalKobo: number;
}

export interface ProfitReport {
  fromMs: number;
  toMs: number;
  revenue: RevenueBreakdown;
  costs: CostBreakdown;
  /** Revenue less costs. */
  netKobo: number;
  /** Net as a percentage of revenue; null when there was no revenue. */
  marginPercent: number | null;
  /** Counts, so an empty report can say whether it found nothing or read nothing. */
  counts: {
    jobs: number;
    projects: number;
    sales: number;
    expenses: number;
    meterReadings: number;
    invoicesWithCommission: number;
  };
}

/**
 * Builds the report for a period.
 *
 * Everything is read in parallel and reduced locally. The alternative — aggregating
 * server-side — would need Cloud Functions maintaining running totals, and a running
 * total that drifts from its source is worse than a report that takes a second to
 * compute.
 */
export async function buildProfitReport(
  db: Firestore,
  from: Date,
  to: Date
): Promise<ProfitReport> {
  const fromTs = Timestamp.fromDate(from);
  const toTs = Timestamp.fromDate(to);

  const [jobSnap, projSnap, saleSnap, expenseSnap, meterSnap, invoiceSnap] =
    await Promise.all([
      getDocs(
        query(
          collection(db, COL.serviceJobs),
          where("receivedAt", ">=", fromTs),
          where("receivedAt", "<=", toTs)
        )
      ),
      getDocs(
        query(
          collection(db, COL.projects),
          where("startDate", ">=", fromTs),
          where("startDate", "<=", toTs)
        )
      ),
      getDocs(
        query(
          collection(db, COL.sales),
          where("soldAt", ">=", fromTs),
          where("soldAt", "<=", toTs)
        )
      ),
      getDocs(
        query(
          collection(db, COL.expenses),
          where("date", ">=", fromTs),
          where("date", "<=", toTs)
        )
      ),
      getDocs(
        query(
          collection(db, COL.meterReadings),
          where("date", ">=", fromTs),
          where("date", "<=", toTs)
        )
      ),
      getDocs(
        query(
          collection(db, COL.invoices),
          where("createdAt", ">=", fromTs),
          where("createdAt", "<=", toTs)
        )
      ),
    ]);

  // --- Revenue ------------------------------------------------------------

  // Cancelled jobs earned nothing; leaving them in would inflate revenue with work
  // that did not happen.
  const jobs = jobSnap.docs.filter((d) => d.data().status !== "cancelled");
  const serviceKobo = sumKobo(jobs.map((d) => d.data().totalKobo ?? 0));

  const projects = projSnap.docs.filter((d) => d.data().status !== "cancelled");
  const productKobo = sumKobo(
    projects.map((d) => d.data().contractValueKobo ?? d.data().estimatedCostKobo ?? 0)
  );

  /*
   * Counter sales, at full value rather than at what was collected.
   *
   * A sale on account is earned when the goods leave: the stock went out and its cost was
   * incurred, so the revenue belongs to that period whether or not the customer has paid. Using
   * the amount received would report a loss on every credit sale — cost counted, revenue not —
   * and a matching windfall in whatever month the money arrived.
   *
   * What is still owed is a receivable rather than a missing profit, and is reported as such on
   * the counter screen. Voided sales are excluded: those goods came back.
   */
  const sales = saleSnap.docs.filter((d) => d.data().status !== "voided");
  const salesGrossKobo = sumKobo(sales.map((d) => d.data().totalKobo ?? 0));
  const salesTaxKobo = sumKobo(sales.map((d) => d.data().taxKobo ?? 0));
  const salesCostKobo = sumKobo(sales.map((d) => d.data().costOfGoodsKobo ?? 0));
  const salesOwedKobo = sumKobo(sales.map((d) => d.data().balanceKobo ?? 0));
  // Net of tax: tax collected is held for the revenue service, not earned.
  const salesKobo = salesGrossKobo - salesTaxKobo;

  // --- Costs --------------------------------------------------------------

  const byCategory: Partial<Record<ExpenseCategory, number>> = {};
  for (const d of expenseSnap.docs) {
    const category = (d.data().category as ExpenseCategory) ?? "other";
    byCategory[category] = (byCategory[category] ?? 0) + (d.data().amountKobo ?? 0);
  }

  const expenseTotalKobo = sumKobo(
    expenseSnap.docs.map((d) => d.data().amountKobo ?? 0)
  );

  // Metered power. Not in the expense ledger, so added here — the only cost that is.
  const meteredPowerKobo = sumKobo(
    meterSnap.docs.map((d) => d.data().amountKobo ?? 0)
  );

  /*
   * Commission on issued invoices.
   *
   * Drafts are excluded: a draft has not been sent, so nothing has been promised to
   * anyone. Voided invoices are excluded for the same reason in reverse — the work
   * was cancelled, so the commission is not owed.
   */
  const commissionInvoices = invoiceSnap.docs.filter((d) => {
    const status = d.data().status;
    return (
      status !== "draft" && status !== "void" && (d.data().commissionKobo ?? 0) > 0
    );
  });
  const commissionKobo = sumKobo(
    commissionInvoices.map((d) => d.data().commissionKobo ?? 0)
  );

  const byGroup = COST_GROUPS.reduce(
    (acc, g) => ({ ...acc, [g]: 0 }),
    {} as Record<CostGroup, number>
  );
  for (const [category, amount] of Object.entries(byCategory)) {
    const group = EXPENSE_COST_GROUP[category as ExpenseCategory] ?? "overhead";
    byGroup[group] += amount ?? 0;
  }
  byGroup.power += meteredPowerKobo;
  // Commission is a cost of winning work, which is an overhead rather than a
  // material or a wage.
  byGroup.overhead += commissionKobo;

  const costTotalKobo = expenseTotalKobo + meteredPowerKobo + commissionKobo;

  /*
   * Revenue.
   *
   * Cost of goods is subtracted from sales here rather than added to costs, because
   * the stock was bought earlier and that purchase is already in the expense ledger.
   * Adding COGS to the cost side would charge the business twice for the same boards.
   */
  const totalRevenueKobo = serviceKobo + productKobo + salesKobo - salesCostKobo;
  const netKobo = totalRevenueKobo - costTotalKobo;

  return {
    fromMs: from.getTime(),
    toMs: to.getTime(),
    revenue: {
      serviceKobo,
      productKobo,
      salesKobo,
      salesTaxKobo,
      salesCostKobo,
      totalKobo: totalRevenueKobo,
    },
    costs: {
      byCategory,
      byGroup,
      meteredPowerKobo,
      commissionKobo,
      totalKobo: costTotalKobo,
    },
    netKobo,
    marginPercent:
      totalRevenueKobo > 0
        ? Math.round((netKobo / totalRevenueKobo) * 1000) / 10
        : null,
    counts: {
      jobs: jobs.length,
      projects: projects.length,
      sales: sales.length,
      expenses: expenseSnap.size,
      meterReadings: meterSnap.size,
      invoicesWithCommission: commissionInvoices.length,
    },
  };
}

/**
 * Profit on one project.
 *
 * The estimate says what the job was expected to cost; the purchases booked against
 * it say what it really cost. Until purchases were recorded there was no way to know
 * whether a project made money, because the only figure on file was the one quoted
 * before any material was bought.
 *
 * Labour is deliberately absent. Piece-rate work is logged per operator and per week,
 * not per project, so apportioning it to a project would be a guess — and a guess in
 * a profit figure is worse than a stated gap. What is reported is contract value less
 * recorded purchases, which is exact.
 */
export async function projectProfit(
  db: Firestore,
  projectId: string
): Promise<{
  revenueKobo: number;
  purchaseKobo: number;
  grossKobo: number;
  marginPercent: number | null;
  purchaseCount: number;
}> {
  const [projSnap, purchaseSnap] = await Promise.all([
    getDocs(query(collection(db, COL.projects), where("__name__", "==", projectId))),
    getDocs(
      query(
        collection(db, `${COL.projects}/${projectId}/purchases`),
        orderBy("purchasedAt", "desc")
      )
    ),
  ]);

  const project = projSnap.docs[0]?.data();
  const revenueKobo = project?.contractValueKobo ?? project?.estimatedCostKobo ?? 0;
  const purchaseKobo = sumKobo(
    purchaseSnap.docs.map((d) => d.data().totalCostKobo ?? 0)
  );
  const grossKobo = revenueKobo - purchaseKobo;

  return {
    revenueKobo,
    purchaseKobo,
    grossKobo,
    marginPercent:
      revenueKobo > 0 ? Math.round((grossKobo / revenueKobo) * 1000) / 10 : null,
    purchaseCount: purchaseSnap.size,
  };
}
