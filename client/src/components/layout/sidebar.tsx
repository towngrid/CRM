import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Users, 
  BarChart3, 
  Handshake, 
  CheckSquare, 
  TrendingUp,

  Mail,
  Inbox as InboxIcon,
  Settings as SettingsIcon,
  LogOut,
  UserCog,
  Search,
  ClipboardList,
  FlaskConical,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const navigation = [
  { name: "Dashboard",       href: "/",                   icon: BarChart3 },
  { name: "Business Search", href: "/search",              icon: Search },
  { name: "Form Follow-ups", href: "/form-outreach",       icon: ClipboardList },
  { name: "Contacts",        href: "/contacts",           icon: Users },
  { name: "Pipeline",        href: "/deals",              icon: Handshake },
  { name: "Tasks",           href: "/tasks",              icon: CheckSquare },
  { name: "Outreach",        href: "/email-sequences",     icon: Mail },
  { name: "Inbox",           href: "/inbox",              icon: InboxIcon },
  // Commissions and Payroll are hidden until TownGrid has salespeople (pages still exist).
  { name: "Reports",         href: "/reports",            icon: TrendingUp },
  { name: "Settings",        href: "/settings",           icon: SettingsIcon },
];

const adminNavigation = [
  { name: "Users",    href: "/admin/users",         icon: UserCog },
  { name: "Seq Test", href: "/admin/sequence-test", icon: FlaskConical },
];

export default function Sidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  const userChangedSidebar = useRef(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem("sidebar_collapsed");
      return saved === null ? window.matchMedia("(max-width: 767px)").matches : saved === "true";
    } catch { return window.matchMedia("(max-width: 767px)").matches; }
  });

  useEffect(() => {
    if (!userChangedSidebar.current) return;
    try { localStorage.setItem("sidebar_collapsed", String(collapsed)); } catch {}
  }, [collapsed]);

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "User";

  return (
    <div
      className={cn(
        "bg-card border-r border-border flex flex-col transition-all duration-200 shrink-0",
        collapsed ? "w-14" : "w-64"
      )}
      data-testid="sidebar"
    >
      {/* ── Logo ───────────────────────────────────────────────────────── */}
      <div className={cn("border-b border-border flex items-center", collapsed ? "p-3 justify-center" : "p-6")}>
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0">
          <Users className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <h1 className="ml-2 text-xl font-bold text-foreground">TownGrid CRM</h1>
        )}
      </div>

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto" data-testid="navigation">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;

          const linkEl = (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center rounded-md transition-colors font-medium",
                collapsed ? "justify-center p-2" : "space-x-3 px-3 py-2",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.name} delayDuration={0}>
                <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                <TooltipContent side="right">{item.name}</TooltipContent>
              </Tooltip>
            );
          }
          return linkEl;
        })}

        {user?.role === "admin" && (
          <>
            <div className={cn("pt-4 pb-1", collapsed ? "hidden" : "block")}>
              <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Admin
              </p>
            </div>
            {collapsed && <div className="pt-2 border-t border-border mx-1" />}
            {adminNavigation.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;

              const linkEl = (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-md transition-colors font-medium",
                    collapsed ? "justify-center p-2" : "space-x-3 px-3 py-2",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.name}</span>}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.name} delayDuration={0}>
                    <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                    <TooltipContent side="right">{item.name}</TooltipContent>
                  </Tooltip>
                );
              }
              return linkEl;
            })}
          </>
        )}
      </nav>

      {/* ── User Profile + Collapse toggle ─────────────────────────────── */}
      <div className="border-t border-border p-2 space-y-1">
        {/* Collapse toggle */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={() => { userChangedSidebar.current = true; setCollapsed(c => !c); }}
              className={cn(
                "flex items-center w-full rounded-md px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                collapsed ? "justify-center" : "justify-end"
              )}
              data-testid="button-toggle-sidebar"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed
                ? <ChevronRight className="h-4 w-4" />
                : <ChevronLeft className="h-4 w-4" />
              }
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>

        {/* User info */}
        {!collapsed ? (
          <div className="px-2 space-y-2">
            <div className="flex items-center space-x-2">
              {user?.profileImageUrl ? (
                <img
                  src={user.profileImageUrl}
                  alt="Profile"
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                  data-testid="img-user-avatar"
                />
              ) : (
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate" data-testid="text-user-name">
                  {displayName}
                </p>
                <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
                  {user?.email || ""}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        ) : (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center w-full rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                data-testid="button-logout"
                aria-label="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign Out</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
