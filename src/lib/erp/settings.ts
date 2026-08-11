import { DEFAULT_BOARD_CE_RATES, type BoardType, type TaxMode } from "./enums";
import { toKobo } from "./money";

/**
 * Editable operational settings.
 *
 * Everything here was a hardcoded or back-computed constant in the legacy
 * spreadsheets. Each value is seeded from the observed data, stored in
 * `settings/{id}`, and editable by an admin, nothing in the app reads these
 * defaults once a document exists.
 */

/** Settings document ids. */
export const SETTINGS_DOC = {
  utility: "utility",
  serviceRateCard: "serviceRateCard",
  /** Cutting & edging price per board, by material. */
  boardRateCard: "boardRateCard",
  /** Work types added or hidden by the workshop. */
  wageWorkTypes: "wageWorkTypes",
  company: "company",
  invoice: "invoice",
  pos: "pos",
  hr: "hr",
} as const;

// ---------------------------------------------------------------------------
// Utilities / power
// ---------------------------------------------------------------------------

export interface MeterConfig {
  name: string;
  /** Cost per *billed* unit — after the conversion factor is applied. Editable. */
  ratePerUnitKobo: number;
  /**
   * Whether the dial reading has to be multiplied up to reach billable units.
   *
   * Some meters here read in a unit that needs scaling by 60 before the tariff
   * applies; others read directly in the billed unit. It is a per-meter fact, not
   * a system-wide one, so both can be recorded correctly at the same time.
   */
  useConversion?: boolean;
  /** The multiplier, when `useConversion` is on. */
  conversionFactor?: number;
  /**
   * The reading to measure the very first entry against.
   *
   * Without this the first reading on a meter has nothing to subtract from, so it
   * is recorded as zero consumption and that period's power simply is not billed.
   * Setting the dial value as at installation — or as at the day the workshop
   * started recording — makes the first entry chargeable like any other.
   */
  openingReading?: number;
  active: boolean;
}

export interface UtilitySettings {
  meters: MeterConfig[];
}

/**
 * The tariff per *billed* unit.
 *
 * ₦232 is Shasan's confirmed rate. It reconciles with the record book: ₦87,556.80 for 6.29
 * dial units is ₦13,920 per dial unit, and 13,920 ÷ 60 = 232 — so the sheet's figure and
 * this one describe the same money, one per dial unit and one per converted unit. That is
 * why the rate is defined per billed unit and the ×60 is applied to consumption rather than
 * folded into the rate: the two can never disagree about the same bill.
 */
export const DEFAULT_METER_RATE_NAIRA = 232;

/** The multiplier both meters need. */
export const DEFAULT_METER_CONVERSION_FACTOR = 60;

/**
 * The two meters, each with its own tariff.
 *
 * Independent by design — the whole point of per-meter config. Gadon Kaya is on ₦230 and
 * Shasan on ₦232, and both require the ×60 conversion. A single shared rate would have
 * mispriced one of them on every reading.
 *
 * `openingReading` is deliberately left unset: nobody but the workshop knows what the dials
 * read when recording began, and guessing would either bill for power used before the system
 * existed or leave the first period free. The meters screen says so, and Settings is where it
 * is entered once.
 */
export const DEFAULT_UTILITY_SETTINGS: UtilitySettings = {
  meters: [
    {
      name: "Gadon Kaya",
      ratePerUnitKobo: toKobo(230),
      useConversion: true,
      conversionFactor: DEFAULT_METER_CONVERSION_FACTOR,
      active: true,
    },
    {
      name: "Shasan",
      ratePerUnitKobo: toKobo(232),
      useConversion: true,
      conversionFactor: DEFAULT_METER_CONVERSION_FACTOR,
      active: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Service rate card
// ---------------------------------------------------------------------------

export interface ServiceRateCardEntry {
  serviceType: string;
  /** Suggested price, pre-filled on a new job line. Always overridable. */
  defaultPriceKobo: number;
  /** Observed spread in the historical data, shown as guidance in the UI. */
  observedRange?: { minKobo: number; maxKobo: number };
  note?: string;
}

export interface ServiceRateCardSettings {
  /**
   * When true the rate card pre-fills the price on a new line; the operator can
   * still type over it. When false, prices are always entered by hand.
   */
  autofillEnabled: boolean;
  entries: ServiceRateCardEntry[];
}

/**
 * Seeded from the modal (most frequent) prices in the `C & E` sheet, with the
 * observed spread kept for context, C/E ran ₦2,000 / ₦2,300 / ₦3,000 across
 * 363 jobs, so a single "correct" price doesn't exist and the card is a
 * starting point, not a rule.
 */
export const DEFAULT_SERVICE_RATE_CARD: ServiceRateCardSettings = {
  autofillEnabled: true,
  entries: [
    {
      serviceType: "cutting_edging",
      defaultPriceKobo: toKobo(2000),
      observedRange: { minKobo: toKobo(2000), maxKobo: toKobo(3000) },
      note: "Most common ₦2,000; also ₦2,300 and ₦3,000 seen.",
    },
    {
      serviceType: "only_cutting",
      defaultPriceKobo: toKobo(1000),
      observedRange: { minKobo: toKobo(1000), maxKobo: toKobo(1500) },
    },
    {
      serviceType: "door",
      defaultPriceKobo: toKobo(10000),
      observedRange: { minKobo: toKobo(10000), maxKobo: toKobo(13000) },
    },
    {
      serviceType: "double_door",
      defaultPriceKobo: toKobo(18000),
      note: "Observed at ₦18,000.",
    },
    { serviceType: "glass_door", defaultPriceKobo: toKobo(12000) },
    {
      serviceType: "frame",
      defaultPriceKobo: toKobo(3300),
      observedRange: { minKobo: toKobo(3300), maxKobo: toKobo(4500) },
    },
    { serviceType: "special_frame", defaultPriceKobo: toKobo(8000) },
    {
      serviceType: "grooving",
      defaultPriceKobo: toKobo(5000),
      observedRange: { minKobo: toKobo(1000), maxKobo: toKobo(8000) },
      note: "Wide spread, depends on run length.",
    },
    {
      serviceType: "glass",
      defaultPriceKobo: toKobo(3000),
      observedRange: { minKobo: toKobo(3000), maxKobo: toKobo(5000) },
    },
    { serviceType: "gyara", defaultPriceKobo: 0, note: "Rework, priced case by case." },
    { serviceType: "special_board", defaultPriceKobo: toKobo(4000) },
    { serviceType: "mortise", defaultPriceKobo: toKobo(2000) },
  ],
};

// ---------------------------------------------------------------------------
// Piece-rate work types
// ---------------------------------------------------------------------------

export interface WageWorkTypeSettings {
  /**
   * Work types added by the workshop, beyond the built-in list.
   *
   * `WAGE_WORK_TYPES` covers what the legacy sheets recorded, but new kinds of work turn
   * up — a new machine, a new service — and previously adding one meant editing code and
   * redeploying. A custom type is just an id and a label; everything downstream (rates,
   * work logs, wage runs) treats it exactly like a built-in one.
   */
  custom: Array<{ id: string; label: string }>;
  /**
   * Built-in types the workshop does not use, hidden from the pickers.
   *
   * Hidden rather than deleted, because a work log or a wage run from last year still
   * references the type and has to keep rendering its label. Removing the vocabulary
   * entry would leave those rows showing a raw id.
   */
  hidden: string[];
}

export const DEFAULT_WAGE_WORK_TYPE_SETTINGS: WageWorkTypeSettings = {
  custom: [],
  hidden: [],
};

// ---------------------------------------------------------------------------
// Cutting & edging, by board
// ---------------------------------------------------------------------------

export interface BoardRateCardSettings {
  /**
   * Cutting & edging price per board, keyed by board type.
   *
   * One rate card, read by both the service job's C&E line and the project estimate's
   * locked cutting item. That sharing is the point: the estimate is meant to charge
   * whatever the Services rate card says, and a second copy of these figures would let
   * the two disagree about the same job.
   */
  ratesKobo: Partial<Record<BoardType, number>>;
  /**
   * Whether the estimate's cutting line may be overridden by hand.
   *
   * False by design. The line exists precisely so that C&E is priced from one place, and
   * a hand-typed figure on the estimate is how the estimate and the job stop agreeing.
   * Exposed as a setting rather than hardcoded because an unusual job may genuinely need
   * it, and an admin who turns it on has made that decision deliberately.
   */
  allowManualOverride: boolean;
}

export const DEFAULT_BOARD_RATE_CARD: BoardRateCardSettings = {
  ratesKobo: Object.fromEntries(
    Object.entries(DEFAULT_BOARD_CE_RATES).map(([k, naira]) => [k, toKobo(naira as number)])
  ) as Partial<Record<BoardType, number>>,
  allowManualOverride: false,
};

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export interface HrSettings {
  /**
   * Working days in a month, for pro-rating a salaried absence.
   *
   * Six-day week. A day's pay is the monthly figure over this, which is what a no-show
   * deduction computes from — see `dayRateKobo` in hr.ts.
   */
  workingDaysPerMonth: number;
  /** Text under the signature on an appointment letter. */
  letterSignatoryName: string;
  letterSignatoryTitle: string;
  /** Printed on the ID card, so a finder knows where to return it. */
  idCardReturnNote: string;
  /** How long an ID card is valid, in months, from its issue date. */
  idCardValidMonths: number;
}

export const DEFAULT_HR_SETTINGS: HrSettings = {
  workingDaysPerMonth: 26,
  letterSignatoryName: "",
  letterSignatoryTitle: "Managing Director",
  idCardReturnNote:
    "If found, please return to Nightowl Woodworks Ltd at the address above.",
  idCardValidMonths: 24,
};

// ---------------------------------------------------------------------------
// Company / invoice
// ---------------------------------------------------------------------------

export interface CompanySettings {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  altPhone?: string;
  email: string;
  website: string;
  rcNumber?: string;
  tin?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  name: "Nightowl Woodworks Ltd",
  tagline: "Precision in Every Cut",
  address: "",
  phone: "",
  email: "info@nightowl.com.ng",
  website: "nightowl.com.ng",
};

export interface InvoiceSettings {
  /**
   * Whether tax is charged at all and, if so, how.
   *
   * `none` is the default because the business is not registered to charge VAT
   * until it is, and an invoice that shows a tax line it should not is a worse
   * failure than one that shows none. Setting a rate does not by itself start
   * charging: the mode is what does, so a rate can be configured ahead of time.
   */
  taxMode: TaxMode;
  /** The rate, applied per `taxMode`. */
  taxPercent: number;
  taxLabel: string;
  /** Days from issue to due date. */
  paymentTermsDays: number;
  footerNote: string;
  /** Default error margin applied to product estimates. */
  defaultErrorMarginPercent: number;
  /** Default Nightowl charge (margin) on product estimates. */
  defaultNightowlChargePercent: number;
  /**
   * Default agent commission, as a percentage of the invoice total.
   *
   * Zero by default: most work comes direct, and a commission that appears on
   * every invoice because it was set once is money leaking out of the profit
   * figure. It is applied per invoice, and this is only the pre-filled value.
   */
  defaultCommissionPercent: number;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  taxMode: "none",
  taxPercent: 7.5,
  taxLabel: "VAT",
  paymentTermsDays: 14,
  footerNote: "Thank you for your business.",
  defaultErrorMarginPercent: 5,
  defaultNightowlChargePercent: 15,
  defaultCommissionPercent: 0,
};

// ---------------------------------------------------------------------------
// Counter sales
// ---------------------------------------------------------------------------

export interface PosSettings {
  taxMode: TaxMode;
  taxPercent: number;
  taxLabel: string;
  /**
   * Whether a sale may take stock below zero.
   *
   * False by default, because a negative board count is never true — it means the
   * count was already wrong, and letting the sale through hides that. Blocking it
   * puts the discrepancy in front of whoever is standing at the counter, which is
   * the only moment anyone can still go and look at the stack.
   */
  allowNegativeStock: boolean;
  /** Printed under the total on a receipt. */
  receiptFooter: string;
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  taxMode: "none",
  taxPercent: 7.5,
  taxLabel: "VAT",
  allowNegativeStock: false,
  receiptFooter: "Goods sold are not returnable after 48 hours.",
};
