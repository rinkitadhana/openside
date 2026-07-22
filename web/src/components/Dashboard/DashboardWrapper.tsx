"use client";
import React, { useEffect, useState } from "react";
import DashboardSidebar from "./DashboardSidebar";
import DashboardHeader from "./DashboardHeader";

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
        isMobileSidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setIsMobileSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50">
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
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          onToggleSidebar={toggleSidebar}
          isSidebarOpen={isMobile ? isMobileSidebarOpen : isSidebarOpen}
        />
        <main
          className={`relative flex-1 overflow-auto scrollbar-hide bg-background ${
            noPadding ? "" : "p-4"
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
};

export default DashboardWrapper;
