import LayoutWrapper from "@/shared/layout/LayoutWrapper";
import { FaSquareXTwitter, FaGithub } from "react-icons/fa6";
import Link from "next/link";
import React from "react";
import { FaLinkedin } from "react-icons/fa";
import AsapLogo from "../ui/AsapLogo";

const LandingFooter = () => {
  return (
    <LayoutWrapper>
      <div className="border-x border-primary-border p-4">
        <div className="flex  flex-col min-h-[200px]  shadow-md shadow-primary-shadow justify-between w-full border border-primary-border rounded-xl p-8 bg-secondary">
          <div className="flex gap-8">
            <div className="flex flex-col gap-2 w-[28%]">
              <AsapLogo icon name />
              <p className=" font-inter text-sm text-secondary-text">
                Asap is an AI-native video calling app with built-in local
                recording.
              </p>
              <div className="flex items-center gap-2 my-2">
                <Link
                  href="https://linkedin.com"
                  className="hover:opacity-50 duration-200"
                >
                  <FaLinkedin size={22} />
                </Link>
                <Link
                  href="https://github.com"
                  className="hover:opacity-50 duration-200"
                >
                  <FaGithub size={22} />
                </Link>
                <Link
                  href="https://twitter.com"
                  className="hover:opacity-50 duration-200"
                >
                  <FaSquareXTwitter size={22} />
                </Link>
              </div>
              <div className="flex items-center gap-2 text-xs my-2">
                Need Help?{" "}
                <a className="text-blue-500 cursor-pointer">@contact</a>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <h1 className="text-base font-semibold">Links</h1>
              <div className="flex flex-col gap-0.5 text-secondary-text text-sm">
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Home
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  About
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Contact
                </Link>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <h1 className="text-base font-semibold">Solutions</h1>
              <div className="flex flex-col gap-0.5 text-secondary-text text-sm">
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 1
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 2
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 3
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 4
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 5
                </Link>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <h1 className="text-base font-semibold">Use Cases</h1>
              <div className="flex flex-col gap-0.5 text-secondary-text text-sm">
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 1
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 2
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 3
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 4
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 5
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 6
                </Link>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <h1 className="text-base font-semibold">Resources</h1>
              <div className="flex flex-col gap-0.5 text-secondary-text text-sm">
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 1
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 2
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 3
                </Link>
                <Link
                  href="/"
                  className="font-inter hover:opacity-50 duration-200"
                >
                  Sample 4
                </Link>
              </div>
            </div>
          </div>
          <div className="w-full h-[1px] bg-primary-border my-4" />
          <div className="flex items-center justify-between">
            <p className="text-secondary-text text-sm">
              © 2025 Asap. All rights reserved.
            </p>
            <div className="flex items-center gap-2 text-secondary-text text-xs">
              <Link
                href="/"
                className="font-inter hover:opacity-50 duration-200"
              >
                Privacy Policy
              </Link>
              <Link
                href="/"
                className="font-inter hover:opacity-50 duration-200"
              >
                Terms of Service
              </Link>
              <Link
                href="/"
                className="font-inter hover:opacity-50 duration-200"
              >
                Cookie Settings
              </Link>
            </div>
          </div>
        </div>
      </div>
    </LayoutWrapper>
  );
};

export default LandingFooter;
