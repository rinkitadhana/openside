import Image from "next/image";
import React from "react";
import { RiCustomerService2Line } from "react-icons/ri";

const LoginImage = () => {
  return (
    <div className="relative h-full overflow-visible">
      <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-l-2 border-t-2 border-foreground z-10" />
      <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-r-2 border-b-2 border-foreground z-10" />
      <div className="flex flex-col gap-4 relative h-full overflow-hidden">
        <Image
          className="select-none"
          src="/img/login/login-image.png"
          alt="login-image"
          width={500}
          height={500}
        />
        <a
          href="mailto:therinkit@gmail.com"
          className=" select-none flex flex-row items-center gap-2 absolute bottom-2 right-2 px-2 py-1 bg-background/40 hover:bg-background/55 transition-all duration-200 backdrop-blur-xs"
        >
          <RiCustomerService2Line size={16} />
          Contact Us
        </a>
      </div>
    </div>
  );
};

export default LoginImage;
