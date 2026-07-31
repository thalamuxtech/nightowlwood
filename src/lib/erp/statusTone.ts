import type { PillTone } from "@/components/admin/ui/StatusPill";
import type {
  EstimateStatus,
  InvoiceStatus,
  JobStatus,
  LoanStatus,
  ProjectStatus,
  Role,
  ToolRequestStatus,
  WageRunStatus,
} from "./enums";

/**
 * Maps each status enum to a pill tone, so the same state always reads the same
 * colour across every screen. Kept apart from the enums themselves to avoid
 * pulling presentation concerns into the domain model.
 */

export const JOB_STATUS_TONE: Record<JobStatus, PillTone> = {
  received: "neutral",
  in_progress: "progress",
  qc: "info",
  ready_for_pickup: "warn", // waiting on the customer, chase it
  collected: "positive",
  on_hold: "warn",
  cancelled: "danger",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, PillTone> = {
  enquiry: "neutral",
  estimating: "info",
  awaiting_approval: "warn",
  approved: "info",
  in_production: "progress",
  installing: "progress",
  completed: "positive",
  cancelled: "danger",
};

export const ESTIMATE_STATUS_TONE: Record<EstimateStatus, PillTone> = {
  draft: "neutral",
  in_review: "info",
  reviewed: "warn", // reviewer came back; admin needs to look
  approved: "positive",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, PillTone> = {
  draft: "neutral",
  sent: "info",
  partial: "warn",
  paid: "positive",
  void: "danger",
};

export const LOAN_STATUS_TONE: Record<LoanStatus, PillTone> = {
  requested: "warn", // awaiting an admin decision
  approved: "info",
  rejected: "danger",
  disbursed: "progress",
  repaying: "progress",
  settled: "positive",
};

export const WAGE_RUN_STATUS_TONE: Record<WageRunStatus, PillTone> = {
  draft: "neutral",
  approved: "info",
  paid: "positive",
};

export const TOOL_REQUEST_STATUS_TONE: Record<ToolRequestStatus, PillTone> = {
  requested: "warn",
  issued: "progress",
  partially_returned: "warn",
  returned: "positive",
  overdue: "danger",
};

export const ROLE_TONE: Record<Role, PillTone> = {
  admin: "danger", // highest privilege, visually distinct on purpose
  manager: "progress",
  operator: "info",
};
