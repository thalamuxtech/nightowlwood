import type { Timestamp } from "firebase/firestore";

export type RecordStatus = "new" | "contacted" | "scheduled" | "closed";
export type InquiryStatus = RecordStatus;

export interface Inquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  projectType: string;
  budget: string;
  message: string;
  status: RecordStatus;
  createdAt: Timestamp | null;
}

export interface InternApplication {
  id: string;
  name: string;
  email: string;
  phone?: string;
  area: string;
  background: string;
  portfolio?: string;
  message: string;
  status: RecordStatus;
  createdAt: Timestamp | null;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: RecordStatus;
  createdAt: Timestamp | null;
}

export interface Subscriber {
  id: string;
  email: string;
  createdAt: Timestamp | null;
}

export interface Post {
  id: string; // slug
  title: string;
  excerpt: string;
  contentMd: string;
  images: string[];
  published: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
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
