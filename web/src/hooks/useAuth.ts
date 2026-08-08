"use client";
import {
  useAuth as useClerkAuth,
  useClerk,
  useSignIn,
  useSignUp,
} from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

type EmailAuthResult =
  | { ok: true; status: "signed_in" }
  | { ok: true; status: "verify_email"; message: string }
  | { ok: true; status: "verify_code"; message: string }
  | { ok: false; message: string };

type ClerkErrorInfo = {
  code?: string;
  message?: string;
};

const getEmailVerificationRedirectUrl = () =>
  `${window.location.origin}/?verified=email`;

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

const isSessionExists = (code?: string) => code === "session_exists";

export function useAuth() {
  const { signIn, isLoaded, setActive } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
  const clerk = useClerk();
  const { signOut } = clerk;
  const { isSignedIn } = useClerkAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const goToDashboard = () => {
    navigate("/dashboard/home", { replace: true });
  };

  const loginWithGoogle = async () => {
    if (!isLoaded || !signIn) return;

    if (isSignedIn) {
      goToDashboard();
      return;
    }

    await signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: `${window.location.origin}/dashboard/home`,
    });
  };

  // setActive()'s promise can resolve before Clerk's client-side session
  // state (clerk.session/clerk.user) has actually finished propagating - in
  // production this uses a custom Clerk domain that syncs cookies across an
  // extra round trip, unlike the shared dev domain. Navigating too early
  // races ProtectedRoute, which reads a still-stale "signed out" state and
  // bounces straight back to "/". Poll the live Clerk client (not a React
  // snapshot) until the session is actually active before routing.
  const waitForActiveSession = async (
    timeoutMs = 4000,
    intervalMs = 50
  ): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (clerk.session?.status === "active" && clerk.user) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  };

  const activateSession = async (sessionId: string | null) => {
    if (!sessionId || !setActive) return false;

    await setActive({ session: sessionId });
    await waitForActiveSession();
    await queryClient.invalidateQueries({ queryKey: ["get-me"] });
    navigate("/dashboard/home", { replace: true });
    return true;
  };

  // Email the user a 6-digit verification code to finish signup. The code is
  // confirmed later via verifyEmailCode().
  const sendSignupVerificationCode = async () => {
    if (!signUp) return;
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
  };

  const startEmailSignup = async (
    email: string,
    password: string
  ): Promise<EmailAuthResult> => {
    if (!signUp) {
      return { ok: false, message: "Auth not ready yet." };
    }

    if (isSignedIn) {
      goToDashboard();
      return { ok: true, status: "signed_in" };
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
        await sendSignupVerificationCode();
        return {
          ok: true,
          status: "verify_code",
          message:
            "We sent a 6-digit code to your email. Enter it below to finish signing up.",
        };
      }

      return {
        ok: false,
        message: "Signup needs more information before it can continue.",
      };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);

      if (isSessionExists(clerkError.code)) {
        goToDashboard();
        return { ok: true, status: "signed_in" };
      }

      if (
        isExistingIdentifier(clerkError.code) &&
        signUp.emailAddress?.toLowerCase() === email.toLowerCase() &&
        signUp.unverifiedFields.includes("email_address")
      ) {
        await sendSignupVerificationCode();
        return {
          ok: true,
          status: "verify_code",
          message:
            "That email is already awaiting verification. We sent a new code to your email.",
        };
      }

      return {
        ok: false,
        message: clerkError.message || "Unable to create an account.",
      };
    }
  };

  // Strict sign-in: never auto-creates an account. If the email isn't
  // registered (or the password is wrong) it returns an error to surface in a
  // toast - used by the sign-in tab where signup must stay a separate action.
  const signInWithEmail = async (
    email: string,
    password: string
  ): Promise<EmailAuthResult> => {
    if (!isLoaded || !signIn || !setActive) {
      return { ok: false, message: "Auth not ready yet." };
    }

    if (isSignedIn) {
      goToDashboard();
      return { ok: true, status: "signed_in" };
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

      return {
        ok: false,
        message: "Additional verification is required for this sign-in.",
      };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);

      if (isSessionExists(clerkError.code)) {
        goToDashboard();
        return { ok: true, status: "signed_in" };
      }

      if (isIdentifierNotFound(clerkError.code)) {
        return {
          ok: false,
          message: "No account found with that email and password.",
        };
      }

      return {
        ok: false,
        message: clerkError.message || "Email sign-in failed.",
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

    if (isSignedIn) {
      goToDashboard();
      return { ok: true, status: "signed_in" };
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
        const emailFactor = signInAttempt.supportedFirstFactors?.find(
          (factor) => factor.strategy === "email_link"
        );

        if (emailFactor && "emailAddressId" in emailFactor) {
          const { startEmailLinkFlow } = signInAttempt.createEmailLinkFlow();

          void startEmailLinkFlow({
            emailAddressId: emailFactor.emailAddressId,
            redirectUrl: getEmailVerificationRedirectUrl(),
          })
            .then(async (attempt) => {
              if (attempt.status === "complete") {
                await activateSession(attempt.createdSessionId);
              }
            })
            .catch((err) => {
              console.warn("[auth] sign-in email link flow failed", err);
            });

          return {
            ok: true,
            status: "verify_email",
            message:
              "We sent you a verification link. Open it from your email to finish logging in.",
          };
        }

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

      if (isSessionExists(clerkError.code)) {
        goToDashboard();
        return { ok: true, status: "signed_in" };
      }

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
      await sendSignupVerificationCode();
      return {
        ok: true,
        status: "verify_code",
        message: "We sent a new code to your email.",
      };
    }

    return startEmailSignup(email, password);
  };

  // Confirm the 6-digit code the user received and, on success, sign them in.
  const verifyEmailCode = async (code: string): Promise<EmailAuthResult> => {
    if (!isSignUpLoaded || !signUp) {
      return { ok: false, message: "Auth not ready yet." };
    }

    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code });

      if (attempt.status === "complete") {
        await activateSession(attempt.createdSessionId);
        return { ok: true, status: "signed_in" };
      }

      return { ok: false, message: "That code didn't work. Please try again." };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);
      return {
        ok: false,
        message: clerkError.message || "Invalid or expired verification code.",
      };
    }
  };

  // Forgot-password flow: email a 6-digit code, then confirm it together with
  // the new password. Mirrors the signup verify-code flow above.
  const sendPasswordResetCode = async (email: string): Promise<EmailAuthResult> => {
    if (!isLoaded || !signIn) {
      return { ok: false, message: "Auth not ready yet." };
    }

    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email,
      });
      return {
        ok: true,
        status: "verify_code",
        message: "We sent a 6-digit code to your email.",
      };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);

      if (isIdentifierNotFound(clerkError.code)) {
        return {
          ok: false,
          message: "No account found with that email.",
        };
      }

      return {
        ok: false,
        message: clerkError.message || "Unable to send a reset code.",
      };
    }
  };

  const resetPassword = async (
    code: string,
    password: string
  ): Promise<EmailAuthResult> => {
    if (!isLoaded || !signIn || !setActive) {
      return { ok: false, message: "Auth not ready yet." };
    }

    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password,
      });

      if (attempt.status === "complete") {
        await activateSession(attempt.createdSessionId);
        return { ok: true, status: "signed_in" };
      }

      return { ok: false, message: "That code didn't work. Please try again." };
    } catch (error: unknown) {
      const clerkError = getClerkError(error);
      return {
        ok: false,
        message: clerkError.message || "Invalid or expired code.",
      };
    }
  };

  const logout = async () => {
    // Leave the protected route first so ProtectedRoute never re-runs its
    // auth check (and flashes the "Authenticating..." loader) while signOut
    // clears the session.
    navigate("/", { replace: true });
    queryClient.removeQueries({ queryKey: ["get-me"] });
    // Pass a callback so Clerk does an in-app (router) navigation instead of a
    // full-page redirect to afterSignOutUrl - otherwise "/" loads twice.
    await signOut(() => navigate("/", { replace: true }));
  };

  return {
    loginWithGoogle,
    signInWithEmail,
    startEmailSignup,
    loginWithEmailPassword,
    resendEmailVerification,
    verifyEmailCode,
    sendPasswordResetCode,
    resetPassword,
    logout,
  };
}
