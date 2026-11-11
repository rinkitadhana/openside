import MarketingLayout from "@/components/landing/MarketingLayout";
import { PageHero, SponsorsSection } from "@/components/landing/sections";

const SponsorPage = () => (
  <MarketingLayout
    hero={
      <PageHero
        eyebrow="Sponsor"
        title="Keep Openside free and open source"
        description="Openside is built in the open and free to self-host. Sponsoring funds its development and puts your name on the wall."
      />
    }
  >
    <SponsorsSection />
  </MarketingLayout>
);

export default SponsorPage;
