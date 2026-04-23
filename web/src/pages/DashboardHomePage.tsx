import ActivityOverview from "@/components/Dashboard/ActivityOverview";
import HeroBanner from "@/components/Dashboard/HeroBanner";
import QuickActions from "@/components/Dashboard/QuickActions";
import RecentCreationsSection from "@/components/Dashboard/RecentCreationsSection";
import PageTitle from "@/components/shared/PageTitle";

const DashboardHomePage = () => {
  return (
    <>
      <PageTitle title="Dashboard | Asap" />
      <div className="flex flex-col gap-8 p-2">
        <div className="flex gap-4">
          <div className="flex flex-col gap-4 w-[75%]">
            <HeroBanner />
            <QuickActions />
          </div>
          <ActivityOverview />
        </div>
        <RecentCreationsSection />
      </div>
    </>
  );
};

export default DashboardHomePage;
