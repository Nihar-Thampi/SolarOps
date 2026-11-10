import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Bot, CalendarClock, Plus, Search, Sparkles } from "lucide-react"

import { api, params } from "@/api/client"
import { EmptyState, PageHeader, PriorityLabel, StatusBadge } from "@/components/common"
import { IntakeDialog, NewJobDialog } from "@/components/jobs/JobDialogs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth, useMe } from "@/context/AuthContext"
import { useRegion } from "@/context/RegionContext"
import { PRIORITIES, PRIORITY_LABELS, SERVICE_LABELS, SERVICE_TYPES, STATUS_LABELS, fmtDate, fmtDue } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { JobListItem, Page, User } from "@/types"

const ANY = "__any__"
const PAGE = 50

export default function JobsPage() {
  const me = useMe()
  const { canManage } = useAuth()
  const { regionId } = useRegion()
  const [sp, setSp] = useSearchParams()
  const [newOpen, setNewOpen] = useState(false)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [q, setQ] = useState(sp.get("q") ?? "")

  const view = sp.get("view") ?? "open"
  const filters = {
    view: sp.get("status") ? "all" : view,
    status: sp.get("status"),
    // Technicians start on their own jobs; "any" in the URL means they chose to see everyone's.
    assignee: sp.get("assignee") ?? (me.user.role === "technician" ? "me" : "any"),
    priority: sp.get("priority"),
    service_type: sp.get("service"),
    overdue: sp.get("overdue") === "1",
    q: sp.get("q"),
    sort: sp.get("sort") ?? "priority",
    offset: Number(sp.get("offset") ?? 0),
    region_id: regionId,
  }

  function updateMany(changes: Record<string, string | null>) {
    const next = new URLSearchParams(sp)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key)
      else next.set(key, value)
    }
    next.delete("offset")
    setSp(next, { replace: true })
  }
  const update = (key: string, value: string | null) => updateMany({ [key]: value })

  const jobs = useQuery({
    queryKey: ["jobs", filters],
    queryFn: async () =>
      (
        await api.get<Page<JobListItem>>("/jobs", {
          params: params({ ...filters, assignee: filters.assignee === "any" ? null : filters.assignee, limit: PAGE }),
        })
      ).data,
    placeholderData: keepPreviousData,
  })
  const people = useQuery({
    queryKey: ["users", "all"],
    queryFn: async () => (await api.get<User[]>("/users")).data.filter((u) => u.role !== "admin"),
    staleTime: 60_000,
  })

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Every maintenance and repair job across your regions."
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setIntakeOpen(true)}>
                <Sparkles className="text-sun" /> AI intake
              </Button>
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> New job
              </Button>
            </>
          )
        }
      />

      {/* One filter row scopes the whole list. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={filters.status ? "all" : view} onValueChange={(v) => updateMany({ status: null, view: v === "open" ? null : v })}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault()
            update("q", q.trim() || null)
          }}
        >
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => update("q", q.trim() || null)}
            placeholder="Search job, title, client"
            className="h-9 w-56 pl-8"
          />
        </form>
        <Select value={filters.assignee === "any" ? ANY : filters.assignee} onValueChange={(v) => update("assignee", v === ANY ? (me.user.role === "technician" ? "any" : null) : v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Anyone</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {people.data?.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.priority ?? ANY} onValueChange={(v) => update("priority", v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any priority</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.service_type ?? ANY} onValueChange={(v) => update("service", v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any service</SelectItem>
            {SERVICE_TYPES.map((s) => (
              <SelectItem key={s} value={s}>
                {SERVICE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.sort} onValueChange={(v) => update("sort", v === "priority" ? null : v)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Sort: priority</SelectItem>
            <SelectItem value="due">Sort: due date</SelectItem>
            <SelectItem value="newest">Sort: newest</SelectItem>
            <SelectItem value="updated">Sort: last updated</SelectItem>
          </SelectContent>
        </Select>
        {(filters.overdue || filters.status) && (
          <Button variant="secondary" size="sm" onClick={() => updateMany({ overdue: null, status: null })}>
            {filters.overdue ? "Overdue only" : STATUS_LABELS[filters.status as keyof typeof STATUS_LABELS]} ✕
          </Button>
        )}
      </div>

      <Card className={cn("overflow-hidden transition-opacity", jobs.isPlaceholderData && "opacity-60")}>
        {jobs.data && jobs.data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No jobs match these filters" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Job</TableHead>
                <TableHead>Client · site</TableHead>
                <TableHead className="hidden xl:table-cell">Service</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="pr-4">{view === "completed" ? "Completed" : "Due"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data?.items.map((j) => (
                <TableRow key={j.id} className="cursor-pointer">
                  <TableCell className="max-w-64 pl-4">
                    <Link to={`/jobs/${j.id}`} className="block">
                      <div className="flex items-center gap-1.5 truncate font-medium hover:underline">
                        {j.title}
                        {j.source === "ai_intake" && <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-label="Created with AI intake" />}
                        {j.source === "schedule" && <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-label="From a service schedule" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {j.number} · {j.region.name}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-48">
                    <div className="truncate">{j.client_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{j.site?.name ?? "—"}</div>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap xl:table-cell">{SERVICE_LABELS[j.service_type]}</TableCell>
                  <TableCell>
                    <PriorityLabel priority={j.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {j.assignee ? j.assignee.full_name : <span className="text-warning">Unassigned</span>}
                  </TableCell>
                  <TableCell className="pr-4 whitespace-nowrap">
                    {j.status === "completed" ? (
                      fmtDate(j.completed_at)
                    ) : (
                      <span className={cn("text-xs", j.is_overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {fmtDue(j.due_date)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {jobs.data && jobs.data.total > PAGE && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {filters.offset + 1}–{Math.min(filters.offset + PAGE, jobs.data.total)} of {jobs.data.total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={filters.offset === 0} onClick={() => update("offset", String(Math.max(0, filters.offset - PAGE)))}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.offset + PAGE >= jobs.data.total}
              onClick={() => {
                const next = new URLSearchParams(sp)
                next.set("offset", String(filters.offset + PAGE))
                setSp(next, { replace: true })
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <NewJobDialog open={newOpen} onOpenChange={setNewOpen} />
      <IntakeDialog open={intakeOpen} onOpenChange={setIntakeOpen} />
    </div>
  )
}
