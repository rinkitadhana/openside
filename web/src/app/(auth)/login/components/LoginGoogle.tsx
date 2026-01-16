"use client";
import React from "react";
import { FcGoogle } from "react-icons/fc";
import { useAuth } from "@/shared/hooks/useAuth";
const LoginGoogle = () => {
  const { loginWithGoogle } = useAuth();
  const handleLogin = async () => {
    await loginWithGoogle();
  };
  return (
    <div
      onClick={handleLogin}
      className="select-none flex flex-row items-center gap-2 border w-fit py-2 px-3 hover:bg-primary-hover transition duration-200 cursor-pointer shineButton"
    >
      <FcGoogle size={22} />
      <div>
        <p>Continue with Google</p>
      </div>
    </div>
  );
};

export default LoginGoogle;
