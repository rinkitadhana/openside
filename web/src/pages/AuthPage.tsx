import CopyrightBar from "@/components/shared/CopyrightBar";
import LoginWrapper from "@/components/auth/LoginWrapper";
import LoginGoogle from "@/components/auth/LoginGoogle";
import LoginContent from "@/components/auth/LoginContent";
import LoginBack from "@/components/auth/LoginBack";
import LoginUsers from "@/components/auth/LoginUsers";
import LoginImage from "@/components/auth/LoginImage";
import LoginEmail from "@/components/auth/LoginEmail";
import AuthRedirect from "@/components/shared/AuthRedirect";
import PageTitle from "@/components/shared/PageTitle";

const AuthPage = () => {
  return (
    <AuthRedirect>
      <PageTitle title="Auth | Openside" />
      <LoginWrapper>
        <div className="flex flex-row p-8 gap-6 h-full">
          <div className="flex flex-1 flex-col justify-between">
            <div className="flex flex-1 flex-col gap-9">
              <div className="flex items-start gap-3">
                <LoginBack />
                <div className="flex flex-col gap-0.5">
                  <h1 className="mb-1 text-3xl font-semibold">Openside</h1>
                  <p className="text-sm text-secondary-text">
                    High-quality video calls for creators and storytellers.
                  </p>
                </div>
              </div>
              <LoginUsers />
              <LoginContent />
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
    </AuthRedirect>
  );
};

export default AuthPage;
