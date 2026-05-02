import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { MdEmail, MdLockOutline } from "react-icons/md";

const LoginEmail = () => {
  const { loginWithEmailPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <label className="flex h-11 items-center gap-3 rounded-[14px] border border-call-border bg-call-primary px-3.5 text-sm transition-all duration-200 focus-within:border-foreground/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-foreground/10">
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
      <label className="flex h-11 items-center gap-3 rounded-[14px] border border-call-border bg-call-primary px-3.5 text-sm transition-all duration-200 focus-within:border-foreground/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-foreground/10">
        <MdLockOutline className="size-5 text-secondary-text" />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-secondary-text"
          required
        />
      </label>
      {error && (
        <div className="w-full rounded-[14px] border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-red-500 text-xs">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="h-11 w-full rounded-[14px] bg-primary px-3.5 text-sm font-semibold text-primary-text transition-colors duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Signing in..." : "Continue with Email"}
      </button>
    </form>
  );
};

export default LoginEmail;
