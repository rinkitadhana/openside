import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  MdEmail,
  MdLockOutline,
  MdOutlineVisibility,
  MdOutlineVisibilityOff,
} from "react-icons/md";

const LoginEmail = () => {
  const { loginWithEmailPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await loginWithEmailPassword(email.trim(), password);

    if (!result.ok) {
      setError(result.message || "Unable to sign in with email.");
    }

    setIsSubmitting(false);
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
      {error && (
        <div className="w-full rounded-[14px] border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-red-500 text-xs">{error}</p>
        </div>
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
