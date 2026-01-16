"use client";
import React from "react";
import DashboardWrapper from "./components/DashboardWrapper";
import ProtectedRoute from "@/shared/components/ProtectedRoute";

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ProtectedRoute>
      <DashboardWrapper>{children}</DashboardWrapper>
    </ProtectedRoute>
  );
};

export default DashboardLayout;
