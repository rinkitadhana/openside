"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const Main = () => {
  const router = useRouter();

  useEffect(() => {
    router.push("/dashboard/home");
  }, [router]);

  return null;
};

export default Main;
