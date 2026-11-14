import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { FaGithub } from "react-icons/fa";
import { SiLoom } from "react-icons/si";

import SpaceBlueprint from "@/components/landing/SpaceBlueprint";
import { RiversideIcon } from "@/components/landing/BrandIcons";
import MarketingLayout, {
  SectionDivider,
} from "@/components/landing/MarketingLayout";
import {
  FaqSection,
  FeaturesSection,
  HeroCTAs,
  HowItWorksSection,
  LaunchVideoSection,
  PricingSection,
  PrivacySection,
  SponsorsSection,
  UseCasesSection,
} from "@/components/landing/sections";

const LandingPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Surface the email-verification confirmation that used to live on /auth.
  useEffect(() => {
    if (searchParams.get("verified") === "email") {
      const next = new URLSearchParams(searchParams);
      next.delete("verified");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <MarketingLayout
      heroClassName="flex min-h-(--hero-art-height) flex-col items-center justify-start"
      heroArt="full"
      hero={
        <section className="relative z-10 flex w-full max-w-5xl flex-col items-start gap-3 pt-2 pb-20 text-left sm:pt-4">
          <span className="hero-rise inline-flex select-none items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 sm:text-sm">
            <FaGithub className="size-3.5" />
            Open-source alternative to
            <span className="inline-flex items-center gap-1 text-white">
              <RiversideIcon className="size-3.5" />
              Riverside
            </span>
            and
            <span className="inline-flex items-center gap-1 text-white">
              <SiLoom className="size-3.5" />
              Loom
            </span>
          </span>

          <h1 className="hero-rise font-bricolage max-w-4xl text-3xl font-semibold leading-[1.2] text-white [--i:1] sm:text-[2.5rem]">
            Record high quality podcasts, interviews, and calls right from your
            browser
          </h1>

          <p className="hero-rise -mt-1 max-w-xl text-sm font-normal text-white/80 [--i:2] sm:text-base">
            Studio-quality recording, open-source at its core. Self-host it free
            or let us handle the infra.
          </p>

          <HeroCTAs animated />

          <div className="relative mt-8 w-full">
            <div className="hero-box relative z-10 aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-background shadow-[0_0_12px_rgba(0,0,0,0.18),0_0_45px_rgba(0,0,0,0.08),0_0_90px_rgba(0,0,0,0.05)] [--i:4] sm:aspect-video">
              <SpaceBlueprint />
            </div>
          </div>
        </section>
      }
    >
      <LaunchVideoSection />
      <SectionDivider />
      <FeaturesSection />
      <SectionDivider />
      <UseCasesSection />
      <SectionDivider />
      <PrivacySection />
      <SectionDivider />
      <HowItWorksSection />
      <SectionDivider />
      <SponsorsSection />
      <SectionDivider />
      <PricingSection />
      <SectionDivider />
      <FaqSection />
    </MarketingLayout>
  );
};

export default LandingPage;
