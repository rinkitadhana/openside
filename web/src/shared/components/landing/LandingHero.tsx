import LayoutWrapper from "@/shared/layout/LayoutWrapper";
import React from "react";
import { Disc2 } from "lucide-react";
import Link from "next/link";
import RecordingBadge from "./ui/RecordingBadge";

const LandingHero = () => {
  return (
    <LayoutWrapper>
      <section className=" border-x border-primary-border p-4">
        <div className="h-[700px] flex items-center shadow-md shadow-primary-shadow justify-center border border-secondary-border rounded-xl mt-20 bg-[url('/img/hero.png')] dark:bg-[url('/img/hero-dark.png')] bg-cover bg-center">
          <div className="flex-1 w-full h-full flex flex-col gap-2 items-start justify-center p-10">
            <RecordingBadge />
            <h1 className="text-[4.5rem] font-[950] font-cal leading-[1.05]">
              From Video Call to Podcast in Minutes
            </h1>
            <p className="text-secondary-text font-inter">
              Asap is an AI-native video calling app with built-in local
              recording, perfect for podcasts, content creation, and more. Its
              smart AI tools make every call effortless and productive.
            </p>
            <div className="flex flex-col gap-4 w-full my-4 pr-20 justify-start items-start">
              <Link
                href="/login"
                className="btn w-full font-medium flex gap-2.5 items-center justify-center text-sm"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="17"
                  height="17"
                  viewBox="0 0 48 48"
                >
                  <path
                    fill="#FFC107"
                    d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
                  />
                  <path
                    fill="#FF3D00"
                    d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
                  />
                  <path
                    fill="#4CAF50"
                    d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
                  />
                  <path
                    fill="#1976D2"
                    d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
                  />
                </svg>{" "}
                Sign Up with Google
              </Link>
              <Link
                href="/dashboard/home"
                className="btn-secondary w-full font-medium flex gap-2.5 items-center justify-center text-sm"
              >
                <Disc2 size={17} className="text-red-600" /> Start Recording
                Your Call
              </Link>
              <p className="text-secondary-text w-full font-medium text-center font-inter text-xs">
                No credit card required!
              </p>
            </div>
          </div>
          <div className="flex-1 w-full h-full flex items-center justify-end">
            <div className="w-full h-[400px] border border-secondary-border rounded-l-2xl py-2 pl-2 bg-background">
              <div className="w-full h-full border-y border-l border-secondary-border rounded-l-2xl bg-secondary">
                <div className="w-full h-full flex items-center justify-center "></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </LayoutWrapper>
  );
};

export default LandingHero;
