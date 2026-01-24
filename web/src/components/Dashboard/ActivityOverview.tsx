import ActivityItem from "./ActivityItem";

const activities = [
  {
    id: 1,
    title: "Meeting with John Doe",
    time: "8:30 PM",
    colorClass: "bg-purple-400",
  },
  {
    id: 2,
    title: "Team Standup",
    time: "10:00 PM",
    colorClass: "bg-green-400",
  },
  {
    id: 3,
    title: "Project Review",
    time: "11:30 PM",
    colorClass: "bg-orange-400",
  },
];

const ActivityOverview = () => {
  return (
    <div className="border border-call-border rounded-xl p-4 bg-call-background w-[25%] mt-9 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Activity Overview</h1>
      <div className="flex flex-col gap-3">
        {activities.map((activity) => (
          <ActivityItem
            key={activity.id}
            title={activity.title}
            time={activity.time}
            colorClass={activity.colorClass}
          />
        ))}
      </div>
    </div>
  );
};

export default ActivityOverview;
