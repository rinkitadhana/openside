"use client";
import React from "react";
import { MdArrowBackIosNew } from "react-icons/md";
import { useNavigate } from "react-router-dom";

const LoginBack = () => {
  const navigate = useNavigate();
  const handleBack = () => {
    navigate("/");
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
