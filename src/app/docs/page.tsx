import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  Bot,
  ClipboardCheck,
  KanbanSquare,
  MessagesSquare,
  PlugZap,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Meeting Workflow Documentation",
  description:
    "Learn how to connect meeting sources, chat with transcripts, review AI-proposed tasks, use Swipe Sweep, organize execution, and configure TaskwiseAI automations and MCP.",
  alternates: { canonical: "/docs" },
};

const USER_DOCS = [
  {
    title: "Create tasks from a meeting",
    description: "Paste notes, try sample data, or connect a supported meeting source.",
    href: "/docs#create-tasks",
    icon: Video,
  },
  {
    title: "Chat with meeting transcripts",
    description: "Recover decisions, commitments, people, and unresolved work from captured meeting context.",
    href: "/use-cases/chat-with-meeting-transcripts",
    icon: MessagesSquare,
  },
  {
    title: "Review and approve tasks",
    description: "Confirm evidence, owners, dates, priority, and status before relying on AI-proposed work.",
    href: "/docs#review-tasks",
    icon: ClipboardCheck,
  },
  {
    title: "Connect meeting sources",
    description: "Set up Fathom, Fireflies, Grain, tl;dv, Otter.ai, MeetGeek, or Read AI.",
    href: "/integrations",
    icon: PlugZap,
  },
  {
    title: "Clean the board with Swipe Sweep",
    description: "Move through stale or noisy work quickly so the board keeps the tasks that still matter.",
    href: "/docs#use-board",
    icon: Wand2,
  },
  {
    title: "Automate follow-through",
    description: "Use reviewed meeting work as the foundation for repeatable downstream execution.",
    href: "/use-cases/ai-meeting-workflow-automation",
    icon: Sparkles,
  },
  {
    title: "Use the board and planning views",
    description: "Track committed work by owner, due date, priority, status, calendar context, people, and clients.",
    href: "/docs#use-board",
    icon: KanbanSquare,
  },
  {
    title: "Connect compatible AI clients with MCP",
    description: "Use scoped Taskwise operator controls for approved meeting-memory and task workflows.",
    href: "/mcp",
    icon: Bot,
  },
];

export default function DocsIndexPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/">
            <Logo size="md" />
          </Link>
          <Link href="/meetings" className="text-sm text-muted-foreground hover:text-foreground">
            Open app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <section className="space-y-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            Documentation
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Taskwise help</h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            Start with the job you need to do: capture a meeting, recover context, review proposed
            work, clean the board, plan execution, or connect an operator workflow.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {USER_DOCS.map(({ title, description, href, icon: Icon }) => (
            <Link
              key={title}
              href={href}
              className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40"
            >
              <Icon className="mb-3 h-5 w-5 text-primary" />
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </Link>
          ))}
        </section>

        <section id="create-tasks" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Create tasks from a meeting</h2>
          <p className="text-sm text-muted-foreground">
            Open Home or Review Tasks, paste notes, connect a supported meeting source, or try sample
            data. Taskwise keeps the meeting context attached while it proposes work for review.
          </p>
        </section>

        <section id="review-tasks" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Review and approve tasks</h2>
          <p className="text-sm text-muted-foreground">
            Use Review Tasks to inspect meetings grouped by review state. Confirm task fields and
            ownership before treating AI-proposed output as authoritative work.
          </p>
        </section>

        <section id="connect-fathom" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Connect a meeting source</h2>
          <p className="text-sm text-muted-foreground">
            Open Settings {"->"} Integrations and choose the provider your team uses. Fathom is the
            primary meeting-source experience; Fireflies, Grain, tl;dv, Otter.ai, MeetGeek, and Read
            AI have provider-specific connection requirements documented on the integrations page.
          </p>
        </section>

        <section id="use-board" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Keep the execution board useful</h2>
          <p className="text-sm text-muted-foreground">
            Track reviewed tasks by status, owner, due date, and priority. Use Swipe Sweep to move
            through backlog noise quickly, then carry the work into planning and automation.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <h2 className="text-xl font-semibold">Advanced operator workflows</h2>
          <p className="text-sm text-muted-foreground">
            Workflow Builder, webhook replay, MCP keys, audit visibility, and operator runbooks live
            under advanced surfaces so normal meeting-to-execution work stays uncluttered.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/docs/mcp" className="text-sm font-medium text-primary hover:underline">
              Open MCP API docs
            </Link>
            <Link href="/use-cases" className="text-sm font-medium text-primary hover:underline">
              Explore workflow guides
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
