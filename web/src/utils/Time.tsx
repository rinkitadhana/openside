"use client";
import React, { useState, useEffect } from "react";

const TimeComponent = ({ className }: { className?: string }) => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDate(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const hours = currentDate.getHours();
  const minutes = currentDate.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";

  const formattedHours = hours % 12 || 12;
  const formattedMinutes = minutes.toString().padStart(2, "0");

  return (
    <div
      className={
        "select-none  text-center w-fit" + (className ? ` ${className}` : "")
      }
    >
      <span>
        {formattedHours}:{formattedMinutes}
      </span>
      <span className="text-sm ml-1">{period}</span>
    </div>
  );
};

export default TimeComponent;
