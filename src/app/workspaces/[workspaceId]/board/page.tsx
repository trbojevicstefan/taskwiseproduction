import type { Metadata } from "next";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import BoardPageContent from "@/components/dashboard/board/BoardPageContent";

export const metadata: Metadata = {
  title: "Board | TaskWiseAI",
  description: "Plan and track tasks with a flexible workspace board.",
};

export default async function WorkspaceBoardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <DashboardPageLayout>
      <BoardPageContent workspaceId={workspaceId} />
    </DashboardPageLayout>
  );
}
