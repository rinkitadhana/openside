import { Play, MoreHorizontal, Clock } from "lucide-react";

interface RecentCreationsCardProps {
  title: string;
  date: string;
  duration: string;
  avatar?: string;
  initial?: string;
  onClick?: () => void;
}

const RecentCreationsCard = ({
  title,
  date,
  duration,
  avatar,
  initial,
  onClick,
}: RecentCreationsCardProps) => {
  return (
    <div
      onClick={onClick}
      className="group border border-border rounded-lg bg-background p-2 cursor-pointer transition-all duration-200 hover:border-foreground/20 hover:shadow-lg hover:shadow-black/5"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full rounded-md overflow-hidden bg-foreground/10">
        {avatar ? (
          <img
            src={avatar}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-3xl font-semibold text-foreground/40">
              {initial ?? "?"}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center justify-center size-12 rounded-full bg-background/90 text-foreground scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-200">
            <Play size={20} className="ml-0.5 fill-foreground" />
          </div>
        </div>
        {duration !== "-" && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Clock size={11} />
            {duration}
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="flex items-start justify-between gap-2 px-1.5 pt-2.5 pb-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{title}</h3>
          <p className="text-xs text-foreground/55 mt-0.5">{date}</p>
        </div>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1 rounded text-foreground/45 hover:bg-primary hover:text-foreground transition-colors duration-200 cursor-pointer"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
};

export default RecentCreationsCard;
