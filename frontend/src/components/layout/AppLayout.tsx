import { Suspense, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  Bot,
  Briefcase,
  CalendarClock,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquareHeart,
  Monitor,
  ScrollText,
  Moon,
  Sun,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react"

import { api } from "@/api/client"
import { useAuth, useMe } from "@/context/AuthContext"
import { useRegion } from "@/context/RegionContext"
import { ROLE_LABELS, initials } from "@/lib/format"
import { useTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import type { AIStatus, Role } from "@/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles?: Role[]
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/services", label: "Required services", icon: CalendarClock },
  { to: "/clients", label: "Clients & sites", icon: Users },
  { to: "/feedback", label: "Customer feedback", icon: MessageSquareHeart, roles: ["admin", "manager"] },
  { to: "/team", label: "Team & regions", icon: UsersRound, roles: ["admin"] },
  { to: "/ai-activity", label: "AI activity", icon: Bot, roles: ["admin", "manager"] },
  { to: "/audit-log", label: "Audit log", icon: ScrollText, roles: ["admin"] },
]

const ALL = "__all__"

export function SunLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <circle cx="21.5" cy="10" r="4" className="fill-primary-foreground" />
      <path d="M5 26l3.6-9.5h14.8L27 26z" className="fill-primary-foreground" />
      <path d="M13.5 16.5l-1.2 9.5M18.5 16.5l1.2 9.5M7 21.2h18" className="stroke-primary" strokeWidth="1.2" />
    </svg>
  )
}

function RegionPicker() {
  const me = useMe()
  const { regionId, setRegionId } = useRegion()
  if (me.visible_regions.length < 2) {
    return <span className="text-sm text-muted-foreground">{me.visible_regions[0]?.name ?? "No region"}</span>
  }
  return (
    <Select value={regionId ?? ALL} onValueChange={(v) => setRegionId(v === ALL ? null : v)}>
      <SelectTrigger className="h-8 w-44" aria-label="Region">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{me.user.role === "admin" ? "All regions" : "All my regions"}</SelectItem>
        {me.visible_regions.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const THEME_ICON: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor }

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
  const Icon = THEME_ICON[theme]
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      title={`Theme: ${theme} (click for ${next})`}
      aria-label={`Colour theme: ${theme}. Switch to ${next}`}
    >
      <Icon />
    </Button>
  )
}

function AiStatusBadge() {
  const { data } = useQuery({
    queryKey: ["ai-status"],
    queryFn: async () => (await api.get<AIStatus>("/ai/status")).data,
    staleTime: Infinity,
  })
  if (!data) return null
  return (
    <Badge
      variant="outline"
      className="hidden gap-1.5 font-normal sm:inline-flex"
      title={data.is_demo ? "No local model available: AI features use offline rules. Start Ollama and download the model." : `Local model: ${data.model}`}
    >
      <span className={cn("size-1.5 rounded-full", data.is_demo ? "bg-warning" : "bg-success")} />
      {data.is_demo ? "AI: demo mode" : "AI: local model"}
    </Badge>
  )
}

export function AppLayout() {
  const me = useMe()
  const { logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const nav = NAV.filter((n) => !n.roles || n.roles.includes(me.user.role))

  const sidebar = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Main">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            cn(
              "relative flex min-h-10 items-center gap-3 rounded-md px-3 text-[0.95rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
              isActive || location.pathname.startsWith(item.to + "/")
                ? "bg-sidebar-accent text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary [&_svg]:text-primary"
                : "text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
            )
          }
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside className="panel-cells hidden w-64 shrink-0 flex-col text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <SunLogo className="size-8" />
          <div className="min-w-0 leading-tight">
            <div className="font-display text-lg font-semibold tracking-tight text-white">SolarOps</div>
            <div className="truncate text-xs text-sidebar-muted">{me.tenant.name}</div>
          </div>
        </div>
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="panel-cells absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overscroll-contain text-sidebar-foreground">
            <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
              <div className="flex items-center gap-2.5">
                <SunLogo className="size-8" />
                <span className="font-display text-lg font-semibold text-white">SolarOps</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X />
              </Button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center gap-2 border-b bg-card px-4 sm:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <RegionPicker />
          <div className="ml-auto flex items-center gap-1.5">
            <AiStatusBadge />
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-md p-1 pr-2 text-left hover:bg-accent">
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">{initials(me.user.full_name)}</AvatarFallback>
                </Avatar>
                <div className="hidden leading-tight sm:block">
                  <div className="text-sm font-medium">{me.user.full_name}</div>
                  <div className="text-xs text-muted-foreground">{ROLE_LABELS[me.user.role]}</div>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{me.user.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {me.tenant.name} · {ROLE_LABELS[me.user.role]}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
            <Suspense fallback={<Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}
