"use client";
import { useRouter } from "next/navigation";
import React from "react";
import generateRoomId from "@/shared/utils/GenerateRoomId";
import { FaCalendarAlt, FaPlus, FaUserPlus, FaVideo } from "react-icons/fa";
import ActionCard from "./ActionCard";

const QuickActions = () => {
  const router = useRouter();

  const handleJoinRoom = () => {
    const roomId = generateRoomId();
    router.push(`/${roomId}?host=true`);
  };

  const actions = [
    {
      id: 1,
      title: "New Meeting",
      description: "Start a new meeting",
      icon: <FaPlus size={24} className="text-white" />,
      bgColorHex: "#e05334",
      bgImage: "/img/hero-dash/link1.jpg",
      onClick: handleJoinRoom,
    },
    {
      id: 2,
      title: "Join Meeting",
      description: "Via invitation link",
      icon: <FaUserPlus size={24} className="text-white" />,
      bgColorHex: "#2e6aeb",
      bgImage: "/img/hero-dash/link3.jpg",
      onClick: () => {}, // Add handler
    },
    {
      id: 3,
      title: "Schedule Meeting",
      description: "Plan your meeting",
      icon: <FaCalendarAlt size={24} className="text-white" />,
      bgColorHex: "#9333EA",
      bgImage: "/img/hero-dash/link2.avif",
      onClick: () => {}, // Add handler
    },
    {
      id: 4,
      title: "View Recordings",
      description: "Meeting recordings",
      icon: <FaVideo size={24} className="text-white" />,
      bgColorHex: "#c5a239",
      bgImage: "/img/hero-dash/link4.jpeg",
      onClick: () => {}, // Add handler
    },
  ];

  return (
    <div>
      <div className="flex gap-4 not-first:items-center h-[180px] w-full">
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            title={action.title}
            description={action.description}
            icon={action.icon}
            bgColorHex={action.bgColorHex}
            bgImage={action.bgImage}
            onClick={action.onClick}
          />
        ))}
      </div>
    </div>
  );
};

export default QuickActions;
