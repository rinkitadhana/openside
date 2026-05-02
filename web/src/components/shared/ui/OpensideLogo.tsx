import React from "react";

const OpensideLogo = ({ icon, name }: { icon?: boolean, name?: boolean }) => {
  return (
    <div className="flex items-center gap-2">
      {icon && (
        <>
          <img
            src="/logo/rounded-logo-light.png"
            className="size-[32px] select-none dark:hidden"
            alt="Openside"
            width={40}
            height={40}
          />
          <img
            src="/logo/rounded-logo-dark.png"
            className="size-[32px] select-none hidden dark:block"
            alt="Openside"
            width={40}
            height={40}
          />
        </>
      )}
      {
        name && (
          <h1 className="text-xl font-bold">Openside</h1>
        )
      }
    </div>
  );
};

export default OpensideLogo;
