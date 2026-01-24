"use client";
import React from "react";
import DashboardWrapper from "@/components/dashboard/DashboardWrapper";
import ProtectedRoute from "@/components/shared/ProtectedRoute";

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ProtectedRoute>
      <DashboardWrapper>{children}</DashboardWrapper>
    </ProtectedRoute>
  );
};

export default DashboardLayout;
