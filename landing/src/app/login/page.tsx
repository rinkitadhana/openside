import CopyrightBar from "@/components/shared/CopyrightBar";
import LoginWrapper from "@/components/Login/LoginWrapper";
import LoginGoogle from "@/components/Login/LoginGoogle";
import LoginContent from "@/components/Login/LoginContent";
import LoginBack from "@/components/Login/LoginBack";
import LoginLogo from "@/components/Login/LoginLogo";
import LoginUsers from "@/components/Login/LoginUsers";
import LoginImage from "@/components/Login/LoginImage";
import AuthRedirect from "@/components/Login/AuthRedirect";

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
