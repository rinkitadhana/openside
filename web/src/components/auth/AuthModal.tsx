import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FcGoogle } from "react-icons/fc";
import {
  MdLockOutline,
  MdOutlineVisibility,
  MdOutlineVisibilityOff,
} from "react-icons/md";

import { useAuth } from "@/hooks/useAuth";

export type AuthMode = "signin" | "signup";

interface AuthModalProps {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  forceLight?: boolean;
}

const inputClass =
  "h-12 w-full rounded-lg border border-border bg-background px-4 text-base outline-none placeholder:text-foreground/40 focus:border-foreground/30";

const AuthModal = ({
  open,
  mode,
  onModeChange,
  onClose,
  forceLight = false,
}: AuthModalProps) => {
  const {
    loginWithGoogle,
    signInWithEmail,
    startEmailSignup,
    resendEmailVerification,
    verifyEmailCode,
    sendPasswordResetCode,
    resetPassword,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Signup code-verification phase.
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Forgot-password phase.
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const resetState = () => {
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setCodeSent(false);
    setCode("");
    setForgotPassword(false);
    setResetCodeSent(false);
    setResetCode("");
    setNewPassword("");
    setResetError(null);
  };

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Reset transient state whenever the modal is dismissed.
  useEffect(() => {
    if (!open) resetState();
  }, [open]);

  const switchMode = (next: AuthMode) => {
    if (next === mode) return;
    resetState();
    onModeChange(next);
  };

  const handleGoogle = async () => {
    try {
      await loginWithGoogle();
    } catch {
      // Authentication errors are handled by the auth provider.
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);

    const result =
      mode === "signin"
        ? await signInWithEmail(email.trim(), password)
        : await startEmailSignup(email.trim(), password);

    if (result.ok && result.status === "verify_code") {
      setCodeSent(true);
    }

    setIsSubmitting(false);
  };

  const handleVerifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isVerifying || code.trim().length < 6) return;

    setIsVerifying(true);
    await verifyEmailCode(code.trim());
    setIsVerifying(false);
  };

  const handleResendCode = async () => {
    if (isResending) return;

    setIsResending(true);
    const result = await resendEmailVerification(email.trim(), password);
    if (result.ok && result.status === "verify_code") setCodeSent(true);
    setIsResending(false);
  };

  const handleSendResetCode = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (isSendingReset || !email.trim()) return;

    setIsSendingReset(true);
    setResetError(null);
    const result = await sendPasswordResetCode(email.trim());
    if (result.ok) {
      setResetCodeSent(true);
    } else {
      setResetError(result.message);
    }
    setIsSendingReset(false);
  };

  const handleResetPassword = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (isResettingPassword || resetCode.trim().length < 6 || !newPassword) {
      return;
    }

    setIsResettingPassword(true);
    setResetError(null);
    const result = await resetPassword(resetCode.trim(), newPassword);
    if (!result.ok) setResetError(result.message);
    setIsResettingPassword(false);
  };

  const isSignup = mode === "signup";

  const heading = forgotPassword
    ? resetCodeSent
      ? "Set a new password"
      : "Reset your password"
    : codeSent
      ? "Verify your email"
      : isSignup
        ? "Create your account"
        : "Welcome back";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(event) => event.stopPropagation()}
            className={`relative w-full max-w-[420px] rounded-xl p-7 shadow-2xl shadow-black/20 sm:p-8 ${
              forceLight ? "bg-[#ffffff]" : "bg-background dark:bg-black"
            }`}
          >
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {heading}
            </h2>

            {forgotPassword ? (
              resetCodeSent ? (
                <form
                  className="mt-6 flex w-full flex-col gap-4"
                  onSubmit={handleResetPassword}
                >
                  <div>
                    <label
                      htmlFor="reset-code"
                      className="mb-1.5 block text-sm font-semibold text-foreground"
                    >
                      Code
                    </label>
                    <input
                      id="reset-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={resetCode}
                      onChange={(e) =>
                        setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      className={`${inputClass} tracking-[0.3em] placeholder:tracking-normal`}
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="new-password"
                      className="mb-1.5 block text-sm font-semibold text-foreground"
                    >
                      New password
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </div>
                  {resetError && (
                    <p className="text-sm text-red-500">{resetError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={
                      isResettingPassword ||
                      resetCode.trim().length < 6 ||
                      !newPassword
                    }
                    className="mt-1 flex h-12 w-full items-center justify-center rounded-lg bg-[#131313] px-4 text-base font-semibold text-white transition-colors duration-200 hover:bg-[#131313]/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResettingPassword ? "Resetting..." : "Reset password"}
                  </button>
                </form>
              ) : (
                <form
                  className="mt-6 flex w-full flex-col gap-4"
                  onSubmit={handleSendResetCode}
                >
                  <div>
                    <label
                      htmlFor="forgot-email"
                      className="mb-1.5 block text-sm font-semibold text-foreground"
                    >
                      Email
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                      required
                      autoFocus
                    />
                  </div>
                  {resetError && (
                    <p className="text-sm text-red-500">{resetError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={isSendingReset || !email.trim()}
                    className="mt-1 flex h-12 w-full items-center justify-center rounded-lg bg-[#131313] px-4 text-base font-semibold text-white transition-colors duration-200 hover:bg-[#131313]/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSendingReset ? "Sending..." : "Send code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotPassword(false);
                      setResetError(null);
                    }}
                    className="text-center text-sm font-semibold text-foreground/70 underline-offset-4 hover:underline"
                  >
                    Back to sign in
                  </button>
                </form>
              )
            ) : codeSent ? (
              <form
                className="mt-6 flex w-full flex-col gap-3"
                onSubmit={handleVerifyCode}
              >
                <p className="text-sm text-foreground/70">
                  Sent to{" "}
                  <span className="font-medium text-foreground">
                    {email.trim()}
                  </span>
                </p>
                <label className="flex h-12 items-center gap-3 rounded-lg border border-border bg-background px-4 text-sm">
                  <MdLockOutline className="size-5 text-foreground" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="Verification code"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="h-full min-w-0 flex-1 bg-transparent tracking-[0.3em] outline-none placeholder:tracking-normal placeholder:text-foreground/50"
                    required
                    autoFocus
                  />
                </label>
                <button
                  type="submit"
                  disabled={isVerifying || code.trim().length < 6}
                  className="mt-1 flex h-12 w-full items-center justify-center rounded-lg bg-[#131313] px-4 text-base font-semibold text-white transition-colors duration-200 hover:bg-[#131313]/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isVerifying ? "Verifying..." : "Verify & Continue"}
                </button>
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isResending}
                    className="font-semibold text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResending ? "Sending..." : "Resend code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeSent(false);
                      setCode("");
                    }}
                    className="text-foreground/70 underline-offset-4 hover:underline"
                  >
                    Use a different email
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="mt-6 flex w-full rounded-lg bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className={`flex-1 rounded-md py-2.5 text-sm font-semibold transition-colors ${
                      !isSignup
                        ? "bg-background text-foreground shadow-sm"
                        : "text-foreground/50 hover:text-foreground"
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className={`flex-1 rounded-md py-2.5 text-sm font-semibold transition-colors ${
                      isSignup
                        ? "bg-background text-foreground shadow-sm"
                        : "text-foreground/50 hover:text-foreground"
                    }`}
                  >
                    Sign up
                  </button>
                </div>

                <div className="mt-5 flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={handleGoogle}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-semibold transition duration-200 hover:bg-primary"
                  >
                    <FcGoogle size={20} />
                    <span>Continue with Google</span>
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
                      Or
                    </p>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <form
                    className="flex w-full flex-col gap-4"
                    onSubmit={handleSubmit}
                  >
                    <div>
                      <label
                        htmlFor="email"
                        className="mb-1.5 block text-sm font-semibold text-foreground"
                      >
                        Email
                      </label>
                      <input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="password"
                        className="mb-1.5 block text-sm font-semibold text-foreground"
                      >
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={`${inputClass} pr-11`}
                          required
                        />
                        <button
                          type="button"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                          onClick={() => setShowPassword((current) => !current)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/50 transition-colors hover:text-foreground"
                        >
                          {showPassword ? (
                            <MdOutlineVisibilityOff className="size-5" />
                          ) : (
                            <MdOutlineVisibility className="size-5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {!isSignup && (
                      <button
                        type="button"
                        onClick={() => setForgotPassword(true)}
                        className="-mt-2 self-end text-sm text-foreground/60 underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || !email.trim() || !password}
                      className="mt-1 flex h-12 w-full items-center justify-center rounded-lg bg-[#131313] px-4 text-base font-semibold text-white transition-colors duration-200 hover:bg-[#131313]/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting
                        ? isSignup
                          ? "Creating account..."
                          : "Signing in..."
                        : isSignup
                          ? "Sign up"
                          : "Sign in"}
                    </button>
                  </form>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
