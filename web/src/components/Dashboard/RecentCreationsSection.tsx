import RecentCreationsCard from "./RecentCreationsCard";

const RecentCreationsSection = () => {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Recent Creations</h1>
      <div className="flex gap-4">
        {[1, 2, 3, 4].map((index) => (
          <RecentCreationsCard key={index} />
        ))}
      </div>
    </div>
  );
};

export default RecentCreationsSection;
