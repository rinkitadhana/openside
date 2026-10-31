import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
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
  PricingSection,
  PrivacySection,
  SponsorsSection,
  UseCasesSection,
} from "@/components/landing/sections";
import {
  boxVariants,
  containerVariants,
  riseVariants,
} from "@/components/landing/motion";

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
        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="relative z-10 flex w-full max-w-5xl flex-col items-start gap-3 pt-2 pb-20 text-left sm:pt-4"
        >
          <motion.span
            variants={riseVariants}
            className="inline-flex select-none items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 sm:text-sm"
          >
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
          </motion.span>

          <motion.h1
            variants={riseVariants}
            className="font-bricolage max-w-4xl text-3xl font-semibold leading-[1.2] text-white sm:text-[2.5rem]"
          >
            Record high quality podcasts, interviews, and calls right from your
            browser
          </motion.h1>

          <motion.p
            variants={riseVariants}
            className="-mt-1 max-w-xl text-sm font-normal text-white/80 sm:text-base"
          >
            Studio-quality recording, open-source at its core. Self-host it free
            or let us handle the infra.
          </motion.p>

          <HeroCTAs />

          <div className="relative mt-8 w-full">
            <motion.div
              variants={boxVariants}
              className="relative z-10 aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-background shadow-[0_0_12px_rgba(0,0,0,0.18),0_0_45px_rgba(0,0,0,0.08),0_0_90px_rgba(0,0,0,0.05)] sm:aspect-video"
            >
              <SpaceBlueprint />
            </motion.div>
          </div>
        </motion.section>
      }
    >
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
