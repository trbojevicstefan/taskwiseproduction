import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ClipboardCheck, KanbanSquare, PlugZap, Video } from "lucide-react";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "TaskWiseAI Docs",
  description: "TaskWiseAI user and advanced operator documentation.",
};

const USER_DOCS = [
  {
    title: "Create tasks from a meeting",
    description: "Paste notes, try sample data, or connect a meeting source.",
    href: "/docs#create-tasks",
    icon: Video,
  },
  {
    title: "Review and approve tasks",
    description: "Use the Review Tasks queue to edit owners, dates, priority, and status.",
    href: "/docs#review-tasks",
    icon: ClipboardCheck,
  },
  {
    title: "Connect Fathom",
    description: "Set up the primary meeting-source integration.",
    href: "/docs#connect-fathom",
    icon: PlugZap,
  },
  {
    title: "Use the board",
    description: "Track committed tasks by owner, due date, priority, and status.",
    href: "/docs#use-board",
    icon: KanbanSquare,
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
            Start with the meeting-to-task workflow. Advanced operator docs are separated below.
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
            Open Home or Review Tasks, choose Paste notes, Connect Fathom, or Try sample, then
            review the generated task list.
          </p>
        </section>

        <section id="review-tasks" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Review and approve tasks</h2>
          <p className="text-sm text-muted-foreground">
            Use Review Tasks to inspect meetings grouped by Needs review, Processing, Failed, and
            Reviewed. Edit task fields before relying on AI output.
          </p>
        </section>

        <section id="connect-fathom" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Connect Fathom</h2>
          <p className="text-sm text-muted-foreground">
            Open Settings {"->"} Integrations, connect Fathom, then sync meetings into the review queue.
            Admins can manage connection details from the Fathom card.
          </p>
        </section>

        <section id="use-board" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Use the board</h2>
          <p className="text-sm text-muted-foreground">
            The Board tracks workspace tasks by status. If workspace context is not ready, the board
            shows a recovery screen instead of opening an invalid workspace route.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
          <h2 className="text-xl font-semibold">Advanced</h2>
          <p className="text-sm text-muted-foreground">
            Workflow Builder, webhook replay, MCP keys, audit logs, and operator runbooks live under
            Settings {"->"} Advanced.
          </p>
          <Link href="/docs/mcp" className="text-sm font-medium text-primary hover:underline">
            Open MCP API docs
          </Link>
        </section>
      </main>
    </div>
  );
}
