import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Copy,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Pause,
  Pencil,
  Phone,
  Play,
  UserCheck,
  UserMinus,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/api/client"
import { Field, PriorityLabel, SentimentBadge, Stars, StatusBadge } from "@/components/common"
import { JobForm, type JobFormValues } from "@/components/jobs/JobForm"
import { ReportPanel } from "@/components/jobs/ReportPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth, useMe } from "@/context/AuthContext"
import { SERVICE_LABELS, fmtAgo, fmtDate, fmtDateTime, fmtDue } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { JobDetail, JobStatus, User } from "@/types"

const UNASSIGNED = "__unassigned__"

/** A job action whose response is the updated job: refresh the page and the lists. */
function useJobAction<T>(jobId: string | undefined, fn: (arg: T) => Promise<JobDetail>, success?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (job: JobDetail) => {
      queryClient.setQueryData(["job", jobId], job)
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      if (success) toast.success(success)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export default function JobDetailPage() {
  const { id } = useParams()
  const me = useMe()
  const { canManage } = useAuth()
  const [editOpen, setEditOpen] = useState(false)
  const [note, setNote] = useState("")

  const { data: job, error } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => (await api.get<JobDetail>(`/jobs/${id}`)).data,
  })

  const people = useQuery({
    queryKey: ["users", "assignable", job?.region.id],
    queryFn: async () =>
      (await api.get<User[]>("/users", { params: { region_id: job!.region.id } })).data.filter(
        (u) => u.is_active && u.role !== "admin"
      ),
    enabled: !!job && canManage,
  })

  const assign = useJobAction(id, async (assignee_id: string | null) => (await api.post<JobDetail>(`/jobs/${id}/assign`, { assignee_id })).data)
  const setStatus = useJobAction(id, async (status: JobStatus) => (await api.post<JobDetail>(`/jobs/${id}/status`, { status })).data)
  const addNote = useJobAction(id, async (message: string) => (await api.post<JobDetail>(`/jobs/${id}/notes`, { message })).data, "Note added")
  const update = useJobAction(id, async (v: JobFormValues) => {
    const { title, description, service_type, priority, site_id, scheduled_date, due_date } = v
    return (
      await api.patch<JobDetail>(`/jobs/${id}`, {
        title,
        description: description || null,
        service_type,
        priority,
        site_id,
        scheduled_date: scheduled_date || null,
        due_date: due_date || null,
      })
    ).data
  }, "Job updated")

  if (error) return <p className="mt-12 text-center text-muted-foreground">{errorMessage(error)}</p>
  if (!job) return <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />

  const isMine = job.assignee?.id === me.user.id
  const canWork = canManage || isMine
  const open = !["completed", "cancelled"].includes(job.status)
  const busy = assign.isPending || setStatus.isPending

  return (
    <div>
      <Link to="/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Jobs
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{job.number}</span>
            <StatusBadge status={job.status} />
            <PriorityLabel priority={job.priority} />
            <span>· {job.region.name}</span>
            {job.source === "ai_intake" && (
              <Badge variant="outline" className="gap-1 font-normal">
                <Bot className="size-3" /> AI intake
              </Badge>
            )}
            {job.source === "schedule" && (
              <Badge variant="outline" className="gap-1 font-normal">
                <CalendarClock className="size-3" /> Scheduled service
              </Badge>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{job.title}</h1>
        </div>
        {open && canWork && (
          <div className="flex flex-wrap gap-2">
            {(job.status === "new" || job.status === "scheduled" || job.status === "on_hold") && (
              <Button onClick={() => setStatus.mutate("in_progress")} disabled={busy}>
                <Play /> {job.status === "on_hold" ? "Resume" : "Start work"}
              </Button>
            )}
            {job.status === "in_progress" && (
              <Button variant="outline" onClick={() => setStatus.mutate("on_hold")} disabled={busy}>
                <Pause /> Put on hold
              </Button>
            )}
            {canManage && (
              <>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil /> Edit
                </Button>
                <Button variant="ghost" className="text-destructive" onClick={() => setStatus.mutate("cancelled")} disabled={busy}>
                  <XCircle /> Cancel job
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Request</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <p className="text-sm whitespace-pre-wrap">{job.description || "No description."}</p>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Service">{SERVICE_LABELS[job.service_type]}</Field>
                <Field label="Scheduled">{fmtDate(job.scheduled_date)}</Field>
                <Field label="Due">
                  <span className={cn(job.is_overdue && "font-medium text-destructive")}>
                    {fmtDate(job.due_date)}
                    {open && job.due_date && <span className="block text-xs text-muted-foreground">{fmtDue(job.due_date)}</span>}
                  </span>
                </Field>
                <Field label={job.completed_at ? "Completed" : "Created"}>{fmtDate(job.completed_at ?? job.created_at)}</Field>
              </dl>
            </CardContent>
          </Card>

          <ReportPanel key={job.report?.updated_at ?? "none"} job={job} canWork={canWork} canManage={canManage} />

          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (note.trim()) addNote.mutate(note.trim(), { onSuccess: () => setNote("") })
                }}
              >
                <Textarea rows={1} className="min-h-9" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" />
                <Button type="submit" variant="secondary" disabled={!note.trim() || addNote.isPending}>
                  <MessageSquare /> Add
                </Button>
              </form>
              <ol className="relative space-y-3 border-l pl-4">
                {job.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-border" />
                    <div className={cn(e.kind === "note" && "rounded-md bg-muted px-3 py-2")}>{e.message}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground" title={fmtDateTime(e.created_at)}>
                      {e.user?.full_name ?? (e.kind === "feedback" ? "Customer" : "System")} · {fmtAgo(e.created_at)}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base font-semibold text-foreground">Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              {canManage && open ? (
                <>
                  <Select
                    value={job.assignee?.id ?? UNASSIGNED}
                    onValueChange={(v) => assign.mutate(v === UNASSIGNED ? null : v)}
                    disabled={assign.isPending}
                  >
                    <SelectTrigger aria-label="Assignee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {people.data?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name}
                          {u.role === "manager" ? " (manager)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {job.suggested_assignees.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs text-muted-foreground">Suggested (skills and current workload)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {job.suggested_assignees.map((u) => (
                          <Button key={u.id} variant="outline" size="sm" onClick={() => assign.mutate(u.id)} disabled={assign.isPending}>
                            <UserCheck /> {u.full_name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm">{job.assignee ? job.assignee.full_name : <span className="text-warning">Unassigned</span>}</p>
              )}
              {!canManage && open && !job.assignee && (
                <Button className="w-full" onClick={() => assign.mutate(me.user.id)} disabled={assign.isPending}>
                  <UserCheck /> Pick up this job
                </Button>
              )}
              {!canManage && open && isMine && (
                <Button variant="ghost" size="sm" onClick={() => assign.mutate(null)} disabled={assign.isPending}>
                  <UserMinus /> Release job
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base font-semibold text-foreground">
                <Link to={`/clients/${job.client.id}`} className="hover:underline">
                  {job.client.name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 p-5 pt-0 text-sm">
              {job.client.contact_name && <p>{job.client.contact_name}</p>}
              {job.client.phone && (
                <a href={`tel:${job.client.phone}`} className="flex items-center gap-2 text-link hover:underline">
                  <Phone className="size-3.5" /> {job.client.phone}
                </a>
              )}
              {job.client.email && (
                <a href={`mailto:${job.client.email}`} className="flex items-center gap-2 text-link hover:underline">
                  <Mail className="size-3.5" /> {job.client.email}
                </a>
              )}
              {job.site_detail && (
                <div className="mt-3 border-t pt-3">
                  <p className="font-medium">{job.site_detail.name}</p>
                  {job.site_detail.address && (
                    <p className="flex items-start gap-2 text-muted-foreground">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" /> {job.site_detail.address}
                    </p>
                  )}
                  <dl className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="System">{job.site_detail.system_size_kw ? `${job.site_detail.system_size_kw} kW` : "—"}</Field>
                    <Field label="Panels">{job.site_detail.panel_count ?? "—"}</Field>
                    <Field label="Inverter">{job.site_detail.inverter_model ?? "—"}</Field>
                    <Field label="Battery">{job.site_detail.has_battery ? "Yes" : "No"}</Field>
                  </dl>
                  <Link to={`/clients/${job.client.id}?site=${job.site_detail.id}`} className="mt-2 inline-block text-xs text-link hover:underline">
                    Maintenance history →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {job.status === "completed" && (
            <Card>
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-base font-semibold text-foreground">Customer feedback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-5 pt-0 text-sm">
                {job.feedback ? (
                  <>
                    <div className="flex items-center justify-between">
                      <Stars rating={job.feedback.rating} />
                      <SentimentBadge sentiment={job.feedback.sentiment} />
                    </div>
                    <p>{job.feedback.comment || <span className="text-muted-foreground">No comment.</span>}</p>
                    {job.feedback.themes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {job.feedback.themes.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">No feedback yet. Send the customer this link:</p>
                    {job.feedback_url && (
                      <div className="flex gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{job.feedback_url}</code>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copy link"
                          onClick={() => navigator.clipboard.writeText(job.feedback_url!).then(() => toast.success("Link copied"))}
                        >
                          <Copy />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {job.number}</DialogTitle>
          </DialogHeader>
          {editOpen && (
            <JobForm
              initial={{
                client_id: job.client_id,
                site_id: job.site?.id ?? null,
                title: job.title,
                description: job.description ?? "",
                service_type: job.service_type,
                priority: job.priority,
                assignee_id: job.assignee?.id ?? null,
                scheduled_date: job.scheduled_date ?? "",
                due_date: job.due_date ?? "",
              }}
              submitLabel="Save"
              editing
              busy={update.isPending}
              onSubmit={(v) => update.mutate(v, { onSuccess: () => setEditOpen(false) })}
              onCancel={() => setEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
