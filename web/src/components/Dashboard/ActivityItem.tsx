import { ChevronRight } from "lucide-react";

interface ActivityItemProps {
  title: string;
  time: string;
  isActive: boolean;
}

const ActivityItem = ({ title, time, isActive }: ActivityItemProps) => {
  return (
    <div className="group flex w-full items-center justify-between gap-2 p-3 rounded-md bg-primary hover:bg-primary transition-all duration-200 cursor-pointer">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`size-2.5 shrink-0 rounded-full ${
            isActive ? "bg-primary" : "bg-brand"
          }`}
        />
        <p className="text-sm font-medium truncate">{title}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs text-foreground">{time}</span>
        <ChevronRight
          size={14}
          className="text-foreground opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0"
        />
      </div>
    </div>
  );
};

export default ActivityItem;
