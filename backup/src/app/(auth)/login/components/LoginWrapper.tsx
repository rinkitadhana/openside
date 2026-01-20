import React from "react";

const LoginWrapper = ({ children }: { children?: React.ReactNode }) => {
  return (
    <section className="h-screen flex flex-col">
      <div className="border-x max-w-[1250px] w-full mx-auto flex-1" />
      <div className="border-y flex justify-center items-center">
        <div className="max-w-[1250px] w-full h-[800px] border-x ">
          {children}
        </div>
      </div>
      <div className="border-x max-w-[1250px] w-full mx-auto flex-1" />
    </section>
  );
};

export default LoginWrapper;
