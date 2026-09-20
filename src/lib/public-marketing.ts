export const PUBLIC_SITE_URL = "https://www.taskwise.ai";

export type PublicProvider = {
  id: string;
  name: string;
  capability: string;
  description: string;
};

export type PublicFaq = {
  question: string;
  answer: string;
};

export type PublicUseCase = {
  slug: string;
  eyebrow: string;
  metaTitle: string;
  metaDescription: string;
  heroTitle: string;
  heroSubtitle: string;
  summary: string;
  steps: Array<{ title: string; body: string }>;
  faqs: PublicFaq[];
  ctaLabel: string;
  ctaHref: string;
  relatedSlugs: string[];
};

export const PUBLIC_MARKETING_PROVIDERS: PublicProvider[] = [
  {
    id: "fathom",
    name: "Fathom",
    capability: "Primary meeting source",
    description: "Bring completed Fathom meetings into Taskwise so transcripts, decisions, people, and reviewed tasks stay connected.",
  },
  {
    id: "fireflies",
    name: "Fireflies",
    capability: "Meeting import",
    description: "Turn Fireflies meeting records into searchable memory and an execution workflow instead of another transcript archive.",
  },
  {
    id: "grain",
    name: "Grain",
    capability: "Meeting import",
    description: "Keep Grain conversations attached to the tasks, owners, people, and follow-up work they create.",
  },
  {
    id: "tldv",
    name: "tl;dv",
    capability: "API + webhook",
    description: "Sync tl;dv meetings and receive meeting-ready events, then normalize them into the same Taskwise review and action flow.",
  },
  {
    id: "otter",
    name: "Otter.ai",
    capability: "Enterprise Public API",
    description: "Connect an eligible Otter workspace and move conversation context, transcripts, and action items into a reviewed execution layer.",
  },
  {
    id: "meetgeek",
    name: "MeetGeek",
    capability: "API + signed webhook",
    description: "Import MeetGeek meetings and use signed completion webhooks to route finished conversations into Taskwise.",
  },
  {
    id: "read",
    name: "Read AI",
    capability: "Webhook-first",
    description: "Send completed Read AI meeting reports to Taskwise through signed webhooks and turn them into grounded follow-through.",
  },
];

export const PUBLIC_SITE_ROUTES = [
  "/",
  "/features",
  "/integrations",
  "/mcp",
  "/docs",
  "/use-cases",
] as const;

export const PUBLIC_USE_CASES: PublicUseCase[] = [
  {
    slug: "ai-meeting-notes-to-tasks",
    eyebrow: "Meeting notes to execution",
    metaTitle: "AI Meeting Notes to Tasks | TaskwiseAI",
    metaDescription: "Turn meeting notes and transcripts into reviewed tasks with owners, due dates, evidence, priorities, and follow-up in TaskwiseAI.",
    heroTitle: "Turn AI meeting notes into tasks people actually finish",
    heroSubtitle: "Taskwise connects the conversation, evidence, task, owner, deadline, and follow-up instead of stopping at a meeting summary.",
    summary: "Meeting notes are useful only when commitments survive the handoff into real work. Taskwise ingests a supported meeting source, keeps transcript context searchable, proposes grounded action items for review, and carries accepted work into prioritization and execution.",
    steps: [
      { title: "Capture the meeting", body: "Connect a supported meeting source so the transcript and meeting metadata land in one normalized record." },
      { title: "Review the proposed work", body: "Inspect extracted tasks against transcript evidence, then keep, edit, assign, schedule, or dismiss them." },
      { title: "Move into execution", body: "Prioritize accepted tasks, clear noise with Swipe Sweep, and use automations for reliable follow-through." },
    ],
    faqs: [
      { question: "Does Taskwise automatically create tasks from meetings?", answer: "Taskwise can propose action items from meeting context, but the workflow is designed around review so people can confirm ownership, scope, and timing before work becomes authoritative." },
      { question: "Can I trace a task back to the meeting?", answer: "Yes. The product is built to keep execution grounded in the meeting record so a task can retain the context and evidence that created it." },
      { question: "Which meeting tools can feed Taskwise?", answer: "The current public meeting-source set includes Fathom, Fireflies, Grain, tl;dv, Otter.ai, MeetGeek, and Read AI, with provider-specific connection requirements." },
    ],
    ctaLabel: "Turn a meeting into work",
    ctaHref: "/signup",
    relatedSlugs: ["chat-with-meeting-transcripts", "ai-meeting-workflow-automation", "fathom-meeting-tasks"],
  },
  {
    slug: "chat-with-meeting-transcripts",
    eyebrow: "Meeting memory",
    metaTitle: "Chat With Meeting Transcripts | TaskwiseAI",
    metaDescription: "Ask grounded questions across meeting transcripts, recover decisions and commitments, and move answers into tasks and follow-up with TaskwiseAI.",
    heroTitle: "Chat with meeting transcripts without losing the path to action",
    heroSubtitle: "Ask what was decided, who committed to what, and what still needs follow-up while keeping the answer connected to execution.",
    summary: "A transcript archive becomes useful when you can interrogate it in the context of real work. Taskwise makes meeting history searchable and conversational so teams can recover decisions, commitments, people, and unresolved work without rereading entire calls.",
    steps: [
      { title: "Build meeting memory", body: "Completed meetings become searchable records with transcript context and participants." },
      { title: "Ask a grounded question", body: "Use transcript chat to recover what was said, decided, assigned, or left unresolved." },
      { title: "Continue the workflow", body: "Turn the relevant answer into reviewed execution instead of copying context into another disconnected tool." },
    ],
    faqs: [
      { question: "Can Taskwise answer questions about past meetings?", answer: "Yes. Transcript chat is designed for grounded questions about captured meeting history, including decisions, commitments, and follow-up context." },
      { question: "Is transcript chat separate from tasks?", answer: "No. The point of Taskwise is to connect meeting memory to the work that follows, so transcript context and execution can live in the same operating flow." },
      { question: "Can I use more than one meeting provider?", answer: "Taskwise has a normalized ingestion layer for multiple supported sources, so teams are not forced into a single recorder before they can organize meeting-driven work." },
    ],
    ctaLabel: "Build searchable meeting memory",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "mcp-for-meeting-memory", "fathom-meeting-tasks"],
  },
  {
    slug: "fathom-meeting-tasks",
    eyebrow: "Fathom + Taskwise",
    metaTitle: "Fathom Meeting Tasks & Follow-Up | TaskwiseAI",
    metaDescription: "Use Fathom as the meeting source and TaskwiseAI as the execution layer for transcript context, reviewed tasks, owners, priorities, and follow-up.",
    heroTitle: "Give Fathom meetings an execution layer after the recording ends",
    heroSubtitle: "Keep Fathom as your meeting source while Taskwise turns captured context into reviewed, prioritized, trackable work.",
    summary: "Fathom is Taskwise's primary meeting-source experience. Once a meeting arrives, Taskwise preserves the conversation as memory, helps surface proposed action items, and connects accepted work to people, planning, cleanup, and automation.",
    steps: [
      { title: "Connect Fathom", body: "Bring completed Fathom meetings into Taskwise through the supported integration path." },
      { title: "Review meeting-derived work", body: "Inspect proposed tasks with their meeting context before accepting or editing them." },
      { title: "Run the follow-through", body: "Assign, prioritize, schedule, share, and automate the accepted work from one execution layer." },
    ],
    faqs: [
      { question: "Does Taskwise replace Fathom?", answer: "No. Fathom can remain the meeting capture source; Taskwise is the layer that connects captured conversation to memory, task review, prioritization, and follow-up." },
      { question: "Can I search Fathom meeting context in Taskwise?", answer: "Imported meeting records are designed to stay available as searchable context so teams can revisit decisions and commitments after the call." },
      { question: "Why review tasks instead of silently creating them?", answer: "Meeting language is often ambiguous. Review helps keep ownership and deadlines accurate before proposed work becomes part of the authoritative task system." },
    ],
    ctaLabel: "Connect Fathom to execution",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "chat-with-meeting-transcripts", "ai-meeting-workflow-automation"],
  },
  {
    slug: "fireflies-to-task-board",
    eyebrow: "Fireflies + Taskwise",
    metaTitle: "Fireflies to Task Board Workflow | TaskwiseAI",
    metaDescription: "Move Fireflies meeting context into TaskwiseAI for searchable memory, reviewed action items, task ownership, prioritization, and follow-up.",
    heroTitle: "Move Fireflies meetings from transcript archive to task workflow",
    heroSubtitle: "Bring conversation context into Taskwise, review the work it implies, and keep accepted tasks tied to the meeting that created them.",
    summary: "Taskwise gives teams using Fireflies a place to continue after the transcript is captured. Meeting context can feed the same review, people, task, planning, and automation workflow used by the rest of Taskwise instead of becoming another isolated record.",
    steps: [
      { title: "Import Fireflies meetings", body: "Connect the Fireflies source and bring supported meeting data into Taskwise." },
      { title: "Review action items", body: "Use meeting context to confirm proposed tasks, owners, scope, and timing." },
      { title: "Organize the board", body: "Keep accepted work clean with prioritization and Swipe Sweep, then follow through with automations where appropriate." },
    ],
    faqs: [
      { question: "Can Fireflies meetings become tasks in Taskwise?", answer: "Yes. Fireflies is a supported meeting source and its captured context can feed Taskwise's reviewed task workflow." },
      { question: "Does Taskwise keep the meeting context after task extraction?", answer: "Yes. Taskwise is designed around preserving meeting memory so task follow-up does not discard the source conversation." },
      { question: "Can I use Fireflies alongside another recorder?", answer: "Taskwise supports multiple meeting sources through a normalized ingestion layer, subject to each provider's connection requirements." },
    ],
    ctaLabel: "Connect Fireflies",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "chat-with-meeting-transcripts", "ai-meeting-workflow-automation"],
  },
  {
    slug: "grain-to-task-board",
    eyebrow: "Grain + Taskwise",
    metaTitle: "Grain to Task Board Workflow | TaskwiseAI",
    metaDescription: "Connect Grain meetings to TaskwiseAI and turn conversation context into reviewed tasks, people context, prioritization, and dependable follow-through.",
    heroTitle: "Turn Grain conversations into organized follow-through",
    heroSubtitle: "Keep the value of the conversation after the clip or transcript by connecting meeting context to reviewed execution in Taskwise.",
    summary: "Teams using Grain can use Taskwise as the operating layer after a meeting. The conversation remains part of meeting memory while proposed work can be reviewed, connected to people, prioritized, scheduled, and carried into follow-up.",
    steps: [
      { title: "Connect Grain", body: "Import supported Grain meeting records into the same Taskwise meeting pipeline." },
      { title: "Confirm commitments", body: "Review meeting-derived action items against their source context before they become authoritative work." },
      { title: "Keep work moving", body: "Use Taskwise planning, cleanup, people context, and automation to carry the commitment forward." },
    ],
    faqs: [
      { question: "What happens after a Grain meeting reaches Taskwise?", answer: "Taskwise normalizes the meeting into its memory and execution model so teams can search context and review the work that follows." },
      { question: "Is Grain the only supported source?", answer: "No. Grain sits alongside Fathom, Fireflies, tl;dv, Otter.ai, MeetGeek, and Read AI in the current meeting-source set." },
      { question: "Can Taskwise help reduce a cluttered task board?", answer: "Yes. Swipe Sweep is designed to speed up cleanup decisions so low-value or stale work does not hide the tasks that still matter." },
    ],
    ctaLabel: "Connect Grain",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "ai-meeting-workflow-automation", "chat-with-meeting-transcripts"],
  },
  {
    slug: "tldv-to-task-board",
    eyebrow: "tl;dv + Taskwise",
    metaTitle: "tl;dv to Task Board Workflow | TaskwiseAI",
    metaDescription: "Connect tl;dv to TaskwiseAI through its API and meeting events, then review meeting-derived work and move it into execution.",
    heroTitle: "Turn tl;dv meetings into reviewed tasks and follow-up",
    heroSubtitle: "Sync completed meetings and meeting-ready events into the same Taskwise memory and execution workflow used by your team.",
    summary: "Taskwise supports tl;dv as an API and webhook meeting source. Instead of treating the transcript as the final artifact, Taskwise normalizes the meeting, keeps its context available, and routes proposed work through review before execution.",
    steps: [
      { title: "Connect the tl;dv source", body: "Add the supported tl;dv API connection and Taskwise webhook route for completed meeting events." },
      { title: "Normalize the meeting", body: "Transcript, participants, notes, and available meeting metadata enter the common Taskwise meeting model." },
      { title: "Review and execute", body: "Confirm proposed work, then assign, prioritize, schedule, share, or automate the accepted tasks." },
    ],
    faqs: [
      { question: "Does the tl;dv integration support syncing meetings?", answer: "Yes. The Taskwise adapter supports an API-key connection with manual/backfill sync and meeting-ready webhook events." },
      { question: "Does Taskwise invent a webhook signature for tl;dv?", answer: "No. Taskwise uses its unique webhook routing token for the current tl;dv flow rather than claiming a signature mechanism that the inspected provider contract does not expose." },
      { question: "Can tl;dv tasks join the same board as other meeting sources?", answer: "Yes. Supported meeting sources normalize into the same Taskwise execution model so downstream review and organization are consistent." },
    ],
    ctaLabel: "Connect tl;dv",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "ai-meeting-workflow-automation", "chat-with-meeting-transcripts"],
  },
  {
    slug: "otter-action-items",
    eyebrow: "Otter.ai + Taskwise",
    metaTitle: "Otter.ai Action Items to Execution | TaskwiseAI",
    metaDescription: "Connect an eligible Otter.ai workspace to TaskwiseAI and carry transcripts and action items into reviewed ownership, prioritization, and follow-up.",
    heroTitle: "Carry Otter.ai action items beyond the meeting summary",
    heroSubtitle: "For eligible Otter workspaces, Taskwise adds the review, organization, and follow-through layer between captured conversation and completed work.",
    summary: "Taskwise can connect to Otter's Public API for eligible Enterprise workspaces. Meeting context, transcript content, and available action-item data can enter Taskwise's normalized workflow, where people review the work before it becomes part of execution.",
    steps: [
      { title: "Connect an eligible workspace", body: "Use an Otter Public API key from a workspace with the required provider access." },
      { title: "Bring conversations into memory", body: "Taskwise imports supported conversation context and keeps it available for downstream review." },
      { title: "Turn context into follow-through", body: "Review tasks and action items, assign ownership, prioritize them, and continue execution in Taskwise." },
    ],
    faqs: [
      { question: "Does every Otter plan expose the Public API?", answer: "No. Taskwise's current Otter connection depends on Otter Public API access, which is documented for Enterprise workspaces." },
      { question: "Can Taskwise import Otter action-item context?", answer: "The adapter is built to normalize supported conversation data, including available action-item and transcript fields, into the Taskwise meeting workflow." },
      { question: "Does Otter replace Taskwise task management?", answer: "They serve different parts of the flow: Otter captures meeting intelligence while Taskwise focuses on reviewed memory-to-execution follow-through." },
    ],
    ctaLabel: "Connect Otter to Taskwise",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "chat-with-meeting-transcripts", "ai-meeting-workflow-automation"],
  },
  {
    slug: "meetgeek-task-workflow",
    eyebrow: "MeetGeek + Taskwise",
    metaTitle: "MeetGeek Task Workflow & Follow-Up | TaskwiseAI",
    metaDescription: "Bring MeetGeek meetings into TaskwiseAI through API sync and signed completion webhooks, then review tasks and manage follow-through.",
    heroTitle: "Turn MeetGeek meeting intelligence into an execution workflow",
    heroSubtitle: "Use API sync plus signed meeting completion events to carry finished conversations into Taskwise memory, review, and follow-through.",
    summary: "Taskwise supports MeetGeek through API access and signed webhooks. Finished meetings can enter the shared ingestion layer with transcript and participant context, then move through the same human-reviewed task flow as other supported meeting sources.",
    steps: [
      { title: "Connect the correct API region", body: "Add the MeetGeek API key for the workspace region and configure the Taskwise webhook destination." },
      { title: "Verify completed meeting events", body: "Taskwise verifies the signed webhook payload before routing the meeting into the tenant flow." },
      { title: "Review the resulting work", body: "Use transcript context to confirm tasks, then organize and automate accepted follow-up." },
    ],
    faqs: [
      { question: "Are MeetGeek webhooks verified?", answer: "Yes. The current adapter verifies the documented X-MG-Signature HMAC-SHA256 signature against the exact raw request body when a webhook secret is configured." },
      { question: "Does MeetGeek require region-specific API configuration?", answer: "MeetGeek API keys are region-specific, so the Taskwise setup guidance calls this out during connection." },
      { question: "Can I backfill MeetGeek meetings?", answer: "The adapter supports API-based meeting listing and sync in addition to webhook-driven completion events." },
    ],
    ctaLabel: "Connect MeetGeek",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "ai-meeting-workflow-automation", "chat-with-meeting-transcripts"],
  },
  {
    slug: "read-ai-to-task-workflow",
    eyebrow: "Read AI + Taskwise",
    metaTitle: "Read AI Reports to Task Workflow | TaskwiseAI",
    metaDescription: "Send completed Read AI meeting reports to TaskwiseAI through signed webhooks and move meeting context into reviewed tasks and follow-up.",
    heroTitle: "Turn completed Read AI reports into reviewed follow-through",
    heroSubtitle: "Taskwise uses a webhook-first Read AI connection today, verifying signed meeting-end reports before they enter the execution workflow.",
    summary: "The current Read AI path is intentionally webhook-first rather than pretending a durable static API-key flow exists. Signed meeting-end payloads can carry transcript, summary, participant, and action-item context into Taskwise for human-reviewed execution.",
    steps: [
      { title: "Create the Read AI webhook", body: "Point supported meeting-end events at the unique Taskwise webhook URL and store the signing key." },
      { title: "Verify and ingest the report", body: "Taskwise verifies X-Read-Signature before normalizing the completed meeting payload." },
      { title: "Review the follow-up", body: "Use the report and transcript context to confirm proposed work before moving it into planning and automation." },
    ],
    faqs: [
      { question: "Why is the Read AI integration webhook-first?", answer: "Read's current public REST API uses OAuth 2.1 with short-lived and rotating tokens, while the provider documentation does not offer a durable static public REST API key. Taskwise therefore exposes the reliable signed-webhook path in this release." },
      { question: "Does Taskwise verify Read AI webhook signatures?", answer: "Yes. The adapter verifies the documented X-Read-Signature using the configured signing key and exact raw body." },
      { question: "Can I press Sync now for Read AI?", answer: "No. The current Read AI integration is webhook-first, so manual sync is intentionally not presented as an available capability." },
    ],
    ctaLabel: "Set up Read AI follow-through",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "ai-meeting-workflow-automation", "chat-with-meeting-transcripts"],
  },
  {
    slug: "mcp-for-meeting-memory",
    eyebrow: "MCP + Taskwise",
    metaTitle: "MCP for Meeting Memory & Tasks | TaskwiseAI",
    metaDescription: "Use TaskwiseAI MCP tools to let compatible AI clients work with meeting memory and tasks through explicit, scoped operator controls.",
    heroTitle: "Give compatible AI clients scoped access to meeting memory and tasks",
    heroSubtitle: "Taskwise MCP exposes operator-controlled tools so AI workflows can work with the same meeting context and execution system your team reviews.",
    summary: "Taskwise's MCP surface is designed for controlled access to meeting memory and task workflows rather than a parallel shadow database. Compatible clients can use the capabilities you explicitly expose while Taskwise remains the system where people inspect and manage the resulting work.",
    steps: [
      { title: "Enable the MCP surface", body: "Use the Taskwise MCP setup flow and the credentials documented for your workspace." },
      { title: "Connect a compatible client", body: "Configure a client that supports the required MCP transport and authorize only the intended Taskwise capabilities." },
      { title: "Operate against shared context", body: "Let the client work with meeting memory and tasks while keeping human-visible execution inside Taskwise." },
    ],
    faqs: [
      { question: "What is Taskwise MCP for?", answer: "It is a controlled tool surface for compatible AI clients to work with Taskwise meeting memory and task context without inventing a separate integration for each agent." },
      { question: "Does Taskwise claim every AI client supports its MCP setup?", answer: "No. Compatibility depends on the client's MCP support and the Taskwise transport and authentication requirements documented for the workspace." },
      { question: "Does MCP bypass review and permissions?", answer: "It should not. The public positioning is operator-controlled access to scoped capabilities, not unrestricted autonomous access to every workspace action." },
    ],
    ctaLabel: "Explore Taskwise MCP",
    ctaHref: "/mcp",
    relatedSlugs: ["chat-with-meeting-transcripts", "ai-meeting-workflow-automation", "ai-meeting-notes-to-tasks"],
  },
  {
    slug: "ai-meeting-workflow-automation",
    eyebrow: "Meeting automation",
    metaTitle: "AI Meeting Workflow Automation | TaskwiseAI",
    metaDescription: "Automate follow-up after reviewed meeting tasks with TaskwiseAI while keeping meeting context, ownership, priorities, and operator controls connected.",
    heroTitle: "Automate the follow-up after people approve what matters",
    heroSubtitle: "Taskwise combines meeting context with an automation workspace so repeatable follow-through can start from reviewed work instead of raw AI guesses.",
    summary: "The useful moment for automation is after the system understands the meeting and a person has confirmed the commitment. Taskwise keeps the source conversation attached, lets teams review proposed work, and gives accepted tasks a path into repeatable automation and downstream execution.",
    steps: [
      { title: "Capture the commitment", body: "A supported meeting source brings the conversation and its context into Taskwise." },
      { title: "Approve the work", body: "Review proposed tasks, ownership, and timing before they become the trigger for follow-through." },
      { title: "Automate repeatable steps", body: "Use the Automations workspace and connected execution surfaces for the work that should happen consistently." },
    ],
    faqs: [
      { question: "Does Taskwise automate directly from unreviewed transcript guesses?", answer: "The product direction is reviewed execution: meeting-derived work can be proposed by AI, but teams retain a confirmation step before authoritative follow-through." },
      { question: "Can automation use tasks from different meeting providers?", answer: "Supported providers normalize into the same meeting-to-execution model, allowing downstream workflows to operate on a consistent task shape." },
      { question: "How does Swipe Sweep fit into automation?", answer: "Swipe Sweep helps clear stale or low-value work quickly, reducing the chance that automation and planning spend attention on a cluttered backlog." },
    ],
    ctaLabel: "Build a meeting workflow",
    ctaHref: "/signup",
    relatedSlugs: ["ai-meeting-notes-to-tasks", "mcp-for-meeting-memory", "chat-with-meeting-transcripts"],
  },
];

export function getPublicUseCase(slug: string) {
  return PUBLIC_USE_CASES.find((item) => item.slug === slug);
}

export function getPublicSitemapPaths() {
  return Array.from(
    new Set<string>([
      ...PUBLIC_SITE_ROUTES,
      ...PUBLIC_USE_CASES.map((item) => `/use-cases/${item.slug}`),
    ])
  );
}
