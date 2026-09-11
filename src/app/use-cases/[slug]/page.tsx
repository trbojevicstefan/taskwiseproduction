import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { StructuredData } from "@/components/landing/StructuredData";
import {
  getPublicUseCase,
  PUBLIC_SITE_URL,
  PUBLIC_USE_CASES,
} from "@/lib/public-marketing";

type UseCasePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return PUBLIC_USE_CASES.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: UseCasePageProps): Promise<Metadata> {
  const { slug } = await params;
  const item = getPublicUseCase(slug);

  if (!item) {
    return {};
  }

  return {
    title: item.metaTitle.replace(" | TaskwiseAI", ""),
    description: item.metaDescription,
    alternates: { canonical: `/use-cases/${item.slug}` },
    openGraph: {
      title: item.metaTitle,
      description: item.metaDescription,
      url: `${PUBLIC_SITE_URL}/use-cases/${item.slug}`,
      type: "website",
    },
  };
}

export default async function UseCasePage({ params }: UseCasePageProps) {
  const { slug } = await params;
  const item = getPublicUseCase(slug);

  if (!item) {
    notFound();
  }

  const related = item.relatedSlugs
    .map((relatedSlug) => getPublicUseCase(relatedSlug))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const pageUrl = `${PUBLIC_SITE_URL}/use-cases/${item.slug}`;

  return (
    <MarketingPageShell>
      <StructuredData
        data={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: item.metaTitle,
            description: item.metaDescription,
            url: pageUrl,
            isPartOf: { "@type": "WebSite", name: "TaskwiseAI", url: PUBLIC_SITE_URL },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: item.faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: PUBLIC_SITE_URL },
              {
                "@type": "ListItem",
                position: 2,
                name: "Use cases",
                item: `${PUBLIC_SITE_URL}/use-cases`,
              },
              { "@type": "ListItem", position: 3, name: item.heroTitle, item: pageUrl },
            ],
          },
        ]}
      />

      <PanoramicHero
        label={item.eyebrow}
        title={item.heroTitle}
        subtitle={item.heroSubtitle}
        primaryHref={item.ctaHref}
        primaryLabel={item.ctaLabel}
        secondaryHref="/use-cases"
        secondaryLabel="All use cases"
      />

      <MarketingSection
        id="overview"
        title={
          <>
            From conversation to{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">
              useful work
            </span>
          </>
        }
        subtitle={item.summary}
      >
        <div className="grid gap-4 md:grid-cols-3">
          {item.steps.map((step, index) => (
            <div
              key={step.title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
            >
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">Step {index + 1}</p>
              <h2 className="mt-3 text-xl font-medium text-white">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{step.body}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        id="faq"
        title={
          <>
            Questions, answered{" "}
            <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">
              clearly
            </span>
          </>
        }
        subtitle="Short answers to the details that matter before this workflow becomes part of your operating system."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {item.faqs.map((faq) => (
            <div key={faq.question} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-lg font-medium text-white">{faq.question}</h2>
              <p className="mt-3 text-sm leading-6 text-white/68">{faq.answer}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        id="related"
        title="Related workflows"
        subtitle="Keep exploring the same meeting-memory-to-execution system from a different starting point."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {related.map((relatedItem) => (
            <Link
              key={relatedItem.slug}
              href={`/use-cases/${relatedItem.slug}`}
              className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-colors hover:bg-white/[0.07]"
            >
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">{relatedItem.eyebrow}</p>
              <h2 className="mt-3 text-lg font-medium text-white">{relatedItem.heroTitle}</h2>
              <span className="mt-4 inline-flex items-center gap-2 text-sm text-white/75">
                Read more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button
            size="lg"
            className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
            asChild
          >
            <Link href={item.ctaHref}>{item.ctaLabel}</Link>
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
            asChild
          >
            <Link href="/integrations">View integrations</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
