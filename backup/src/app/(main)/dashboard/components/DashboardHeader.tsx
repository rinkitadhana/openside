"use client";
import { ThemeSwitcher } from "@/shared/components/ThemeSwitcher";
import { usePathname } from "next/navigation";
import React from "react";

const DashboardHeader = () => {
  const pathname = usePathname();
  const route = pathname.split("/").pop();

  return (
    <div className="flex items-center gap-2 absolute top-2 right-2">
      <div className="border border-call-border rounded-xl w-fit py-2 px-3 select-none bg-call-background text-xs">
        dashboard/{route}
      </div>
      <ThemeSwitcher
        scrolled={true}
        size={16}
        className="border border-call-border rounded-xl w-fit py-2 px-3 select-none bg-call-background"
      />
    </div>
  );
};

export default DashboardHeader;
