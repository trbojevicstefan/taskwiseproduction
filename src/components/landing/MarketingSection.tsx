import type { ReactNode } from "react";

export function MarketingSection({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 space-y-4">
        <div className="h-px w-24 bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97]" />
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {title}
        </h2>
        {subtitle ? <div className="max-w-3xl text-base leading-7 text-white/68">{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}
