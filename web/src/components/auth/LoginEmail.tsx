import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

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
    <form className="flex flex-col gap-2 w-full max-w-[420px]" onSubmit={handleSubmit}>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-2.5 bg-call-primary border border-call-border rounded-lg text-sm focus:outline-none"
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full px-3 py-2.5 bg-call-primary border border-call-border rounded-lg text-sm focus:outline-none"
        required
      />
      {error && (
        <div className="w-full p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-500 text-xs">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="btn w-full text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Signing in..." : "Continue with Email"}
      </button>
    </form>
  );
};

export default LoginEmail;

