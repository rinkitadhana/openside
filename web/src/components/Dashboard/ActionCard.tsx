import { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

interface ActionCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  image: string; // shared composite image, sliced across the cards
  positionX: string; // horizontal slice position, e.g. "25%"
  accentHex: string; // accent for the glass tint
  primaryIcon?: boolean; // use the neutral primary bg for the icon chip
  onClick?: () => void;
  className?: string; // extra classes for the card (e.g. responsive visibility)
}

const ActionCard = ({
  title,
  description,
  icon,
  image,
  positionX,
  accentHex,
  primaryIcon,
  onClick,
  className = "",
}: ActionCardProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-start gap-3 overflow-hidden rounded-xl p-4 text-left cursor-pointer ${className}`}
    >
      {/* faint fixed white wash so cards aren't too dark in the dark theme */}
      <span
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
      />

      {/* sliced image sits at the very back */}
      <span
        className="pointer-events-none absolute inset-0 opacity-30 transition-opacity duration-200 group-hover:opacity-45"
        style={{
          backgroundImage: `url(${image})`,
          backgroundSize: "500% auto",
          backgroundPosition: `${positionX} bottom`,
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* liquid glass layer: tinted, blurred, glossy */}
      <span
        className="pointer-events-none absolute inset-0 rounded-xl backdrop-blur-[2px] ring-1 ring-inset ring-white/25 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)] transition-shadow duration-200 group-hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]"
        style={{
          background: `linear-gradient(135deg, ${accentHex}5C 0%, ${accentHex}33 50%, ${accentHex}1F 100%)`,
        }}
      />
      {/* dark overlay for text legibility */}
      <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-black/35 via-black/15 to-transparent" />
      {/* top specular highlight */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/25 to-transparent opacity-50" />

      <span className="relative flex w-full items-start justify-between">
        <span
          className={`flex size-10 items-center justify-center rounded-lg ring-1 ring-inset backdrop-blur-sm shadow-inner ${
            primaryIcon ? "ring-black/10" : "text-white ring-white/30"
          }`}
          style={{
            backgroundColor: primaryIcon ? "#f0f0f0" : `${accentHex}66`,
            color: primaryIcon ? "#000000" : undefined,
          }}
        >
          {icon}
        </span>
        <span className="flex size-7 items-center justify-center rounded-full bg-white/20 text-white opacity-0 -translate-x-2 ring-1 ring-inset ring-white/30 backdrop-blur-sm transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
          <ArrowUpRight size={15} />
        </span>
      </span>
      <span className="relative flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-white drop-shadow-sm">
          {title}
        </span>
        <span className="text-xs text-white/70">{description}</span>
      </span>
    </button>
  );
};

export default ActionCard;
