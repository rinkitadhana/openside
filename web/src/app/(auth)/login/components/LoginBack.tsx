"use client";
import { useRouter } from "next/navigation";
import React from "react";
import { MdArrowBackIosNew } from "react-icons/md";

const LoginBack = () => {
  const router = useRouter();
  const handleBack = () => {
    router.push("/");
  };
  return (
    <div
      onClick={handleBack}
      className="flex flex-row items-center gap-2 border w-fit py-2 px-3 hover:bg-primary-hover transition duration-200 cursor-pointer select-none"
    >
      <MdArrowBackIosNew size={16} />
      <p>Back</p>
    </div>
  );
};

export default LoginBack;
