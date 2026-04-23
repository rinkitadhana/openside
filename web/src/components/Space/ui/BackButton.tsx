import React from "react";
import { MdArrowBackIosNew } from "react-icons/md";
import { useNavigate } from "react-router-dom";

const BackButton = () => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate("/dashboard/home")}
      title="Back"
      className="p-2.5 hover:bg-primary-hover rounded-[12px] cursor-pointer transition-all duration-200"
    >
      <MdArrowBackIosNew size={17} />
    </button>
  );
};

export default BackButton;
