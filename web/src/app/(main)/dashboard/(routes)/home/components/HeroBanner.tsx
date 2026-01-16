import DateComponent from "@/shared/utils/Date";
import TimeComponent from "@/shared/utils/Time";

const HeroBanner = () => {
  return (
    <div className="relative border border-call-border rounded-xl h-[300px] bg-[url('/img/hero-background.png')] bg-cover bg-center bg-no-repeat">
      <div className="absolute top-4 left-4 rounded-lg bg-call-primary/50 backdrop-blur-sm px-4 py-2 select-none font-medium">
        You don&apos;t have any upcoming meetings
      </div>
      <div className="absolute bottom-4 left-4 px-4 py-2 flex flex-col gap-2">
        <TimeComponent className="text-7xl font-bold text-white/80" />
        <DateComponent className="text-white/80" />
      </div>
    </div>
  );
};

export default HeroBanner;
