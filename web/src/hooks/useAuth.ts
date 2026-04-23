"use client";
import { useClerk, useSignIn } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

export function useAuth() {
  const { signIn, isLoaded, setActive } = useSignIn();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const loginWithGoogle = async () => {
    if (!isLoaded || !signIn) return;

    await signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: `${window.location.origin}/dashboard/home`,
    });
  };

  const loginWithEmailPassword = async (email: string, password: string) => {
    if (!isLoaded || !signIn || !setActive) {
      return { ok: false, message: "Auth not ready yet." };
    }

    try {
      const signInAttempt = await signIn.create({
        identifier: email,
        password,
      });

      if (signInAttempt.status === "complete") {
        await setActive({ session: signInAttempt.createdSessionId });
        await queryClient.invalidateQueries({ queryKey: ["get-me"] });
        navigate("/dashboard/home", { replace: true });
        return { ok: true };
      }

      return {
        ok: false,
        message: "Additional verification is required for this sign-in.",
      };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "errors" in error) {
        const errors = (error as { errors?: Array<{ message?: string }> })
          .errors;
        if (errors?.[0]?.message) {
          return { ok: false, message: errors[0].message };
        }
      }
      return { ok: false, message: "Email sign-in failed." };
    }
  };

  const logout = async () => {
    await signOut();
    queryClient.removeQueries({ queryKey: ["get-me"] });
    navigate("/auth", { replace: true });
  };

  return { loginWithGoogle, loginWithEmailPassword, logout };
}
