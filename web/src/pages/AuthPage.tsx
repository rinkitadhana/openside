import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import CopyrightBar from "@/components/shared/CopyrightBar";
import LoginWrapper from "@/components/auth/LoginWrapper";
import LoginGoogle from "@/components/auth/LoginGoogle";
import LoginBack from "@/components/auth/LoginBack";
import LoginUsers from "@/components/auth/LoginUsers";
import LoginImage from "@/components/auth/LoginImage";
import LoginEmail from "@/components/auth/LoginEmail";
import AppLoader from "@/components/shared/AppLoader";
import PageTitle from "@/components/shared/PageTitle";
import { useGetMe } from "@/hooks/useUserQuery";

const authQuotes = [
  "Start creating. Start being heard",
  "Your camera is your stage",
  "Hit record. Share your story",
  "Speak up. Create something real",
  "Your voice deserves an audience",
  "Press record. Make it count",
  "Create. Speak. Inspire",
  "Turn ideas into powerful content",
  "Start talking. Start creating",
  "Record your voice, shape stories",
  "The camera is waiting",
  "Speak your story into existence",
  "Create content that speaks louder",
  "Your next story starts now",
  "One recording can change everything",
  "Share your voice with confidence",
  "Speak on camera, own it",
  "Create boldly. Speak freely",
];

const AuthPage = () => {
  const { data: user, isLoading } = useGetMe();
  const navigate = useNavigate();
  const [authQuote] = useState(
    () => authQuotes[Math.floor(Math.random() * authQuotes.length)]
  );

  useEffect(() => {
    if (!isLoading && user) {
      navigate("/dashboard/home", { replace: true });
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return <AppLoader />;
  }

  if (user) {
    return null;
  }

  return (
    <>
      <PageTitle title="Auth | Openside" />
      <LoginWrapper>
        <div className="flex flex-row p-8 gap-6 h-full">
          <div className="flex flex-1 flex-col justify-between">
            <div className="flex flex-1 flex-col gap-9">
              <div className="flex items-center gap-3">
                <LoginBack />
                <div className="flex flex-col gap-0.5">
                  <h1 className="text-2xl font-medium">Get Started</h1>
                </div>
              </div>
              <LoginUsers />
              <p className="max-w-[420px] border-l border-secondary-text/50 pl-4 text-xl font-medium italic text-secondary-text">
                "{authQuote}"
              </p>
              <div className="flex w-full max-w-[420px] flex-col gap-3">
                <LoginEmail />
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-primary-border" />
                  <p className="text-xs text-secondary-text">or</p>
                  <div className="h-px flex-1 bg-primary-border" />
                </div>
                <LoginGoogle />
              </div>
            </div>
            <CopyrightBar />
          </div>
          <div>
            <LoginImage />
          </div>
        </div>
      </LoginWrapper>
    </>
  );
};

export default AuthPage;
