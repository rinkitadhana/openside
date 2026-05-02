"use client";
import React from "react";
import { FcGoogle } from "react-icons/fc";
import { useAuth } from "@/hooks/useAuth";
const LoginGoogle = () => {
  const { loginWithGoogle } = useAuth();
  const handleLogin = async () => {
    await loginWithGoogle();
  };
  return (
    <button
      type="button"
      onClick={handleLogin}
      className="select-none flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-call-border bg-call-primary px-3.5 text-sm font-semibold hover:bg-primary-hover transition duration-200 cursor-pointer shineButton"
    >
      <FcGoogle size={22} />
      <span>Continue with Google</span>
    </button>
  );
};

export default LoginGoogle;
