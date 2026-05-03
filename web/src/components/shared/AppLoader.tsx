import { useMemo } from "react";

interface AppLoaderProps {
  overlay?: boolean;
}

const loaderGifs = [
  "/loaders/gutsy-running-right.gif",
  "/loaders/goku-running-right.gif",
  "/loaders/clawd-running-right.gif",
  "/loaders/rubick-running-right.gif",
  "/loaders/dario-running-right.gif",
  "/loaders/mini-sama-running-right.gif",
];

const AppLoader = ({ overlay = false }: AppLoaderProps) => {
  const loaderGif = useMemo(
    () => loaderGifs[Math.floor(Math.random() * loaderGifs.length)],
    []
  );

  const containerClassName = overlay
    ? "absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-call-background/95 backdrop-blur-sm"
    : "flex min-h-screen flex-col items-center justify-center gap-3 bg-call-background";

  return (
    <div className={containerClassName}>
      <img
        src={loaderGif}
        alt=""
        className="h-24 w-24 object-contain"
        aria-hidden="true"
      />
      <p className="animate-pulse text-base font-medium text-foreground">
        Loading...
      </p>
    </div>
  );
};

export default AppLoader;
