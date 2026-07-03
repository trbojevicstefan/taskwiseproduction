import type { Metadata } from "next";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import CleanupSuggestionsPageContent from "@/components/dashboard/review/CleanupSuggestionsPageContent";

export const metadata: Metadata = {
  title: "Cleanup Suggestions | TaskWiseAI",
  description:
    "Review low-value, duplicate, stale, and already-done tasks before they clutter your board.",
};

export default function CleanupSuggestionsPage() {
  return (
    <DashboardPageLayout>
      <CleanupSuggestionsPageContent />
    </DashboardPageLayout>
  );
}
