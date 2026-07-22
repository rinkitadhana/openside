import ScreenRecorderScreen from "@/components/ScreenRecorder/ScreenRecorderScreen";

const ScreenRecorderPage = () => {
  return (
    <section className="bg-background h-screen flex items-center">
      <div className="relative flex-1 flex flex-col items-center justify-center h-full max-w-full overflow-hidden">
        <div className="w-full flex-1 min-h-0">
          <ScreenRecorderScreen />
        </div>
      </div>
    </section>
  );
};

export default ScreenRecorderPage;
