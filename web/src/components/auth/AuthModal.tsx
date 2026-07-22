import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FcGoogle } from "react-icons/fc";
import {
  MdEmail,
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

  const resetState = () => {
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setCodeSent(false);
    setCode("");
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

  const isSignup = mode === "signup";

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
            className={`relative w-full max-w-[400px] rounded-2xl border border-border p-5 shadow-2xl shadow-foreground/10 sm:p-6 ${
              forceLight ? "bg-[#ffffff]" : "bg-background dark:bg-black"
            }`}
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <h2 className="text-xl font-medium text-foreground">
                {codeSent
                  ? "Verify your email"
                  : isSignup
                    ? "Create your account"
                    : "Welcome back"}
              </h2>
            </div>

            {codeSent ? (
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
                <label className="flex h-11 items-center gap-3 rounded-[14px] border border-border bg-background px-3.5 text-sm">
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
                  className="mt-1 w-full rounded-[14px] bg-foreground px-3.5 py-2.5 text-sm font-semibold text-background transition-colors duration-200 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleGoogle}
                    className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-background px-3.5 py-3 text-sm font-semibold transition duration-200 hover:bg-primary"
                  >
                    <FcGoogle size={22} />
                    <span>Continue with Google</span>
                  </button>

                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-border" />
                    <p className="text-xs text-foreground/60">
                      Or continue with
                    </p>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <form
                    className="flex w-full flex-col gap-3"
                    onSubmit={handleSubmit}
                  >
                    <label className="flex h-11 items-center gap-3 rounded-[14px] border border-border bg-background px-3.5 text-sm">
                      <MdEmail className="size-4 text-foreground/50" />
                      <input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-foreground/50"
                        required
                      />
                    </label>
                    <label className="flex h-11 items-center gap-3 rounded-[14px] border border-border bg-background px-3.5 text-sm">
                      <MdLockOutline className="size-4 text-foreground/50" />
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-foreground/50"
                        required
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword((current) => !current)}
                        className="text-foreground/60 transition-colors hover:text-foreground"
                      >
                        {showPassword ? (
                          <MdOutlineVisibilityOff className="size-5" />
                        ) : (
                          <MdOutlineVisibility className="size-5" />
                        )}
                      </button>
                    </label>
                    <button
                      type="submit"
                      disabled={isSubmitting || !email.trim() || !password}
                      className="mt-1 w-full rounded-[14px] bg-foreground px-3.5 py-2.5 text-sm font-semibold text-background transition-colors duration-200 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
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

                <p className="mt-6 text-center text-sm text-foreground/70">
                  {isSignup
                    ? "Already have an account? "
                    : "Don't have an account? "}
                  <button
                    type="button"
                    onClick={() => switchMode(isSignup ? "signin" : "signup")}
                    className="font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    {isSignup ? "Sign in" : "Sign up"}
                  </button>
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
