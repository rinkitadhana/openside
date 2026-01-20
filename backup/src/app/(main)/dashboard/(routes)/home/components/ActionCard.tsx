import { ReactNode } from "react";

interface ActionCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  bgColorHex: string; // Changed to accept hex color instead of Tailwind class
  bgImage: string;
  onClick?: () => void;
}

const ActionCard = ({
  title,
  description,
  icon,
  bgColorHex,
  bgImage,
  onClick,
}: ActionCardProps) => {
  // Using inline styles for both background color and image to avoid build-time issues
  const cardStyle = {
    backgroundColor: bgColorHex,
  };

  const backgroundImageStyle = {
    backgroundImage: `url(${bgImage})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };

  return (
    <div
      onClick={onClick}
      className="relative flex-1 flex flex-col h-full items-center justify-center p-4 hover:opacity-80 rounded-xl cursor-pointer transition-all duration-300 overflow-hidden"
      style={cardStyle}
    >
      <div
        className="absolute inset-0 opacity-10"
        style={backgroundImageStyle}
      />
      <div className="absolute top-4 left-4 p-4 bg-white/20 rounded-xl">
        {icon}
      </div>
      <div className="absolute bottom-4 left-4 flex flex-col gap-1 items-start justify-center">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <p className="text-xs text-white/85 font-medium">{description}</p>
      </div>
    </div>
  );
};

export default ActionCard;
