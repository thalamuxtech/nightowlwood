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
  EXPENSE_PROFIT_STREAM,
  PROFIT_STREAMS,
  type CostGroup,
  type ExpenseCategory,
  type ProfitStream,
  type TradingStream,
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

/**
 * Which trade an expense is charged to.
 *
 * The expense's own `stream` wins when it has a valid one, so a transport cost somebody knew was a
 * project delivery lands on projects rather than in overheads. Otherwise the category default
 * applies. Kept as a function rather than inlined because both the report and any future
 * per-stream screen must agree on the answer — two places deciding this differently is exactly how
 * a cost gets counted twice.
 */
export function streamOfExpense(
  stored: unknown,
  category: ExpenseCategory
): ProfitStream {
  if (typeof stored === "string" && (PROFIT_STREAMS as readonly string[]).includes(stored)) {
    return stored as ProfitStream;
  }
  return EXPENSE_PROFIT_STREAM[category] ?? "overhead";
}

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
  /**
   * How much of the period could be charged twice for the same goods: stock purchases typed
   * into the expense ledger while the same period's sales also carry a cost of goods.
   *
   * Zero when stock is received through the inventory screen, which is the intended route.
   * A warning rather than an adjustment — the figures are not corrected for it.
   */
  retailCogsRiskKobo: number;
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

/**
 * One trade's profitability, on its own cost base.
 *
 * The brief calls for "three completely separate profitability calculations", and the reason is
 * double counting: charging a manufacturing project for the gum used on somebody else's cutting
 * job makes both figures wrong at once. So each stream carries only what it consumed.
 */
export interface StreamProfit {
  stream: TradingStream;
  revenueKobo: number;
  /** Direct costs charged to this trade, by expense category. */
  byCategory: Partial<Record<ExpenseCategory, number>>;
  /** Metered power, which sits outside the expense ledger. Service only. */
  meteredPowerKobo: number;
  /** What the goods sold cost to buy. Retail only. */
  costOfGoodsKobo: number;
  directCostKobo: number;
  /** Revenue less direct costs. Before company overheads, which no trade carries alone. */
  grossKobo: number;
  /** Gross as a percentage of revenue; null when the stream earned nothing. */
  marginPercent: number | null;
}

export interface StreamedProfit {
  service: StreamProfit;
  project: StreamProfit;
  retail: StreamProfit;
  /**
   * Rent, salaries, admin and tax — owed by the company rather than by a trade.
   *
   * Reported as its own block and never apportioned. Splitting it across the three would need a
   * basis nobody has agreed, and an invented apportionment makes all three figures arguable
   * instead of one figure honest.
   */
  overheadKobo: number;
  overheadByCategory: Partial<Record<ExpenseCategory, number>>;
  /** The three gross figures added, less overheads. Reconciles with `netKobo`. */
  combinedNetKobo: number;
}

export interface ProfitReport {
  fromMs: number;
  toMs: number;
  revenue: RevenueBreakdown;
  costs: CostBreakdown;
  /**
   * The same period, split three ways.
   *
   * Carried alongside the consolidated figures rather than replacing them: the combined P&L
   * answers "did the business make money", which is a real question, and the three streams
   * answer "which trade made it", which is the one the brief is about.
   */
  streams: StreamedProfit;
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
   * Revenue, with the cost of what was sold netted off.
   *
   * Receiving stock does not write an expense — `recordMovement` books the quantity and the
   * unit cost against the item and nothing else — so the boards on the shelf have not been
   * charged to profit anywhere yet. Recognising them here, when they sell, is the single
   * charge for them, and it puts the cost in the period that earned the matching revenue
   * rather than the period the pallet arrived.
   *
   * The exposure is a purchase ALSO hand-entered in the expense ledger, which charges the
   * same boards twice — once as `purchases`/`materials` and again as cost of goods. That is
   * why stock bought for the counter should be received through the inventory screen and not
   * typed in as an expense; `retailCogsRiskKobo` below surfaces it when both are present.
   */
  const totalRevenueKobo = serviceKobo + productKobo + salesKobo - salesCostKobo;
  const netKobo = totalRevenueKobo - costTotalKobo;

  /*
   * How much of this period's profit could be charged twice for the same goods.
   *
   * Zero for a workshop that receives stock through the inventory screen. It goes positive
   * only when there are both counter sales and hand-entered stock purchases in the period,
   * and it is capped at the cost of goods sold because that is the most that can overlap —
   * a purchase larger than what sold is partly stock still on the shelf, which is not a
   * double charge but simply unsold. Reported rather than corrected: only the person who
   * typed the expense knows whether it was the same boards.
   */
  const stockExpenseKobo = (byCategory.purchases ?? 0) + (byCategory.materials ?? 0);
  const retailCogsRiskKobo =
    salesCostKobo > 0 ? Math.min(salesCostKobo, stockExpenseKobo) : 0;

  // --- The same period, split three ways ----------------------------------

  /*
   * Expenses sorted by which trade consumed them.
   *
   * An expense's own `stream` field wins where it has one, so a transport cost somebody knew was
   * for a project delivery lands on projects. Everything else falls back to the category default
   * in `EXPENSE_PROFIT_STREAM` — which is where the brief's exclusions are encoded: wages, power,
   * fuel, consumables and maintenance are service, boards and materials are project, and nothing
   * charges a project for a service machine.
   */
  const streamCategories: Record<ProfitStream, Partial<Record<ExpenseCategory, number>>> = {
    service: {},
    project: {},
    retail: {},
    overhead: {},
  };
  for (const d of expenseSnap.docs) {
    const x = d.data();
    const category = (x.category as ExpenseCategory) ?? "other";
    const stream = streamOfExpense(x.stream, category);
    const bucket = streamCategories[stream];
    bucket[category] = (bucket[category] ?? 0) + (x.amountKobo ?? 0);
  }

  const sumOf = (bucket: Partial<Record<ExpenseCategory, number>>) =>
    sumKobo(Object.values(bucket).map((v) => v ?? 0));

  const buildStream = (
    stream: TradingStream,
    revenueKobo: number,
    extras: { meteredPowerKobo?: number; costOfGoodsKobo?: number } = {}
  ): StreamProfit => {
    const byCat = streamCategories[stream];
    const metered = extras.meteredPowerKobo ?? 0;
    const cogs = extras.costOfGoodsKobo ?? 0;
    const directCostKobo = sumOf(byCat) + metered + cogs;
    const grossKobo = revenueKobo - directCostKobo;
    return {
      stream,
      revenueKobo,
      byCategory: byCat,
      meteredPowerKobo: metered,
      costOfGoodsKobo: cogs,
      directCostKobo,
      grossKobo,
      marginPercent:
        revenueKobo > 0 ? Math.round((grossKobo / revenueKobo) * 1000) / 10 : null,
    };
  };

  /*
   * Service carries metered power; retail carries its cost of goods; projects carry neither.
   *
   * Metered power is the workshop's machines, so it belongs to cutting and edging — and the brief
   * excludes it from projects by name. Retail's only direct cost is the stock it sold, which comes
   * from each sale's own `costOfGoodsKobo` rather than from the expense ledger, because the
   * purchase of that stock was already booked as an expense when it was bought. Adding both would
   * charge the business twice for the same boards.
   */
  const streams: StreamedProfit = {
    service: buildStream("service", serviceKobo, { meteredPowerKobo }),
    project: buildStream("project", productKobo),
    retail: buildStream("retail", salesKobo, { costOfGoodsKobo: salesCostKobo }),
    overheadKobo: sumOf(streamCategories.overhead) + commissionKobo,
    overheadByCategory: streamCategories.overhead,
    combinedNetKobo: 0,
  };
  streams.combinedNetKobo =
    streams.service.grossKobo +
    streams.project.grossKobo +
    streams.retail.grossKobo -
    streams.overheadKobo;

  return {
    fromMs: from.getTime(),
    toMs: to.getTime(),
    revenue: {
      serviceKobo,
      productKobo,
      salesKobo,
      salesTaxKobo,
      salesCostKobo,
      retailCogsRiskKobo,
      totalKobo: totalRevenueKobo,
    },
    costs: {
      byCategory,
      byGroup,
      meteredPowerKobo,
      commissionKobo,
      totalKobo: costTotalKobo,
    },
    streams,
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
