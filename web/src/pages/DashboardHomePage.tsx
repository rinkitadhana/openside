import DashboardWelcome from "@/components/Dashboard/DashboardWelcome";
import QuickActions from "@/components/Dashboard/QuickActions";
import UpgradeBanner from "@/components/Dashboard/UpgradeBanner";
import RecentProjectsSection from "@/components/Dashboard/recordings/RecentProjectsSection";
import PageTitle from "@/components/shared/PageTitle";

const DashboardHomePage = () => {
  return (
    <>
      <PageTitle title="Dashboard" />
      <UpgradeBanner />
      <div className="flex flex-col gap-8 p-4 pt-6 md:p-6 md:pt-8">
        <DashboardWelcome />
        <QuickActions />
        <RecentProjectsSection />
      </div>
    </>
  );
};

export default DashboardHomePage;
