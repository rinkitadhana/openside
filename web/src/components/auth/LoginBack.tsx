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
    <button
      type="button"
      aria-label="Back to home"
      onClick={handleBack}
      className="flex size-10 items-center justify-center rounded-xl border border-call-border bg-call-primary hover:bg-primary-hover transition duration-200 cursor-pointer select-none"
    >
      <MdArrowBackIosNew size={16} />
    </button>
  );
};

export default LoginBack;
