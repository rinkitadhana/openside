const LayoutWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="relative w-full h-full max-w-[1200px] md:mx-auto mx-4">
      {children}
    </div>
  );
};

export default LayoutWrapper;
