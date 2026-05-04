import React from "react";
import InfoSidebar from "./sidebars/InfoSidebar";
import UsersSidebar from "./sidebars/UsersSidebar";
import ChatSidebar from "./sidebars/ChatSidebar";

type SidebarType = "info" | "users" | "chat" | null;

interface SpaceWrapperProps {
  children: React.ReactNode;
  activeSidebar: SidebarType;
  closeSidebar: () => void;
}

const SpaceWrapper = ({
  children,
  activeSidebar,
  closeSidebar,
}: SpaceWrapperProps) => {
  const renderSidebarContent = () => {
    switch (activeSidebar) {
      case "info":
        return <InfoSidebar onClose={closeSidebar} />;
      case "users":
        return <UsersSidebar onClose={closeSidebar} />;
      case "chat":
        return <ChatSidebar onClose={closeSidebar} />;
      default:
        return null;
    }
  };

  return (
    <section className="bg-call-background h-screen flex items-center p-2">
      <div className="relative flex-1 flex flex-col items-center justify-center h-full max-w-full overflow-hidden">
        <div className="w-full flex-1 min-h-0">
          {children}
        </div>
      </div>
      {activeSidebar && (
        <div className="ml-2 flex justify-center items-center h-full gap-2 flex-shrink-0">
          <div className="flex flex-col justify-start items-stretch border border-call-border h-full w-[350px] rounded-2xl bg-call-primary overflow-hidden">
            {renderSidebarContent()}
          </div>
        </div>
      )}
    </section>
  );
};

export default SpaceWrapper;
