import React, { useEffect, useState } from "react";
import DashboardSidebar from "./DashboardSidebar";
import DashboardHeader from "./DashboardHeader";
import OnboardingModal from "./OnboardingModal";
import { backdropMotion, usePresence } from "@/hooks/usePresence";

const SIDEBAR_STATE_KEY = "sidebarOpen";

interface DashboardWrapperProps {
  children: React.ReactNode;
  // Some pages (e.g. the calendar) manage their own edge spacing and want the
  // content area flush to its border.
  noPadding?: boolean;
}

const DashboardWrapper = ({ children, noPadding }: DashboardWrapperProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  // On phones the sidebar can't share the row with the content, so it becomes
  // an overlay drawer with its own (non-persisted, default-closed) open state.
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const mobileDrawer = usePresence(isMobileSidebarOpen);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STATE_KEY);
    if (stored !== null) setIsSidebarOpen(stored === "true");
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      setIsMobile(mql.matches);
      if (!mql.matches) setIsMobileSidebarOpen(false);
    };
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  const toggleSidebar = () => {
    if (isMobile) {
      setIsMobileSidebarOpen((current) => !current);
      return;
    }
    setIsSidebarOpen((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_STATE_KEY, String(next));
      return next;
    });
  };

  if (!isMounted) return null;

  return (
    <div className="fixed inset-0 flex bg-background">
      {isMobile ? (
        mobileDrawer.rendered && (
          <>
            <div
              className={`fixed inset-0 z-40 bg-black/40 ${backdropMotion(mobileDrawer.isClosing)}`}
              onClick={() => setIsMobileSidebarOpen(false)}
            />
            <div
              className={`fixed inset-y-0 left-0 z-50 duration-150 ${
                mobileDrawer.isClosing
                  ? "animate-out slide-out-to-left fill-mode-forwards"
                  : "animate-in slide-in-from-left"
              }`}
            >
              <DashboardSidebar
                isOpen
                onNavigate={() => setIsMobileSidebarOpen(false)}
              />
            </div>
          </>
        )
      ) : (
        <DashboardSidebar isOpen={isSidebarOpen} />
      )}
      {/* Content side sits on its own tone, between the sidebar's canvas and
          the raised bg-primary cards, so the two halves read apart. */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#f9f9fb] dark:bg-[#0f0f11]">
        <DashboardHeader
          onToggleSidebar={toggleSidebar}
          isSidebarOpen={isMobile ? isMobileSidebarOpen : isSidebarOpen}
        />
        <main
          className={`relative flex-1 overflow-auto scrollbar-hide ${
            noPadding ? "" : "p-4"
          }`}
        >
          {children}
        </main>
      </div>
      {/* First visit after signup: a few questions, shown once. */}
      <OnboardingModal />
    </div>
  );
};

export default DashboardWrapper;
