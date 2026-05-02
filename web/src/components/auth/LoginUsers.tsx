import React from "react";

const LoginUsers = () => {
  // Sample user avatars - you can replace these with actual user images
  const userAvatars = [
    "/img/sample-users/user1.jpg",
    "/img/test/mark.jpeg",
    "/img/sample-users/user2.jpg",
    "/img/sample-users/user3.jpg",
  ];

  return (
    <div className="group relative inline-flex items-center gap-3 w-fit select-none">
      {/* Subtle gradient overlay */}

      {/* User Avatars Stack */}
      <div className="relative flex items-center border rounded-full p-0.5">
        {userAvatars.map((avatar, index) => (
          <div
            key={index}
            className="relative size-9 rounded-full border overflow-hidden transition-transform duration-300 hover:scale-110 hover:z-10"
            style={{
              marginLeft: index > 0 ? "-15px" : "0",
              zIndex: userAvatars.length - index,
            }}
          >
            <img
              src={avatar}
              alt={`User ${index + 1}`}
              className="w-full h-full object-cover"
            />
          </div>
        ))}

        {/* Plus Icon with enhanced styling */}
        <div
          className="relative size-9 rounded-full border bg-background overflow-hidden transition-transform duration-300 hover:scale-110 hover:z-10 flex items-center justify-center"
          style={{ marginLeft: "-15px", zIndex: 0 }}
        >
          <span className="text-xs font-bold text-primary cursor-default">
            +
          </span>
        </div>
      </div>

      {/* Text Content with better typography */}
      <div className="relative flex flex-col leading-tight text-sm">
        <p className="">
          Become one of <span className="font-semibold">4000+</span>
        </p>
        <p className="">happy users</p>
      </div>
    </div>
  );
};

export default LoginUsers;
