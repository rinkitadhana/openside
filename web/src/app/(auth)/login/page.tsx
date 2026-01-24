import CopyrightBar from "@/components/shared/CopyrightBar";
import LoginWrapper from "@/components/auth/LoginWrapper";
import LoginGoogle from "@/components/auth/LoginGoogle";
import LoginContent from "@/components/auth/LoginContent";
import LoginBack from "@/components/auth/LoginBack";
import LoginLogo from "@/components/auth/LoginLogo";
import LoginUsers from "@/components/auth/LoginUsers";
import LoginImage from "@/components/auth/LoginImage";
import AuthRedirect from "@/components/shared/AuthRedirect";

const Login = () => {
  return (
    <AuthRedirect>
      <LoginWrapper>
        <div className="flex flex-row p-8 gap-6 h-full">
          <div className="flex flex-1 flex-col justify-between">
            <div className="flex flex-1 flex-col gap-9">
              <LoginLogo />
              <LoginUsers />
              <LoginContent />
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

export default Login;
