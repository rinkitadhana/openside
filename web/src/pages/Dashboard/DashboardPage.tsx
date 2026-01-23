import QuickActions from "@/components/Dashboard/Home/QuickActions";
import HeroBanner from "@/components/Dashboard/Home/HeroBanner";
import ActivityOverview from "@/components/Dashboard/Home/ActivityOverview";
import AIToolsSection from "@/components/Dashboard/Home/RecentCreationsSection";

const DashboardPage = () => {
  return (
    <div className="flex flex-col gap-8 p-2">
      <div className="flex gap-4">
        <div className="flex flex-col gap-4 w-[75%]">
          <HeroBanner />
          <QuickActions />
        </div>
        <ActivityOverview />
      </div>
      <AIToolsSection />
    </div>
  );
};

export default DashboardPage;
