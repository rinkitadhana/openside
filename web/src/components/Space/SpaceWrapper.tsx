import React from "react";

type SidebarType = "info" | "users" | "chat" | null;

interface SpaceWrapperProps {
  children: React.ReactNode;
  activeSidebar: SidebarType;
  closeSidebar: () => void;
}

const SpaceWrapper = ({
  children,
}: SpaceWrapperProps) => {
  return (
    <section className="bg-call-background h-screen flex items-center p-2">
      <div className="relative flex-1 flex flex-col items-center justify-center h-full max-w-full overflow-hidden">
        <div className="w-full flex-1 min-h-0">
          {children}
        </div>
      </div>
    </section>
  );
};

export default SpaceWrapper;
