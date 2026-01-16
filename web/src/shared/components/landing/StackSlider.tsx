"use client";
import React from "react";
import {
  SiNextdotjs,
  SiTailwindcss,
  SiFramer,
  SiGreensock,
  SiPostgresql,
  SiPrisma,
  SiFigma,
  SiTypescript,
  SiReact,
  SiSocketdotio,
  SiVercel,
  SiNodedotjs,
} from "react-icons/si";

const StackSlider = () => {
  // Tech stack data with React icons
  const techStack = [
    {
      name: "Next.js",
      icon: SiNextdotjs,
    },
    {
      name: "React",
      icon: SiReact,
    },
    {
      name: "TypeScript",
      icon: SiTypescript,
    },
    {
      name: "Tailwind CSS",
      icon: SiTailwindcss,
    },
    {
      name: "Framer Motion",
      icon: SiFramer,
    },
    {
      name: "GSAP",
      icon: SiGreensock,
    },
    {
      name: "Node.js",
      icon: SiNodedotjs,
    },
    {
      name: "Socket.io",
      icon: SiSocketdotio,
    },
    {
      name: "PostgreSQL",
      icon: SiPostgresql,
    },
    {
      name: "Prisma",
      icon: SiPrisma,
    },
    {
      name: "Figma",
      icon: SiFigma,
    },
    {
      name: "Vercel",
      icon: SiVercel,
    },
  ];

  // Duplicate the array for seamless infinite scroll
  const duplicatedStack = [...techStack, ...techStack];

  return (
    <div className="relative w-full h-full overflow-hidden flex items-center">
      {/* Left gradient mask */}
      <div className="absolute left-0 top-0 h-full w-40 z-10 bg-gradient-to-r from-background via-background/80 to-transparent pointer-events-none" />

      {/* Right gradient mask */}
      <div className="absolute right-0 top-0 h-full w-40 z-10 bg-gradient-to-l from-background via-background/80 to-transparent pointer-events-none" />

      {/* Scrolling container */}
      <div className="flex items-center w-full">
        <div className="flex animate-infinite-scroll items-center">
          {duplicatedStack.map((tech, index) => {
            const IconComponent = tech.icon;
            return (
              <div
                key={`${tech.name}-${index}`}
                className="flex-shrink-0 mx-6 flex flex-col items-center"
              >
                <div className="h-18 flex items-center justify-center ">
                  <div className="flex gap-2 items-center">
                    <IconComponent
                      size={24}
                      className="transition-transform duration-300"
                    />
                    <p className="font-inter font-medium">{tech.name}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StackSlider;
