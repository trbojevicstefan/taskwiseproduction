"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type Props = {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function MarketingSection({
  id,
  eyebrow,
  title,
  subtitle,
  children,
  className = "",
}: Props) {
  return (
    <section id={id} className={`mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 ${className}`.trim()}>
      {(eyebrow || title || subtitle) && (
        <div className="mb-8 max-w-3xl">
          {eyebrow && (
            <p className="mb-3 text-xs uppercase tracking-[0.35em] text-[#FFB36A]">
              {eyebrow}
            </p>
          )}
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.4 }}
            className="text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          >
            {title}
          </motion.h2>
          {subtitle && <p className="mt-4 text-base leading-7 text-white/70">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
