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
  company: "company",
  invoice: "invoice",
} as const;

// ---------------------------------------------------------------------------
// Utilities / power
// ---------------------------------------------------------------------------

export interface MeterConfig {
  name: string;
  /** Cost per unit of the meter's own reading scale. Editable. */
  ratePerUnitKobo: number;
  active: boolean;
}

export interface UtilitySettings {
  meters: MeterConfig[];
}

/**
 * Back-computed from the `Meter` sheet: ₦87,556.80 ÷ 6.29 units ≈ ₦13,920/unit,
 * consistent across rows. Confirmed as the starting value, and editable since
 * tariffs change.
 */
export const DEFAULT_METER_RATE_NAIRA = 13_920;

export const DEFAULT_UTILITY_SETTINGS: UtilitySettings = {
  meters: [
    { name: "Shasan", ratePerUnitKobo: toKobo(DEFAULT_METER_RATE_NAIRA), active: true },
    { name: "Gadon Kaya", ratePerUnitKobo: toKobo(DEFAULT_METER_RATE_NAIRA), active: true },
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
  /** VAT etc. 0 until the business is registered to charge it. */
  taxPercent: number;
  taxLabel: string;
  /** Days from issue to due date. */
  paymentTermsDays: number;
  footerNote: string;
  /** Default error margin applied to product estimates. */
  defaultErrorMarginPercent: number;
  /** Default Nightowl charge (margin) on product estimates. */
  defaultNightowlChargePercent: number;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  taxPercent: 0,
  taxLabel: "VAT",
  paymentTermsDays: 14,
  footerNote: "Thank you for your business.",
  defaultErrorMarginPercent: 5,
  defaultNightowlChargePercent: 15,
};
