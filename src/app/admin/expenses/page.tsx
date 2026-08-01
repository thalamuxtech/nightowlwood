import type { Metadata } from "next";
import { ExpensesScreen } from "@/components/admin/money/ExpensesScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Expenses",
  robots: { index: false, follow: false },
};

export default function ExpensesPage() {
  return (
    <RequireCapability capability="expense.view">
      <ExpensesScreen />
    </RequireCapability>
  );
}
