import { LuLoaderCircle } from "react-icons/lu";

interface AppLoaderProps {
  overlay?: boolean;
  message?: string;
}

const AppLoader = ({ overlay = false, message = "Loading..." }: AppLoaderProps) => {
  const containerClassName = overlay
    ? "absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background"
    : "flex min-h-screen flex-col items-center justify-center gap-3 bg-background";

  return (
    <div className={containerClassName}>
      <LuLoaderCircle
        className="h-7 w-7 animate-spin text-foreground"
        aria-hidden="true"
      />
      <p className="shimmer-text text-base font-medium">{message}</p>
    </div>
  );
};

export default AppLoader;
