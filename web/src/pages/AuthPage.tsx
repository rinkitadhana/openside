import CopyrightBar from "@/components/shared/CopyrightBar";
import LoginWrapper from "@/components/auth/LoginWrapper";
import LoginGoogle from "@/components/auth/LoginGoogle";
import LoginContent from "@/components/auth/LoginContent";
import LoginBack from "@/components/auth/LoginBack";
import LoginLogo from "@/components/auth/LoginLogo";
import LoginUsers from "@/components/auth/LoginUsers";
import LoginImage from "@/components/auth/LoginImage";
import LoginEmail from "@/components/auth/LoginEmail";
import AuthRedirect from "@/components/shared/AuthRedirect";
import PageTitle from "@/components/shared/PageTitle";

const AuthPage = () => {
  return (
    <AuthRedirect>
      <PageTitle title="Auth | Asap" />
      <LoginWrapper>
        <div className="flex flex-row p-8 gap-6 h-full">
          <div className="flex flex-1 flex-col justify-between">
            <div className="flex flex-1 flex-col gap-9">
              <LoginLogo />
              <LoginUsers />
              <LoginContent />
              <LoginEmail />
              <div className="flex items-center gap-3 w-full max-w-[420px]">
                <div className="h-px flex-1 bg-primary-border" />
                <p className="text-xs text-secondary-text">or</p>
                <div className="h-px flex-1 bg-primary-border" />
              </div>
              <div className="flex flex-row gap-2">
                <LoginBack />
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
    </AuthRedirect>
  );
};

export default AuthPage;
