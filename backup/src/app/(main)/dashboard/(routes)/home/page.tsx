import QuickActions from "./components/QuickActions";
import HeroBanner from "./components/HeroBanner";
import ActivityOverview from "./components/ActivityOverview";
import AIToolsSection from "./components/RecentCreationsSection";

const DashboardHome = () => {
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

export default DashboardHome;
