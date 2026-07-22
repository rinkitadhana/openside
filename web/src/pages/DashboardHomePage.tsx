import QuickActions from "@/components/Dashboard/QuickActions";
import UpgradeBanner from "@/components/Dashboard/UpgradeBanner";
import RecentProjectsSection from "@/components/Dashboard/recordings/RecentProjectsSection";
import PageTitle from "@/components/shared/PageTitle";

const DashboardHomePage = () => {
  return (
    <>
      <PageTitle title="Dashboard" />
      <UpgradeBanner />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <QuickActions />
        <RecentProjectsSection />
      </div>
    </>
  );
};

export default DashboardHomePage;
