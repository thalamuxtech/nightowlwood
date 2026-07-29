import type { Metadata } from "next";
import { Suspense } from "react";
import { EstimateReview } from "@/components/site/EstimateReview";

export const metadata: Metadata = {
  title: "Estimate review",
  // Never indexed: the page is only reachable with a token, and a search engine
  // following a shared link would be an unnecessary disclosure.
  robots: { index: false, follow: false },
};

export default function EstimateReviewPage() {
  return (
    <Suspense fallback={null}>
      <EstimateReview />
    </Suspense>
  );
}
