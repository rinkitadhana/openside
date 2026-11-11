import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";

import MarketingLayout, {
  SectionDivider,
} from "@/components/landing/MarketingLayout";
import {
  FaqSection,
  PageHero,
  PricingSection,
  Section,
  SectionHeading,
} from "@/components/landing/sections";

const PLAN_NAMES = ["Demo", "Pro", "Self-host"] as const;

// One row per capability; `true`/`false` render as a check or a dash.
const comparisonRows: { label: string; values: (ReactNode | boolean)[] }[] = [
  { label: "Price", values: ["Free", "$8.99/mo", "Free"] },
  { label: "Video quality", values: ["720p", "Up to 4K", "Up to 4K"] },
  { label: "Audio quality", values: ["44.1kHz", "48kHz", "48kHz"] },
  {
    label: "Recording time",
    values: ["15 minutes", "20 hours per month", "Unlimited"],
  },
  { label: "Participants", values: ["Up to 2", "Up to 5", "Unlimited"] },
  { label: "Retention", values: ["48 hours", "30 days", "Unlimited"] },
  { label: "No watermark", values: [false, true, true] },
  { label: "Separate participant tracks", values: [true, true, true] },
  { label: "Screen recorder", values: [true, true, true] },
  { label: "Cloud backup", values: [false, true, true] },
  {
    label: "Setup",
    values: [
      <span className="text-green-500">None</span>,
      <span className="text-green-500">None</span>,
      <span className="text-red-400">Your LiveKit and R2 keys</span>,
    ],
  },
];

const pricingFaqs = [
  {
    question: "Is there a free plan?",
    answer:
      "Yes. The Demo plan is free and needs no setup. It includes 15 minutes of recording at 720p with up to 2 participants, recordings are kept for 48 hours, and they include a watermark.",
  },
  {
    question: "What does Pro include?",
    answer:
      "Pro is $8.99 a month and runs on our managed infrastructure. You get up to 4K video, 48kHz audio, 20 hours of recording per month, up to 5 participants, 30-day retention, cloud backup, and no watermark.",
  },
  {
    question: "How is self-hosting free?",
    answer:
      "When you bring your own LiveKit and Cloudflare R2 keys, calls and recordings run on your infrastructure. There's no Openside fee: you pay those providers directly, and recording time, participants, and retention are unlimited.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancel whenever you like and you keep Pro until the end of your current billing period.",
  },
  {
    question: "Who handles payments?",
    answer:
      "Payments are processed by Polar, which acts as the merchant of record and handles checkout, taxes, and invoices.",
  },
  {
    question: "What happens when a recording expires?",
    answer:
      "Recordings on our infrastructure are deleted automatically after your plan's retention window, so download anything you want to keep. Recordings in your own bucket are never deleted by us.",
  },
];

const CellValue = ({ value }: { value: ReactNode | boolean }) => {
  if (value === true) {
    return (
      <Check
        aria-label="Included"
        className="size-4 text-(--landing-brand-text)"
      />
    );
  }
  if (value === false) {
    return (
      <Minus aria-label="Not included" className="size-4 text-foreground/35" />
    );
  }
  return <>{value}</>;
};

const PricingPage = () => (
  <MarketingLayout
    hero={
      <PageHero
        eyebrow="Pricing"
        title="Start free, go Pro, or self-host for nothing"
        description="Try Openside with no setup, let us run the infrastructure for $8.99 a month, or bring your own keys and record without limits."
      />
    }
  >
    <PricingSection />
    <SectionDivider />
    <Section id="compare">
      <SectionHeading eyebrow="Compare" title="Compare plans side by side." />
      <div
        className="mt-10 overflow-x-auto rounded-2xl border border-border"
      >
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-primary">
              <th scope="col" className="px-5 py-4 font-medium text-foreground/60">
                Plan
              </th>
              {PLAN_NAMES.map((name) => (
                <th
                  key={name}
                  scope="col"
                  className="font-bricolage px-5 py-4 text-base font-semibold text-foreground"
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {comparisonRows.map(({ label, values }) => (
              <tr key={label}>
                <th
                  scope="row"
                  className="px-5 py-3.5 font-medium text-foreground/80"
                >
                  {label}
                </th>
                {values.map((value, index) => (
                  <td
                    key={PLAN_NAMES[index]}
                    className="px-5 py-3.5 text-foreground/70"
                  >
                    <CellValue value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
    <SectionDivider />
    <FaqSection items={pricingFaqs} title="Questions about plans and billing." />
  </MarketingLayout>
);

export default PricingPage;
