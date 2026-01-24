import React from "react";
import PageTitle from "@/components/shared/PageTitle";
import LandingNavbar from "@/components/landing/LandingNavbar";
import LandingHero from "@/components/landing/LandingHero";
// import LandingTechStack from "@/components/landing/LandingTechStack";
import LandingTemp from "@/components/landing/LandingTemp";
import LandingFooter from "@/components/landing/LandingFooter";

const LandingPage = () => {
  return (
    <>
      <PageTitle title="Home | Asap" />
      <LandingNavbar />
      <LandingHero />
      {/* <div className="border-t border-main-border w-full" />
      <LandingTechStack /> */}
      <div className="border-t border-main-border w-full" />
      <LandingTemp />
      <div className="border-t border-main-border w-full" />
      <LandingFooter />
    </>
  );
};

export default LandingPage;
