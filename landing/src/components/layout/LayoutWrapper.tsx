import React from "react";

interface LayoutWrapperProps {
  children: React.ReactNode;
}

const LayoutWrapper = ({ children }: LayoutWrapperProps) => {
  return (
    <div className="w-full max-w-[1300px] mx-auto">
      {children}
    </div>
  );
};

export default LayoutWrapper;
