"use client";
import React from "react";
import DashboardSidebar from "./DashboardSidebar";
import DashboardHeader from "./DashboardHeader";

interface DashboardWrapperProps {
  children: React.ReactNode;
}

const DashboardWrapper = ({ children }: DashboardWrapperProps) => {
  return (
    <section className="flex bg-call-background gap-4 p-4 min-h-screen fixed inset-0">
      <DashboardSidebar />
      <div className="relative flex-1 bg-call-primary overflow-auto scrollbar-hide rounded-xl border border-call-border p-2">
        <DashboardHeader />
        {children}
      </div>
    </section>
  );
};

export default DashboardWrapper;
