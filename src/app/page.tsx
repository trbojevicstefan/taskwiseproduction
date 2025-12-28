"use client";
// src/app/page.tsx

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Brain,
  MessageSquare,
  GitBranch,
  CalendarCheck,
  Upload,
  FileText,
  ChevronRight,
  Zap,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Logo } from "@/components/ui/logo";
import AnimatedTaskHero from "@/components/landing/AnimatedTaskHero";
import HeroParticles from "@/components/landing/HeroParticles";

const brandGradient =
  "bg-[radial-gradient(1200px_600px_at_10%_10%,rgba(255,86,48,0.25),transparent_60%),radial-gradient(1200px_600px_at_90%_20%,rgba(255,175,0,0.25),transparent_60%),radial-gradient(1200px_600px_at_50%_90%,rgba(255,0,128,0.25),transparent_60%)]";

const GradientText = ({ children }: { children: React.ReactNode }) => (
  <span className="bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
    {children}
  </span>
);

const Section = ({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: string | React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
    <div className="mb-8 flex flex-col items-start gap-3 sm:mb-10">
      <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="max-w-3xl text-base text-white/70">{subtitle}</p>
      )}
    </div>
    {children}
  </section>
);

function ExploreTabs() {
  return (
    <Tabs defaultValue="explore" className="w-full">
      <TabsList className="mb-6 grid w-full grid-cols-2 bg-white/10 text-white">
        <TabsTrigger value="explore">Explore</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="explore">
        <Card className="border-white/10 bg-white/5 backdrop-blur">
          <CardContent className="p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: FileText, title: "Themes", text: "AI groups key themes across your transcript." },
                { icon: Layers, title: "Clusters", text: "Ideas clustered by similarity and outcomes." },
                { icon: CalendarCheck, title: "Timeline", text: "Milestones auto-drafted with dates." },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-xl border border-white/10 bg-black/30 p-5">
                  <div className="mb-3 inline-flex rounded-lg bg-white/10 p-2">
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-white">
                    <h4 className="mb-1 font-medium">{title}</h4>
                    <p className="text-sm text-white/70">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="chat">
        <Card className="border-white/10 bg-white/5 backdrop-blur">
          <CardContent className="p-4 sm:p-6">
            <div className="grid gap-4 md:grid-cols-[1fr_280px]">
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white/90">
                <div className="mb-3 flex items-center gap-2 text-xs text-white/60">
                  <MessageSquare className="h-3.5 w-3.5" /> Chat with AI
                </div>
                <div className="mb-4 space-y-2 text-sm">
                  <p className="rounded-md bg-white/5 p-3">Summarize our brainstorm and draft the top 5 tasks.</p>
                  <p className="rounded-md bg-white/5 p-3">Also add deadlines for anything time-sensitive.</p>
                </div>
                <Input placeholder="Type a message..." className="border-white/10 bg-black/30 text-white placeholder:text-white/40" />
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white">
                <div className="mb-2 text-sm font-medium">Proposed Tasks</div>
                <ul className="space-y-2 text-sm text-white/90">
                  {[
                    "Record kickoff on Monday",
                    "Invite Legal to DPA review",
                    "Ship public beta by Jul 20",
                    "Draft investor follow-up deck",
                    "Create Q3 timeline",
                  ].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97]" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export default function TaskwiseAIPage() {
  const { setTheme } = useTheme();

  React.useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  return (
    <main className={`relative min-h-screen bg-[#0B0B0F] text-white font-body ${brandGradient}`}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
             <Logo size="md" />
            <Badge className="hidden sm:inline-flex bg-white/10 text-white">Beta</Badge>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#demo" className="hover:text-white">Live Demo</a>
            <a href="#integrations" className="hover:text-white">Integrations</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
          </nav>
          <div className="flex items-center gap-3">
            <Button variant="secondary" className="hidden sm:inline-flex bg-white/10 text-white hover:bg-white/20" asChild>
                <Link href="/login">Sign in</Link>
            </Button>
            <Button className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <HeroParticles className="-z-10" />
        <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(800px_400px_at_50%_-10%,rgba(255,255,255,0.12),transparent)]" />
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24 lg:px-8">
          <div className="text-center lg:text-left">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-4 text-4xl font-semibold leading-tight text-white sm:text-5xl"
            >
              Turn meetings into <GradientText>actionable plans</GradientText> in seconds
            </motion.h1>
            <p className="mb-6 max-w-xl mx-auto lg:mx-0 text-base text-white/70 sm:text-lg">
              TaskwiseAI breaks down transcripts, notes, or loose ideas into prioritized tasks, timelines, and action plans. Explore your work, plan visually, or chat with AI to extract what matters.
            </p>
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3">
              <Button size="lg" className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
                <Link href="/signup">Try it free</Link>
              </Button>
              <Button size="lg" variant="secondary" className="bg-white/10 text-white hover:bg-white/20">
                Watch demo <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
             <div className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-x-4 gap-y-2 text-sm text-white/60">
              <span className="inline-flex items-center gap-2"><Zap className="h-4 w-4" /> No credit card</span>
              <span className="inline-flex items-center gap-2"><Brain className="h-4 w-4" /> GPT-powered</span>
              <span className="inline-flex items-center gap-2"><GitBranch className="h-4 w-4" /> Clear dependencies</span>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative mt-8 lg:mt-0 perspective-container-hero overflow-hidden"
          >
            <AnimatedTaskHero />
          </motion.div>
        </div>
      </section>

      <Section
        id="features"
        title={<><GradientText>One inbox</GradientText> for your ideas</>}
        subtitle="Drop in recordings, transcripts, or raw notes. TaskwiseAI turns chaos into clarity."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Upload,
              title: "Ingest anything",
              text: "Audio, video, docs. Zoom, Meet, Teams imports and public links.",
            },
            {
              icon: Brain,
              title: "Breakdown with AI",
              text: "From themes to tasks to timelines with context and owners.",
            },
            {
              icon: GitBranch,
              title: "Plan & prioritize",
              text: "Explore views and AI chat help align on what ships first.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white backdrop-blur"
            >
              <div className="mb-4 inline-flex rounded-xl bg-white/10 p-3">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-1 text-lg font-medium">{title}</h3>
              <p className="text-sm text-white/70">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="demo" title={<><GradientText>Explore</GradientText> or just <GradientText>Chat</GradientText></>}>
        <ExploreTabs />
      </Section>

      <Section
        id="integrations"
        title={<><GradientText>Works with your stack</GradientText></>}
        subtitle="Sync tasks to Asana, Jira, Trello, Notion, Linear, and calendars. Import from Zoom, Google Meet, Teams; attach CRM context from HubSpot or Salesforce."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {["Zoom","Meet","Teams","Slack","Notion","Asana","Trello","Jira","Linear","Google Calendar","HubSpot","Salesforce"].map((name) => (
            <div key={name} className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/70 backdrop-blur">
              {name}
            </div>
          ))}
        </div>
      </Section>

      <Section id="pricing" title="Simple, fair pricing">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { tier: "Starter", price: "$0", blurb: "100 min / mo, basic export" },
            { tier: "Pro", price: "$19", blurb: "1,000 min / mo, integrations" },
            { tier: "Team", price: "$49", blurb: "Unlimited internal users, SSO" },
          ].map((p) => (
            <div key={p.tier} className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white backdrop-blur flex flex-col">
              <div className="mb-2 text-sm text-white/60">{p.tier}</div>
              <div className="mb-1 text-3xl font-semibold">{p.price}<span className="text-base font-normal text-white/60">/mo</span></div>
              <p className="mb-4 text-sm text-white/70">{p.blurb}</p>
              <ul className="mb-5 space-y-2 text-sm text-white/80">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/> AI task extraction</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/> Explore & Chat views</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/> Exports & integrations</li>
              </ul>
              <Button className="w-full mt-auto bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white">Choose {p.tier}</Button>
            </div>
          ))}
        </div>
      </Section>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-y-4 gap-x-6 px-4 py-8 sm:px-6 md:grid-cols-2 lg:px-8">
          <div className="flex items-center justify-center md:justify-start gap-3 text-white/80">
            <Logo size="sm" isIconOnly={true}/>
            <span className="text-sm">TaskwiseAI</span>
            <span className="text-white/40">(c) {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center justify-center md:justify-end gap-4">
            <Link href="/privacy" className="text-sm text-white/60 hover:text-white">Privacy</Link>
            <Link href="/terms" className="text-sm text-white/60 hover:text-white">Terms</Link>
            <Link href="/contact" className="text-sm text-white/60 hover:text-white">Contact</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
