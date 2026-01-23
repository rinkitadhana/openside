import React from "react";
import PageTitle from "@/components/shared/PageTitle";
import LandingNavbar from "@/components/navbar/LandingNavbar";
import LandingHero from "@/components/hero/LandingHero";
import LandingTemp from "@/components/shared/LandingTemp";
import LandingFooter from "@/components/footer/LandingFooter";

const LandingPage = () => {
  return (
    <>
      <PageTitle title="Home | Asap" />
      <LandingNavbar />
      <LandingHero />
      <div className="border-t border-main-border w-full" />
      <LandingTemp />
      <div className="border-t border-main-border w-full" />
      <LandingFooter />
    </>
  );
};

export default LandingPage;
