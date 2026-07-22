import React from "react";

interface GridLayout {
  rows: number;
  cols: number;
  bottomSpan?: boolean;
}

export const getGridLayout = (userCount: number): GridLayout => {
  if (userCount === 0) return { rows: 0, cols: 0 };
  if (userCount === 1) return { rows: 1, cols: 1 };
  if (userCount === 2) return { rows: 2, cols: 1 };
  if (userCount === 3) return { rows: 2, cols: 2, bottomSpan: true };
  if (userCount === 4) return { rows: 2, cols: 2 };
  return { rows: 2, cols: 2 }; // fallback
};

interface VideoGridProps {
  children: React.ReactNode;
  layout: GridLayout;
}

const VideoGrid: React.FC<VideoGridProps> = ({ children, layout }) => {
  const gridStyles = {
    gridTemplateRows:
      layout.rows === 1 ? "1fr" : layout.rows === 2 ? "1fr 1fr" : "1fr 1fr 1fr",
    gridTemplateColumns:
      layout.cols === 1 ? "1fr" : layout.cols === 2 ? "1fr 1fr" : "1fr 1fr 1fr",
  };

  return (
    <div className="grid h-full gap-2" style={gridStyles}>
      {children}
    </div>
  );
};

export default VideoGrid;
