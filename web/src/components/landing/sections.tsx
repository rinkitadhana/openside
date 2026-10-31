import { useState, type ElementType, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Globe, Heart } from "lucide-react";
import { FaGithub, FaLinkedin } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

import {
  PricingCTA,
  StartRecordingCTA,
} from "@/components/landing/LandingAuthCTA";
import { useOpenAuth } from "@/components/landing/MarketingLayout";
import { featureDemos } from "@/components/landing/FeatureDemos";
import HowItWorksDiagram from "@/components/landing/HowItWorksDiagram";
import UseCasesShowcase from "@/components/landing/UseCasesShowcase";
import {
  faqs as defaultFaqs,
  features,
  pricingPlans,
  recordingPoints,
  selfHostPoints,
  sponsorUrl,
  sponsors,
  useCases,
} from "@/components/landing/content";
import { containerVariants, riseVariants } from "@/components/landing/motion";

const inView = {
  initial: "hidden",
  whileInView: "show",
  viewport: { once: true, margin: "-100px" },
} as const;

// The two hero buttons: start recording (auth-aware) and star on GitHub.
export const HeroCTAs = () => {
  const openAuth = useOpenAuth();

  return (
    <motion.div
      variants={riseVariants}
      className="mt-3 flex flex-wrap items-center gap-3"
    >
      <StartRecordingCTA
        onOpenAuth={openAuth}
        className="flex select-none items-center gap-2 rounded-lg bg-white px-4.5 py-2.5 text-[0.9375rem] font-semibold text-[#131313] transition-colors hover:bg-white/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
      />
      <a
        href="https://github.com/rinkitadhana/openside"
        target="_blank"
        rel="noopener noreferrer"
        className="flex select-none cursor-pointer items-center gap-2 rounded-lg bg-[#131313] px-4.5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#131313]/90"
      >
        <FaGithub className="size-4" />
        Star on GitHub
      </a>
    </motion.div>
  );
};

// Hero band content for the inner marketing pages.
export const PageHero = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) => (
  <motion.section
    variants={containerVariants}
    initial="hidden"
    animate="show"
    className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-start gap-3 pt-6 pb-20 text-left sm:pt-10 sm:pb-24"
  >
    <motion.span
      variants={riseVariants}
      className="inline-flex select-none items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 sm:text-sm"
    >
      {eyebrow}
    </motion.span>
    <motion.h1
      variants={riseVariants}
      className="font-bricolage max-w-3xl text-3xl font-semibold leading-[1.2] text-white sm:text-[2.5rem]"
    >
      {title}
    </motion.h1>
    <motion.p
      variants={riseVariants}
      className="-mt-1 max-w-xl text-sm font-normal text-white/80 sm:text-base"
    >
      {description}
    </motion.p>
    <HeroCTAs />
  </motion.section>
);

export const SectionHeading = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) => (
  <motion.div
    className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    {...inView}
    variants={riseVariants}
  >
    <div className="max-w-xl">
      <p className="text-sm font-medium text-foreground/60">{eyebrow}</p>
      <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-base leading-7 text-foreground/70">
          {description}
        </p>
      )}
    </div>
  </motion.div>
);

export const Section = ({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) => (
  <section id={id} className="bg-background px-4 py-20 sm:px-6">
    <div className="mx-auto max-w-5xl">{children}</div>
  </section>
);

export const FeaturesGrid = () => (
  <motion.div
    className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2"
    {...inView}
    variants={containerVariants}
  >
    {features.map(({ icon: Icon, title, description }) => {
      const Demo = featureDemos[title];
      return (
        <motion.article
          key={title}
          variants={riseVariants}
          className="flex flex-col rounded-2xl border border-border bg-foreground/[0.03] p-6"
        >
          <div className="flex size-11 items-center justify-center rounded-xl bg-(--landing-brand-tint)/45 text-(--landing-brand-text)">
            <Icon className="size-5" />
          </div>
          <h3 className="font-bricolage mt-5 text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-foreground/65">
            {description}
          </p>
          <div className="relative mt-6 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-[url('/img/landing/feature-bg.jpg')] bg-cover bg-center px-5 sm:aspect-[16/10]">
            {Demo && <Demo />}
          </div>
        </motion.article>
      );
    })}
  </motion.div>
);

export const FeaturesSection = () => (
  <Section id="features">
    <SectionHeading
      eyebrow="Features"
      title="Record, download, and share in one place."
      description="From capture to sharing, Openside handles the whole workflow so you can focus on the recording itself."
    />
    <FeaturesGrid />
  </Section>
);

export const UseCasesSection = () => (
  <Section id="use-cases">
    <SectionHeading
      eyebrow="Use cases"
      title="Built for how you actually work."
      description="From solo creators to compliance-sensitive teams, here is who records with Openside."
    />
    <motion.div {...inView} variants={riseVariants}>
      <UseCasesShowcase items={useCases} />
    </motion.div>
  </Section>
);

const PointsCard = ({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle: string;
  points: { icon: ElementType; title: string; description: string }[];
}) => (
  <motion.div
    variants={riseVariants}
    className="rounded-2xl border border-border bg-foreground/[0.03] p-6 sm:p-8"
  >
    <h3 className="font-bricolage text-lg font-semibold tracking-tight text-foreground">
      {title}
    </h3>
    <p className="mt-1 text-sm leading-6 text-foreground/60">{subtitle}</p>
    <ul className="mt-6 space-y-6">
      {points.map(({ icon: Icon, title, description }) => (
        <li key={title} className="flex gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--landing-brand-tint)/45 text-(--landing-brand-text)">
            <Icon className="size-5" />
          </div>
          <div>
            <h4 className="font-bricolage text-base font-medium text-foreground">
              {title}
            </h4>
            <p className="mt-1 text-sm leading-6 text-foreground/65">
              {description}
            </p>
          </div>
        </li>
      ))}
    </ul>
  </motion.div>
);

export const PrivacySection = () => (
  <Section id="privacy">
    <SectionHeading
      eyebrow="Privacy"
      title="Your recordings stay yours."
      description="Two things matter here: keeping your recordings safe, and letting you run the whole thing yourself. Here is how each works."
    />
    <motion.div
      className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2"
      {...inView}
      variants={containerVariants}
    >
      <PointsCard
        title="Your recordings"
        subtitle="From the moment you hit record to the moment you share."
        points={recordingPoints}
      />
      <PointsCard
        title="Self-hosting and keys"
        subtitle="Run Openside on your own infrastructure, with your own keys."
        points={selfHostPoints}
      />
    </motion.div>
  </Section>
);

export const HowItWorksSection = () => (
  <Section id="how-it-works">
    <SectionHeading
      eyebrow="How it works"
      title="Recorded locally, not over the internet."
      description="Most tools record the call stream, so quality depends on everyone's connection. Openside records each person locally, so it doesn't."
    />
    <motion.div
      className="mt-10 overflow-x-auto"
      {...inView}
      variants={riseVariants}
    >
      <HowItWorksDiagram />
    </motion.div>
  </Section>
);

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

type Sponsor = (typeof sponsors)[number];

const socialLinks = [
  { key: "website", label: "their website", icon: Globe },
  { key: "x", label: "X", icon: FaXTwitter },
  { key: "github", label: "GitHub", icon: FaGithub },
  { key: "linkedin", label: "LinkedIn", icon: FaLinkedin },
] as const;

const formatAmount = ({ amount, interval }: Sponsor) =>
  interval === "month" ? `$${amount} / month` : `$${amount} one-time`;

const SponsorAvatar = ({
  sponsor,
  className,
}: {
  sponsor: Sponsor;
  className: string;
}) =>
  sponsor.avatar ? (
    <img
      src={sponsor.avatar}
      alt=""
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  ) : (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-(--landing-brand-tint)/45 font-medium text-(--landing-brand-text) ${className}`}
    >
      {initials(sponsor.name)}
    </div>
  );

const sponsorAmounts = [5, 10, 25, 50, 100];

// Pick an amount and frequency, then finish on GitHub Sponsors.
const SponsorPicker = () => {
  const [interval, setFrequency] = useState<"month" | "once">("month");
  const [amount, setAmount] = useState(25);

  const checkoutUrl = `${sponsorUrl}/sponsorships?${new URLSearchParams({
    amount: String(amount),
    frequency: interval === "month" ? "recurring" : "one-time",
  })}`;

  return (
    <motion.div
      className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-[1fr_minmax(0,22rem)] md:items-start md:gap-12"
      {...inView}
      variants={riseVariants}
    >
      <div>
        <div className="flex size-11 items-center justify-center rounded-xl bg-(--landing-brand-tint)/45">
          <Heart className="size-5 fill-[#db61a2] text-[#db61a2]" />
        </div>
        <h3 className="font-bricolage mt-5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Support Openside
        </h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-foreground/65">
          Openside is built in the open and free to self-host. Sponsoring keeps
          it that way, and puts you up there with everyone else.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-5">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-(--landing-chip) p-1">
          {(
            [
              ["month", "Monthly"],
              ["once", "One-time"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFrequency(value)}
              aria-pressed={interval === value}
              className={`cursor-pointer rounded-md py-2 text-sm font-medium transition-colors ${
                interval === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {sponsorAmounts.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(value)}
              aria-pressed={amount === value}
              className={`cursor-pointer rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                amount === value
                  ? "border-(--landing-brand-text) bg-(--landing-brand-text)/[0.08] text-(--landing-brand-text)"
                  : "border-border text-foreground/70 hover:border-(--landing-brand-text)/40 hover:text-foreground"
              }`}
            >
              ${value}
            </button>
          ))}
        </div>

        <a
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 flex w-full select-none items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Heart className="size-4 fill-[#db61a2] text-[#db61a2]" />
          Sponsor ${amount}
          {interval === "month" ? " / month" : " once"}
        </a>
        <p className="mt-3 text-center text-xs text-foreground/50">
          Secure checkout on GitHub Sponsors. Any amount works there too.
        </p>
      </div>
    </motion.div>
  );
};

export const SponsorsSection = () => (
  <Section id="sponsors">
    <SectionHeading
      eyebrow="Sponsors"
      title="Backed by people who love open source."
      description="Openside stays free to self-host thanks to the people and companies who support its development."
    />

    {sponsors.length > 0 ? (
      <motion.div
        className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        {...inView}
        variants={containerVariants}
      >
        {sponsors.map((sponsor) => (
          <motion.figure
            key={sponsor.name}
            variants={riseVariants}
            className="flex flex-col rounded-2xl border border-border bg-foreground/[0.03] p-6"
          >
            <figcaption className="flex items-center gap-4">
              <div className="relative shrink-0">
                <SponsorAvatar
                  sponsor={sponsor}
                  className="size-12 text-base"
                />
                <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-background ring-1 ring-border">
                  <Heart className="size-3 fill-[#db61a2] text-[#db61a2]" />
                </span>
              </div>
              <div className="min-w-0">
                <p className="font-bricolage truncate text-base font-semibold text-foreground">
                  {sponsor.name}
                </p>
                <p className="text-sm text-foreground/60">
                  {formatAmount(sponsor)}
                </p>
              </div>
            </figcaption>
            {sponsor.message && (
              <blockquote className="mt-5 text-[0.9375rem] leading-7 text-foreground/75">
                “{sponsor.message}”
              </blockquote>
            )}
            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
              <p className="text-xs text-foreground/45">
                {sponsor.interval === "month"
                  ? `Sponsoring since ${sponsor.since}`
                  : `Sponsored in ${sponsor.since}`}
              </p>
              {sponsor.socials && (
                <div className="flex items-center gap-1">
                  {socialLinks.map(({ key, label, icon: Icon }) => {
                    const url = sponsor.socials?.[key];
                    return (
                      url && (
                        <a
                          key={key}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${sponsor.name} on ${label}`}
                          className="flex size-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                        >
                          <Icon className="size-3.5" />
                        </a>
                      )
                    );
                  })}
                </div>
              )}
            </div>
          </motion.figure>
        ))}
      </motion.div>
    ) : (
      <motion.div
        className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-foreground/20 px-6 py-14 text-center"
        {...inView}
        variants={riseVariants}
      >
        <div className="flex size-11 items-center justify-center rounded-xl bg-(--landing-brand-tint)/45">
          <Heart className="size-5 fill-[#db61a2] text-[#db61a2]" />
        </div>
        <h3 className="font-bricolage mt-5 text-lg font-semibold tracking-tight text-foreground">
          No sponsors yet
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-foreground/65">
          Be the first to back Openside. Your name, message, and links will show
          up right here.
        </p>
      </motion.div>
    )}

    <SponsorPicker />
  </Section>
);

export const PricingCards = () => {
  const openAuth = useOpenAuth();

  return (
    <motion.div
      className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3"
      {...inView}
      variants={containerVariants}
    >
      {pricingPlans.map((plan) => (
        <motion.div
          key={plan.name}
          variants={riseVariants}
          className={`flex flex-col rounded-2xl border p-6 text-foreground ${
            plan.featured
              ? "border-(--landing-brand-tint) bg-(--landing-brand-soft) shadow-[0_12px_34px_rgba(0,65,170,0.14)] ring-1 ring-(--landing-brand-tint)"
              : "border-border bg-foreground/[0.03]"
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bricolage text-lg font-semibold tracking-tight">
              {plan.name}
            </h3>
            {plan.featured && (
              <span className="rounded-full bg-(--landing-brand-tint) px-2.5 py-1 text-xs font-medium text-(--landing-brand-text)">
                Popular
              </span>
            )}
          </div>

          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-semibold tracking-tight">
              {plan.price}
            </span>
            {plan.priceSuffix && (
              <span className="text-sm text-foreground/55">
                {plan.priceSuffix}
              </span>
            )}
          </div>

          <p className="mt-3 text-sm leading-6 text-foreground/65">
            {plan.description}
          </p>

          <ul className="mt-6 mb-8 space-y-3">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm">
                <Check
                  className={`mt-0.5 size-4 shrink-0 ${
                    plan.featured
                      ? "text-(--landing-brand-text)"
                      : "text-foreground"
                  }`}
                />
                <span className="text-foreground/75">{feature}</span>
              </li>
            ))}
          </ul>

          <PricingCTA
            label={plan.cta}
            isPro={plan.name === "Pro"}
            onOpenAuth={openAuth}
            className={`mt-auto w-full cursor-pointer rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
              plan.featured
                ? "bg-[#0041aa] text-white hover:bg-[#0041aa]/90"
                : "bg-foreground text-background hover:bg-foreground/90"
            }`}
          />
        </motion.div>
      ))}
    </motion.div>
  );
};

export const PricingSection = () => (
  <Section id="pricing">
    <SectionHeading
      eyebrow="Pricing"
      title="Simple pricing that scales with you."
      description="Self-host it for free, or let us handle the infrastructure. No hidden fees, cancel anytime."
    />
    <PricingCards />
  </Section>
);

export const FaqSection = ({
  items = defaultFaqs,
  title = "Everything you need to know before you record.",
}: {
  items?: { question: string; answer: string }[];
  title?: string;
}) => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-background px-4 py-20 sm:px-6">
      <motion.div
        className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] md:gap-16"
        {...inView}
        variants={containerVariants}
      >
        <motion.div variants={riseVariants}>
          <p className="text-sm font-medium text-foreground/60">FAQ</p>
          <h2 className="font-bricolage mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
        </motion.div>

        <motion.div
          variants={riseVariants}
          className="divide-y divide-border border-y border-border"
        >
          {items.map(({ question, answer }, index) => {
            const isOpen = openFaq === index;
            return (
              <div key={question} className="py-5">
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : index)}
                  aria-expanded={isOpen}
                  className="group flex w-full cursor-pointer items-center justify-between gap-4 text-left text-base font-medium text-foreground transition-colors hover:text-(--landing-brand-text)"
                >
                  {question}
                  <span
                    className={`text-xl font-normal text-foreground/55 transition-[transform,color] duration-300 group-hover:text-(--landing-brand-text) ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-300 ease-out ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-xl pt-3 text-sm leading-6 text-foreground/65">
                      {answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </motion.div>
    </section>
  );
};
