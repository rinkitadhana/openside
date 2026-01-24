import React from "react";
import { FaGithub } from "react-icons/fa";

const GithubButton = ({ scrolled }: { scrolled: boolean }) => {
  return (
    <a
      href="https://github.com/rinkitadhana/asap"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Github"
      className={`cursor-pointer p-2 rounded-md transition-all duration-200 ${
        scrolled ? "hover:bg-secondary-hover" : "hover:bg-primary-hover"
      }`}
    >
      <FaGithub size={20} />
    </a>
  );
};

export default GithubButton;
