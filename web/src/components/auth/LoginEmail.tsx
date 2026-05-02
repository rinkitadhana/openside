import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import toast from "react-hot-toast";
import {
  MdEmail,
  MdLockOutline,
  MdOutlineVisibility,
  MdOutlineVisibilityOff,
} from "react-icons/md";

const LoginEmail = () => {
  const { loginWithEmailPassword, resendEmailVerification } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setVerificationPending(false);

    const result = await loginWithEmailPassword(email.trim(), password);

    if (result.ok && result.status === "verify_email") {
      setVerificationPending(true);
      toast.success("Check your email to verify your account, then log in.");
    } else if (!result.ok) {
      toast.error(result.message || "Unable to sign in with email.");
    }

    setIsSubmitting(false);
  };

  const handleResendVerification = async () => {
    if (isResending) return;

    setIsResending(true);

    const result = await resendEmailVerification(email.trim(), password);

    if (result.ok && result.status === "verify_email") {
      setVerificationPending(true);
      toast.success("Verification email sent again.");
    } else if (!result.ok) {
      toast.error(result.message || "Unable to resend verification email.");
    }

    setIsResending(false);
  };

  return (
    <form className="flex w-full flex-col gap-3" onSubmit={handleSubmit}>
      <label className="flex h-11 items-center gap-3 rounded-[14px] border border-call-border bg-call-primary px-3.5 text-sm transition-colors duration-200 focus-within:bg-background">
        <MdEmail className="size-5 text-secondary-text" />
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-secondary-text"
          required
        />
      </label>
      <label className="flex h-11 items-center gap-3 rounded-[14px] border border-call-border bg-call-primary px-3.5 text-sm transition-colors duration-200 focus-within:bg-background">
        <MdLockOutline className="size-5 text-secondary-text" />
        <input
          type={showPassword ? "text" : "password"}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-secondary-text"
          required
        />
        <button
          type="button"
          aria-label={showPassword ? "Hide password" : "Show password"}
          onClick={() => setShowPassword((current) => !current)}
          className="text-secondary-text transition-colors duration-200 hover:text-foreground"
        >
          {showPassword ? (
            <MdOutlineVisibilityOff className="size-5" />
          ) : (
            <MdOutlineVisibility className="size-5" />
          )}
        </button>
      </label>
      {verificationPending && (
        <button
          type="button"
          onClick={handleResendVerification}
          disabled={isResending}
          className="self-start text-xs font-semibold text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isResending ? "Sending..." : "Send verification email again"}
        </button>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 w-full rounded-[14px] bg-primary px-3.5 py-3 text-sm font-semibold text-primary-text transition-colors duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Signing in..." : "Continue with Email"}
      </button>
    </form>
  );
};

export default LoginEmail;
