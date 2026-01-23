interface ActivityItemProps {
  title: string;
  time: string;
  colorClass: string;
}

const ActivityItem = ({ title, time, colorClass }: ActivityItemProps) => {
  return (
    <div className="flex items-center justify-between p-3 border border-call-border rounded-lg bg-call-primary hover:bg-primary-hover transition-all duration-200 cursor-pointer">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 ${colorClass} rounded-full`} />
        <p className="text-sm font-medium">{title}</p>
      </div>
      <span className="text-xs text-secondary-text">{time}</span>
    </div>
  );
};

export default ActivityItem;
