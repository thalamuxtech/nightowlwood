import type { Timestamp } from "firebase/firestore";

export type InquiryStatus = "new" | "contacted" | "scheduled" | "closed";

export interface Inquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  projectType: string;
  budget: string;
  message: string;
  status: InquiryStatus;
  createdAt: Timestamp | null;
}

export interface PortfolioItem {
  id: string;
  title: string;
  category: string;
  description: string;
  imageUrl: string;
  order: number;
  published: boolean;
  featured: boolean;
}

export interface SiteSettings {
  contactEmail: string;
  contactPhone: string;
  instagram: string;
  facebook: string;
  announcement: string;
}
