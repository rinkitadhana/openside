import { useGetMe } from "@/hooks/useUserQuery";

const greetingForHour = (hour: number) => {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const DashboardWelcome = () => {
  const { data: user } = useGetMe();
  const firstName = user?.name?.trim().split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-2">
      <h1 className="text-2xl font-medium tracking-tight text-foreground">
        {greetingForHour(new Date().getHours())}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mt-1 text-sm text-fg-subtle">
        Ready to record? Start a new session or catch up on what's already
        in your library.
      </p>
    </div>
  );
};

export default DashboardWelcome;
