"use client";

import {
  CalendarDays,
  ChevronDown,
  FolderClosed,
  House,
  LogOut,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { IoBugOutline } from "react-icons/io5";
import { RiShareBoxFill } from "react-icons/ri";
import { Link, useLocation } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shared/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useGetMe } from "@/hooks/useUserQuery";

const GITHUB_NEW_ISSUE_URL =
  "https://github.com/rinkitadhana/openside/issues/new";

const navLinks = [
  { icon: House, name: "Home", to: "/dashboard/home" },
  { icon: FolderClosed, name: "Projects", to: "/dashboard/project" },
  { icon: CalendarDays, name: "Calendar", to: "/dashboard/calendar" },
];

interface DashboardSidebarProps {
  isOpen: boolean;
  /** Called after a nav link is clicked - lets the mobile drawer close itself. */
  onNavigate?: () => void;
}

const DashboardSidebar = ({ isOpen, onNavigate }: DashboardSidebarProps) => {
  const { pathname } = useLocation();
  const { data: user, isLoading } = useGetMe();
  const { logout } = useAuth();

  const navLinkClass = (isActive: boolean) =>
    `flex h-10 items-center overflow-hidden rounded-md text-sm font-medium transition-colors ${
      isActive ? "bg-muted text-foreground" : "text-foreground hover:bg-muted"
    }`;

  return (
    <aside
      className={`flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-background p-3 transition-[width] duration-200 ${
        isOpen ? "w-56" : "w-[66px]"
      }`}
    >
      <div className="mb-5 flex h-9 items-center overflow-hidden">
        <span className="flex w-[42px] shrink-0 items-center justify-center">
          <img
            src="/logo/logo-light.png"
            className="h-auto w-5 shrink-0 select-none dark:hidden"
            alt="Openside"
          />
          <img
            src="/logo/logo-dark.png"
            className="hidden h-auto w-5 shrink-0 select-none dark:block"
            alt="Openside"
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-semibold uppercase tracking-wide text-foreground">
          Openside
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {navLinks.map(({ icon: Icon, name, to }) => {
          const isActive = pathname === to;

          return (
            <Link
              key={to}
              to={to}
              title={name}
              onClick={onNavigate}
              className={navLinkClass(isActive)}
            >
              <span className="flex w-[42px] shrink-0 items-center justify-center">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate pr-3">{name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1">
        <a
          href={GITHUB_NEW_ISSUE_URL}
          target="_blank"
          rel="noreferrer"
          title="Report issue"
          className="flex h-10 items-center overflow-hidden rounded-md border border-yellow-500/30 bg-yellow-500/10 text-sm font-medium text-yellow-700 transition-colors hover:bg-yellow-500/20 dark:text-yellow-500"
        >
          <span
            className={`flex shrink-0 items-center justify-center ${
              isOpen ? "w-[42px]" : "w-full"
            }`}
          >
            <IoBugOutline size={18} />
          </span>
          {isOpen && (
            <>
              <span className="min-w-0 flex-1 truncate">Report issue</span>
              <RiShareBoxFill size={14} className="mr-3 shrink-0" />
            </>
          )}
        </a>

        <Link
          to="/dashboard/settings"
          title="Settings"
          onClick={onNavigate}
          className={navLinkClass(pathname === "/dashboard/settings")}
        >
          <span className="flex w-[42px] shrink-0 items-center justify-center">
            <Settings size={18} />
          </span>
          <span className="min-w-0 flex-1 truncate pr-3">Settings</span>
        </Link>

        <div className="my-1 h-px bg-border" />

        {/* User profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={user?.name || "Account"}
              className="group flex h-11 items-center overflow-hidden rounded-md text-left transition-colors hover:bg-muted data-[state=open]:bg-muted cursor-pointer"
            >
              <span className="flex w-[42px] shrink-0 items-center justify-center">
                <span className="flex size-7 items-center justify-center overflow-hidden rounded bg-muted text-foreground">
                  {isLoading ? (
                    <UserIcon size={16} />
                  ) : user?.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name || "User"}
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserIcon size={16} />
                  )}
                </span>
              </span>
              {isLoading ? (
                <span className="h-4 w-24 animate-pulse rounded bg-muted" />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {user?.name || "User"}
                </span>
              )}
              <ChevronDown
                size={16}
                className="mr-3 shrink-0 text-foreground/60 transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-40 rounded-lg border-border bg-background p-1.5 shadow-sm"
          >
            <DropdownMenuItem
              className="h-9 cursor-pointer rounded-md px-2.5 text-red-500 focus:bg-red-500/10 focus:text-red-500 dark:text-red-500 dark:focus:text-red-500"
              onClick={logout}
            >
              <LogOut className="h-4 w-4 text-red-500" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
};

export default DashboardSidebar;
