"use client";
import { useClerk, useSignIn, useSignUp } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

type EmailAuthResult =
  | { ok: true; status: "signed_in" }
  | { ok: true; status: "verify_email"; message: string }
  | { ok: false; message: string };

type ClerkErrorInfo = {
  code?: string;
  message?: string;
};

const getEmailVerificationRedirectUrl = () =>
  `${window.location.origin}/auth?verified=email`;

const getClerkError = (error: unknown): ClerkErrorInfo => {
  if (!error || typeof error !== "object" || !("errors" in error)) {
    return {};
  }

  const errors = (
    error as {
      errors?: Array<{ code?: string; message?: string; longMessage?: string }>;
    }
  ).errors;

  return {
    code: errors?.[0]?.code,
    message: errors?.[0]?.longMessage || errors?.[0]?.message,
  };
};

const isIdentifierNotFound = (code?: string) =>
  code === "form_identifier_not_found" ||
  code === "form_password_or_identifier_incorrect";

const isExistingIdentifier = (code?: string) =>
  code === "form_identifier_exists" ||
  code === "form_identifier_exists__email_address";

export function useAuth() {
  const { signIn, isLoaded, setActive } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
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

  const activateSession = async (sessionId: string | null) => {
    if (!sessionId || !setActive) return false;

    await setActive({ session: sessionId });
    await queryClient.invalidateQueries({ queryKey: ["get-me"] });
    navigate("/dashboard/home", { replace: true });
    return true;
  };

  const sendSignupVerificationLink = () => {
    if (!signUp || !setActive) return;

    const { startEmailLinkFlow } = signUp.createEmailLinkFlow();

    void startEmailLinkFlow({
      redirectUrl: getEmailVerificationRedirectUrl(),
    })
      .then(async (verificationAttempt) => {
        if (verificationAttempt.status === "complete") {
          await activateSession(verificationAttempt.createdSessionId);
        }
      })
      .catch(() => {
        // The form already shows the pending verification state.
      });
  };

  const startEmailSignup = async (
    email: string,
    password: string
  ): Promise<EmailAuthResult> => {
    if (!signUp) {
      return { ok: false, message: "Auth not ready yet." };
    }

    try {
      const signUpAttempt = await signUp.create({
        emailAddress: email,
        password,
      });

      if (signUpAttempt.status === "complete") {
        await activateSession(signUpAttempt.createdSessionId);
        return { ok: true, status: "signed_in" };
      }

      if (signUpAttempt.unverifiedFields.includes("email_address")) {
        sendSignupVerificationLink();
        return {
          ok: true,
          status: "verify_email",
          message:
            "We sent you a verification link. Open it from your email to finish signup.",
        };
      }

      return {
        ok: false,
        message: "Signup needs more information before it can continue.",
      };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);

      if (
        isExistingIdentifier(clerkError.code) &&
        signUp.emailAddress?.toLowerCase() === email.toLowerCase() &&
        signUp.unverifiedFields.includes("email_address")
      ) {
        sendSignupVerificationLink();
        return {
          ok: true,
          status: "verify_email",
          message:
            "That email is already waiting for verification. We sent the verification link again.",
        };
      }

      return {
        ok: false,
        message: clerkError.message || "Unable to create an account.",
      };
    }
  };

  const loginWithEmailPassword = async (
    email: string,
    password: string
  ): Promise<EmailAuthResult> => {
    if (!isLoaded || !isSignUpLoaded || !signIn || !signUp || !setActive) {
      return { ok: false, message: "Auth not ready yet." };
    }

    try {
      const signInAttempt = await signIn.create({
        strategy: "password",
        identifier: email,
        password,
      });

      if (signInAttempt.status === "complete") {
        await activateSession(signInAttempt.createdSessionId);
        return { ok: true, status: "signed_in" };
      }

      if (signInAttempt.status === "needs_first_factor") {
        return {
          ok: true,
          status: "verify_email",
          message: "Please verify your email before logging in.",
        };
      }

      return {
        ok: false,
        message: "Additional verification is required for this sign-in.",
      };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);

      if (isIdentifierNotFound(clerkError.code)) {
        return startEmailSignup(email, password);
      }

      return {
        ok: false,
        message: clerkError.message || "Email sign-in failed.",
      };
    }
  };

  const resendEmailVerification = async (
    email: string,
    password: string
  ): Promise<EmailAuthResult> => {
    if (!isSignUpLoaded || !signUp) {
      return { ok: false, message: "Auth not ready yet." };
    }

    if (
      signUp.emailAddress?.toLowerCase() === email.toLowerCase() &&
      signUp.unverifiedFields.includes("email_address")
    ) {
      sendSignupVerificationLink();
      return {
        ok: true,
        status: "verify_email",
        message: "We sent the verification link again.",
      };
    }

    return startEmailSignup(email, password);
  };

  const logout = async () => {
    await signOut();
    queryClient.removeQueries({ queryKey: ["get-me"] });
    navigate("/auth", { replace: true });
  };

  return {
    loginWithGoogle,
    loginWithEmailPassword,
    resendEmailVerification,
    logout,
  };
}
