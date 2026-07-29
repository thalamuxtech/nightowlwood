import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, jobLinesPath, jobPaymentsPath } from "./collections";
import type { BoardType, JobStatus, ServiceType, WageWorkType } from "./enums";
import { lineAmountKobo, toKobo } from "./money";

/**
 * Demo data for exercising the system end to end.
 *
 * Every document carries `isDemo: true`, which is what makes removal exact: the
 * clear operation deletes only documents bearing that flag, so it can never
 * touch real records. Nothing here writes to the collections the user asked to
 * leave alone (work gallery, users, blog, submissions).
 *
 * Dates are spread over the past six weeks so the revenue chart and the weekly
 * wage runs have something meaningful to show rather than one flat spike.
 */

export const DEMO_FLAG = "isDemo";

/** Collections the seeder writes to, and the clear operation empties. */
export const DEMO_COLLECTIONS = [
  COL.customers,
  COL.staff,
  COL.serviceJobs,
  COL.workLogs,
  COL.projects,
  COL.estimates,
  COL.invoices,
  COL.expenses,
  COL.loans,
  COL.inventoryCompany,
  COL.inventoryService,
  COL.consumableCycles,
  COL.suppliers,
  COL.consumableBrands,
  COL.purchases,
  COL.toolRequests,
  COL.meterReadings,
] as const;

interface SeedProgress {
  (message: string): void;
}

const CUSTOMERS = [
  { name: "Dawisu Interiors", phone: "0803 214 5566", service: true, product: true },
  { name: "Y Momi Furniture", phone: "0805 771 2390", service: true, product: false },
  { name: "Bashir Contractors", phone: "0810 455 8821", service: true, product: true },
  { name: "Hassan Woodcraft", phone: "0706 332 9014", service: true, product: false },
  { name: "Yellow Designs", phone: "0812 908 4471", service: true, product: true },
  { name: "S Dogo Builders", phone: "0902 118 7735", service: true, product: false },
  { name: "Laminex Interiors Ltd", phone: "0814 662 0093", service: false, product: true },
  { name: "Engr. Musa Abdullahi", phone: "0703 559 2210", service: true, product: true },
];

const STAFF = [
  { name: "Salahu Ibrahim", title: "Senior machine operator", op: true, as: false },
  { name: "Amir Yusuf", title: "Machine operator", op: true, as: false },
  { name: "Baba Shasan", title: "Operator", op: true, as: true },
  { name: "Dauda Sani", title: "Assistant", op: false, as: true },
  { name: "Kabiru Lawal", title: "Assistant", op: false, as: true },
  { name: "Nuhu Garba", title: "Assistant", op: false, as: true },
];

/** Service work priced from the observed rate card. */
const JOB_TEMPLATES: Array<{
  boards: Partial<Record<BoardType | "tape", number>>;
  lines: Array<{ serviceType: ServiceType; boardType?: BoardType; qty: number; naira: number }>;
  status: JobStatus;
  paidFraction: number;
}> = [
  {
    boards: { mdf: 12, tape: 3 },
    lines: [{ serviceType: "cutting_edging", boardType: "mdf", qty: 12, naira: 2000 }],
    status: "collected",
    paidFraction: 1,
  },
  {
    boards: { egger: 8 },
    lines: [
      { serviceType: "cutting_edging", boardType: "egger", qty: 8, naira: 2300 },
      { serviceType: "grooving", qty: 4200, naira: 1 },
    ],
    status: "collected",
    paidFraction: 1,
  },
  {
    boards: { egger: 10, quarter: 2 },
    lines: [{ serviceType: "door", boardType: "egger", qty: 10, naira: 10000 }],
    status: "collected",
    paidFraction: 1,
  },
  {
    boards: { mdf: 15 },
    lines: [{ serviceType: "cutting_edging", boardType: "mdf", qty: 15, naira: 2000 }],
    status: "ready_for_pickup",
    paidFraction: 0.5,
  },
  {
    boards: { egger: 4 },
    lines: [
      { serviceType: "frame", boardType: "egger", qty: 4, naira: 3300 },
      { serviceType: "only_cutting", boardType: "egger", qty: 6, naira: 1000 },
    ],
    status: "qc",
    paidFraction: 0.4,
  },
  {
    boards: { mdf: 6, kwali: 4 },
    lines: [{ serviceType: "cutting_edging", boardType: "mdf", qty: 6, naira: 2000 }],
    status: "in_progress",
    paidFraction: 0,
  },
  {
    boards: { egger: 1 },
    lines: [{ serviceType: "double_door", boardType: "egger", qty: 1, naira: 18000 }],
    status: "collected",
    paidFraction: 1,
  },
  {
    boards: { mdf: 20, tape: 5 },
    lines: [{ serviceType: "cutting_edging", boardType: "mdf", qty: 20, naira: 2300 }],
    status: "received",
    paidFraction: 0,
  },
  {
    boards: { hdf: 3 },
    lines: [{ serviceType: "glass", qty: 2, naira: 3000 }],
    status: "collected",
    paidFraction: 1,
  },
  {
    boards: { mdf: 9, egger: 5 },
    lines: [
      { serviceType: "cutting_edging", boardType: "mdf", qty: 9, naira: 2000 },
      { serviceType: "frame", boardType: "egger", qty: 5, naira: 3300 },
    ],
    status: "ready_for_pickup",
    paidFraction: 0.6,
  },
];

/** Piece-rate work spread across the six weeks, feeding the wage runs. */
const WORK_PATTERN: Array<{ workType: WageWorkType; units: number; assistants: number }> = [
  { workType: "board", units: 26, assistants: 3 },
  { workType: "board", units: 41, assistants: 2 },
  { workType: "egger" as WageWorkType, units: 0, assistants: 0 }, // filtered out below
  { workType: "door", units: 4, assistants: 1 },
  { workType: "frame", units: 6, assistants: 2 },
  { workType: "only_cutting", units: 12, assistants: 0 },
  { workType: "grooving", units: 5000, assistants: 0 },
  { workType: "board", units: 18, assistants: 3 },
  { workType: "door", units: 2, assistants: 1 },
  { workType: "board", units: 33, assistants: 2 },
];

const PROJECTS = [
  {
    title: "Yakubu 4-bedroom, Gwarinpa",
    location: "Gwarinpa, Abuja",
    status: "in_production" as const,
    components: [
      { name: "Main kitchen", category: "kitchen" as const, valueNaira: 1_850_000 },
      { name: "Master closet", category: "closets" as const, valueNaira: 720_000 },
      { name: "Living TV wall", category: "tv_wall_panels" as const, valueNaira: 480_000 },
    ],
  },
  {
    title: "Laminex showroom fit-out",
    location: "Wuse II, Abuja",
    status: "approved" as const,
    components: [
      { name: "Display closets", category: "closets" as const, valueNaira: 960_000 },
      { name: "Reception panel", category: "tv_wall_panels" as const, valueNaira: 340_000 },
    ],
  },
  {
    title: "Musa residence doors",
    location: "Life Camp, Abuja",
    status: "completed" as const,
    components: [{ name: "Internal doors x12", category: "doors" as const, valueNaira: 1_320_000 }],
  },
  {
    title: "Bashir duplex bedset",
    location: "Katampe, Abuja",
    status: "estimating" as const,
    components: [{ name: "Master bedset", category: "bedset" as const, valueNaira: 640_000 }],
  },
];

const EXPENSES: Array<{ purpose: string; category: string; naira: number; payee: string }> = [
  { purpose: "Food and salary", category: "food", naira: 500, payee: "Salahu Ibrahim" },
  { purpose: "Transport", category: "transport", naira: 3000, payee: "Company" },
  { purpose: "Diesel for generator", category: "fuel", naira: 45000, payee: "AY Oil & Gas" },
  { purpose: "Edge tape restock", category: "consumables", naira: 62000, payee: "Dumbem Supplies" },
  { purpose: "Blade replacement", category: "consumables", naira: 38000, payee: "Freud Nigeria" },
  { purpose: "Factory rent", category: "rent", naira: 250000, payee: "Company" },
  { purpose: "Pure water and drinks", category: "food", naira: 10000, payee: "Company" },
  { purpose: "Machine servicing", category: "maintenance", naira: 27500, payee: "Technician" },
];

const SUPPLIERS = [
  { name: "Freud Nigeria", categories: ["blades"], lead: 6, onTime: true },
  { name: "Infrawood Tools", categories: ["blades"], lead: 14, onTime: false },
  { name: "Dumbem Supplies", categories: ["gum", "tape"], lead: 3, onTime: true },
  { name: "Sahel Board Depot", categories: ["boards"], lead: 9, onTime: true },
];

/**
 * Consumable cycles that reproduce the pattern in the legacy sheet: Freud
 * blades lasting ~14 days against Infrawood's ~4, so the brand scorecard has
 * something real to rank.
 */
const CYCLES = [
  { brand: "Freud Blade", days: 16, units: 1240, naira: 38000, reason: "worn_out" },
  { brand: "Freud Blade", days: 12, units: 980, naira: 38000, reason: "worn_out" },
  { brand: "Freud Blade", days: 14, units: 1100, naira: 38000, reason: "worn_out" },
  { brand: "Infrawood BLD", days: 4, units: 260, naira: 19000, reason: "broke_early" },
  { brand: "Infrawood BLD", days: 5, units: 310, naira: 19000, reason: "worn_out" },
  { brand: "Infrawood BLD", days: 3, units: 190, naira: 19000, reason: "broke_early" },
];

const INVENTORY = [
  { name: "MDF 18mm", category: "boards", unit: "sheet", onHand: 42, reorder: 20, naira: 14500 },
  { name: "Egger 18mm", category: "boards", unit: "sheet", onHand: 8, reorder: 15, naira: 21000 },
  { name: "Edge tape 22mm", category: "consumables", unit: "roll", onHand: 3, reorder: 10, naira: 4200 },
  { name: "Pressing gum", category: "consumables", unit: "carton", onHand: 6, reorder: 4, naira: 18500 },
  { name: "Hinges (soft close)", category: "fittings", unit: "pair", onHand: 120, reorder: 50, naira: 1800 },
  { name: "Screws 1 1/4", category: "fittings", unit: "pack", onHand: 2, reorder: 8, naira: 2500 },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 30, 0, 0);
  return d;
}

function pad(n: number, w = 4): string {
  return String(n).padStart(w, "0");
}

/**
 * Seeds the demo dataset.
 *
 * Writes in several batches rather than one: Firestore caps a batch at 500
 * operations, and this exceeds that once jobs bring their line and payment
 * subcollections with them.
 */
export async function seedDemoData(
  db: Firestore,
  createdBy: string,
  onProgress: SeedProgress = () => {}
): Promise<{ written: number }> {
  const year = new Date().getFullYear();
  let written = 0;
  const base = { [DEMO_FLAG]: true, createdAt: serverTimestamp(), createdBy };

  // --- Customers and staff -------------------------------------------------
  onProgress("Customers and staff");
  let batch = writeBatch(db);
  const customerIds: Array<{ id: string; name: string; phone: string }> = [];
  for (const c of CUSTOMERS) {
    const ref = doc(collection(db, COL.customers));
    batch.set(ref, {
      ...base,
      name: c.name,
      phone: c.phone,
      isServiceCustomer: c.service,
      isProductClient: c.product,
    });
    customerIds.push({ id: ref.id, name: c.name, phone: c.phone });
    written += 1;
  }

  const staffIds: Array<{ id: string; name: string; op: boolean; as: boolean }> = [];
  for (const s of STAFF) {
    const ref = doc(collection(db, COL.staff));
    batch.set(ref, {
      ...base,
      name: s.name,
      jobTitle: s.title,
      isOperator: s.op,
      isAssistant: s.as,
      active: true,
    });
    staffIds.push({ id: ref.id, name: s.name, op: s.op, as: s.as });
    written += 1;
  }
  await batch.commit();

  const operators = staffIds.filter((s) => s.op);
  const assistants = staffIds.filter((s) => s.as);

  // --- Service jobs --------------------------------------------------------
  onProgress("Service jobs, lines and payments");
  batch = writeBatch(db);
  let ops = 0;
  const commitIfFull = async () => {
    // Keep well clear of the 500-operation ceiling.
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (let i = 0; i < JOB_TEMPLATES.length; i += 1) {
    const t = JOB_TEMPLATES[i];
    const customer = customerIds[i % customerIds.length];
    const staffMember = operators[i % operators.length];
    const when = daysAgo(40 - i * 4);

    const lines = t.lines.map((l) => ({
      serviceType: l.serviceType,
      boardType: l.boardType ?? null,
      quantity: l.qty,
      unitPriceKobo: toKobo(l.naira),
      amountKobo: lineAmountKobo(l.qty, toKobo(l.naira)),
    }));
    const totalKobo = lines.reduce((s, l) => s + l.amountKobo, 0);
    const paidKobo = Math.round(totalKobo * t.paidFraction);

    const jobRef = doc(collection(db, COL.serviceJobs));
    batch.set(jobRef, {
      ...base,
      jobNumber: `JOB-${year}-${pad(900 + i)}`,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      staffId: staffMember.id,
      staffName: staffMember.name,
      boards: t.boards,
      accessories: i % 3 === 0 ? "Hinges, handles" : null,
      repName: i % 2 === 0 ? "Site rep" : null,
      repPhone: i % 2 === 0 ? "0807 221 5566" : null,
      status: t.status,
      receivedAt: Timestamp.fromDate(when),
      completedAt: t.status === "collected" ? Timestamp.fromDate(daysAgo(38 - i * 4)) : null,
      totalKobo,
      paidKobo,
      balanceKobo: totalKobo - paidKobo,
      quantityCheck: t.status === "collected" ? true : null,
      qualityCheck: t.status === "collected" ? true : null,
      pickupBy: t.status === "collected" ? customer.name : null,
    });
    ops += 1;

    for (const l of lines) {
      batch.set(doc(collection(db, jobLinesPath(jobRef.id))), l);
      ops += 1;
    }
    if (paidKobo > 0) {
      batch.set(doc(collection(db, jobPaymentsPath(jobRef.id))), {
        ...base,
        date: Timestamp.fromDate(when),
        description: t.paidFraction >= 1 ? "Full payment" : "Deposit",
        amountKobo: paidKobo,
        method: i % 2 === 0 ? "transfer" : "cash",
      });
      ops += 1;
    }
    written += 1 + lines.length + (paidKobo > 0 ? 1 : 0);
    await commitIfFull();
  }
  await batch.commit();

  // --- Work logs -----------------------------------------------------------
  onProgress("Work logs");
  batch = writeBatch(db);
  const usable = WORK_PATTERN.filter((w) => w.units > 0);
  for (let week = 0; week < 6; week += 1) {
    for (let j = 0; j < usable.length; j += 1) {
      const w = usable[j];
      const operator = operators[(week + j) % operators.length];
      const chosen = assistants.slice(0, w.assistants);
      const when = daysAgo(week * 7 + (j % 5) + 1);
      batch.set(doc(collection(db, COL.workLogs)), {
        ...base,
        staffId: operator.id,
        staffName: operator.name,
        workType: w.workType,
        // Vary units week to week so charts are not flat.
        units: Math.max(1, Math.round(w.units * (0.8 + ((week * 7 + j) % 5) * 0.1))),
        workDate: Timestamp.fromDate(when),
        assistantIds: chosen.map((a) => a.id),
        assistantNames: chosen.map((a) => a.name),
        assistantCount: chosen.length,
      });
      written += 1;
    }
  }
  await batch.commit();

  // --- Projects, components, features -------------------------------------
  onProgress("Projects and estimates");
  batch = writeBatch(db);
  ops = 0;
  for (let i = 0; i < PROJECTS.length; i += 1) {
    const p = PROJECTS[i];
    const client = customerIds.filter((c) => true)[i % customerIds.length];
    const estimated = p.components.reduce((s, c) => s + toKobo(c.valueNaira), 0);

    const projRef = doc(collection(db, COL.projects));
    batch.set(projRef, {
      ...base,
      projectNumber: `PRJ-${year}-${pad(100 + i)}`,
      customerId: client.id,
      customerName: client.name,
      title: p.title,
      location: p.location,
      status: p.status,
      startDate: Timestamp.fromDate(daysAgo(50 - i * 8)),
      targetDate: Timestamp.fromDate(daysAgo(-20 + i * 5)),
      estimatedCostKobo: estimated,
      actualCostKobo: p.status === "completed" ? Math.round(estimated * 0.94) : 0,
      contractValueKobo: Math.round(estimated * 1.15),
    });
    ops += 1;

    for (let k = 0; k < p.components.length; k += 1) {
      const c = p.components[k];
      batch.set(doc(collection(db, `${COL.projects}/${projRef.id}/components`)), {
        ...base,
        name: c.name,
        category: c.category,
        status: p.status,
        order: k,
        estimatedCostKobo: toKobo(c.valueNaira),
      });
      ops += 1;
    }
    written += 1 + p.components.length;
    await commitIfFull();
  }
  await batch.commit();

  // --- Money ledgers ------------------------------------------------------
  onProgress("Expenses, loans and meters");
  batch = writeBatch(db);
  for (let week = 0; week < 6; week += 1) {
    for (let i = 0; i < EXPENSES.length; i += 1) {
      const e = EXPENSES[i];
      // Rent and servicing are monthly, not weekly.
      if ((e.category === "rent" || e.category === "maintenance") && week % 4 !== 0) continue;
      batch.set(doc(collection(db, COL.expenses)), {
        ...base,
        date: Timestamp.fromDate(daysAgo(week * 7 + i)),
        payeeType: e.payee === "Company" ? "company" : "vendor",
        payeeName: e.payee,
        purpose: e.purpose,
        category: e.category,
        amountKobo: toKobo(e.naira),
      });
      written += 1;
    }
  }

  for (let i = 0; i < 3; i += 1) {
    const s = staffIds[i + 2];
    const amount = toKobo([2000, 5000, 12000][i]);
    const settled = i === 0;
    batch.set(doc(collection(db, COL.loans)), {
      ...base,
      staffId: s.id,
      staffName: s.name,
      type: i === 2 ? "loan" : "advance",
      amountKobo: amount,
      purpose: i === 2 ? "School fees" : "Deposit salary",
      status: settled ? "settled" : "disbursed",
      requestedAt: Timestamp.fromDate(daysAgo(30 - i * 7)),
      disbursedAt: Timestamp.fromDate(daysAgo(29 - i * 7)),
      repaidKobo: settled ? amount : 0,
      outstandingKobo: settled ? 0 : amount,
      settledAt: settled ? Timestamp.fromDate(daysAgo(10)) : null,
    });
    written += 1;
  }

  let reading = 10.95;
  for (let week = 5; week >= 0; week -= 1) {
    const consumed = 4 + (week % 3) * 2.4;
    reading += consumed;
    batch.set(doc(collection(db, COL.meterReadings)), {
      ...base,
      meterName: "Shasan",
      date: Timestamp.fromDate(daysAgo(week * 7)),
      reading: Math.round(reading * 100) / 100,
      actualConsumed: Math.round(consumed * 100) / 100,
      ratePerUnitKobo: toKobo(13920),
      amountKobo: Math.round(consumed * toKobo(13920)),
    });
    written += 1;
  }
  await batch.commit();

  // --- Procurement and inventory ------------------------------------------
  onProgress("Suppliers, inventory and consumables");
  batch = writeBatch(db);
  const supplierIds: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    const ref = doc(collection(db, COL.suppliers));
    batch.set(ref, {
      ...base,
      name: s.name,
      categories: s.categories,
      active: true,
      phone: "0803 000 0000",
    });
    supplierIds[s.name] = ref.id;
    written += 1;
  }

  const brandIds: Record<string, string> = {};
  for (const name of ["Freud Blade", "Infrawood BLD"]) {
    const ref = doc(collection(db, COL.consumableBrands));
    batch.set(ref, { ...base, name, type: "blade", active: true });
    brandIds[name] = ref.id;
    written += 1;
  }

  for (let i = 0; i < CYCLES.length; i += 1) {
    const c = CYCLES[i];
    const start = daysAgo(45 - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + c.days);
    batch.set(doc(collection(db, COL.consumableCycles)), {
      ...base,
      type: "blade",
      model: c.brand,
      brandId: brandIds[c.brand],
      brandName: c.brand,
      supplierId: supplierIds[c.brand.startsWith("Freud") ? "Freud Nigeria" : "Infrawood Tools"],
      line: "both",
      startDate: Timestamp.fromDate(start),
      endDate: Timestamp.fromDate(end),
      lifespanDays: c.days,
      unitsProcessed: c.units,
      costKobo: toKobo(c.naira),
      retiredReason: c.reason,
    });
    written += 1;
  }

  for (const item of INVENTORY) {
    batch.set(doc(collection(db, COL.inventoryCompany)), {
      ...base,
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantityOnHand: item.onHand,
      reorderLevel: item.reorder,
      unitCostKobo: toKobo(item.naira),
      active: true,
    });
    written += 1;
  }

  for (let i = 0; i < 2; i += 1) {
    const s = staffIds[i];
    batch.set(doc(collection(db, COL.toolRequests)), {
      ...base,
      requestNumber: `TR-${year}-${pad(10 + i)}`,
      jobName: i === 0 ? "Yakubu kitchen install" : "Musa door hanging",
      jobLocation: i === 0 ? "Gwarinpa" : "Life Camp",
      requestedByStaffId: s.id,
      requestedByName: s.name,
      requestDate: Timestamp.fromDate(daysAgo(6 - i * 3)),
      expectedReturnDate: Timestamp.fromDate(daysAgo(i === 0 ? -1 : 2)),
      status: i === 0 ? "issued" : "returned",
      returnedDate: i === 1 ? Timestamp.fromDate(daysAgo(1)) : null,
    });
    written += 1;
  }
  await batch.commit();

  onProgress("Done");
  return { written };
}

/**
 * Removes every demo document.
 *
 * Deletes only where `isDemo == true`, so real records are untouchable by this
 * path. Subcollections under a deleted job would otherwise be orphaned, since
 * Firestore does not cascade, so job children are cleared explicitly.
 */
export async function clearDemoData(
  db: Firestore,
  onProgress: SeedProgress = () => {}
): Promise<{ deleted: number }> {
  let deleted = 0;

  // Job subcollections first, while the parents are still findable.
  onProgress("Job lines and payments");
  const jobSnap = await getDocs(
    query(collection(db, COL.serviceJobs), where(DEMO_FLAG, "==", true))
  );
  for (const jobDoc of jobSnap.docs) {
    for (const path of [jobLinesPath(jobDoc.id), jobPaymentsPath(jobDoc.id)]) {
      const kids = await getDocs(collection(db, path));
      if (kids.empty) continue;
      const b = writeBatch(db);
      kids.docs.forEach((k) => b.delete(k.ref));
      await b.commit();
      deleted += kids.size;
    }
  }

  // Project components.
  onProgress("Project components");
  const projSnap = await getDocs(
    query(collection(db, COL.projects), where(DEMO_FLAG, "==", true))
  );
  for (const p of projSnap.docs) {
    const kids = await getDocs(collection(db, `${COL.projects}/${p.id}/components`));
    if (kids.empty) continue;
    const b = writeBatch(db);
    kids.docs.forEach((k) => b.delete(k.ref));
    await b.commit();
    deleted += kids.size;
  }

  for (const name of DEMO_COLLECTIONS) {
    onProgress(name);
    const snap = await getDocs(query(collection(db, name), where(DEMO_FLAG, "==", true)));
    if (snap.empty) continue;

    // Chunked: a batch is limited to 500 operations.
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    deleted += snap.size;
  }

  onProgress("Done");
  return { deleted };
}

/** Counts demo documents, so the UI can show whether any exist. */
export async function countDemoData(db: Firestore): Promise<number> {
  const counts = await Promise.all(
    DEMO_COLLECTIONS.map((name) =>
      getDocs(query(collection(db, name), where(DEMO_FLAG, "==", true))).then((s) => s.size)
    )
  );
  return counts.reduce((a, b) => a + b, 0);
}
