import type { Metadata } from "next";
import { ExpensesScreen } from "@/components/admin/money/ExpensesScreen";

export const metadata: Metadata = {
  title: "Expenses",
  robots: { index: false, follow: false },
};

export default function ExpensesPage() {
  return <ExpensesScreen />;
}
