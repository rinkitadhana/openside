import React from "react";
import Image from "next/image";

interface UserAvatarProps {
  name?: string;
  avatar: string;
  className?: string;
  preJoin?: boolean;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  avatar,
  className = "",
  preJoin = false,
}) => {
  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.trim()[0].toUpperCase();
  };

  return (
    <div className="select-none w-full h-full relative flex items-center justify-center overflow-hidden">
      {/* Background Layer */}
      {!preJoin && (
        <>
          {avatar ? (
            <>
              <div className="absolute inset-0 w-full h-full z-0">
                <Image
                  src={avatar}
                  alt="background"
                  fill
                  className="object-cover blur-3xl scale-110"
                />
              </div>
              {/* Dark overlay for better contrast */}
              <div className="absolute inset-0 bg-black/50 z-[1]" />
            </>
          ) : (
            <div className="absolute inset-0 bg-call-primary" />
          )}
        </>
      )}

      {/* Avatar Content on top */}
      <div className="relative  w-full h-full flex items-center justify-center">
        {preJoin ? (
          <div className="w-full h-full bg-call-primary/50 flex items-center justify-center font-semibold text-base md:text-lg">
            Camera is off!
          </div>
        ) : avatar ? (
          <div className="relative w-[40%] z-10 min-w-[120px] aspect-square max-w-[120px] rounded-full">
            <Image
              src={avatar}
              alt={name ? `${name}'s profile` : "User Profile"}
              fill
              className={`rounded-full object-cover ${className}`}
            />
          </div>
        ) : (
          <div
            className={`rounded-full bg-purple-500  flex items-center justify-center font-semibold text-white w-[40%] min-w-[120px] aspect-square max-w-[120px] ${className}`}
            style={{ fontSize: "clamp(1.5rem, 5vw, 3.5rem)" }}
          >
            {getInitials(name)}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserAvatar;
