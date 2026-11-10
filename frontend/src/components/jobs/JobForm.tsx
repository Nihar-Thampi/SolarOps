import { useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { api, params } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PRIORITIES, PRIORITY_LABELS, SERVICE_LABELS, SERVICE_TYPES } from "@/lib/format"
import type { ClientListItem, Page, Priority, ServiceType, Site, User } from "@/types"

export interface JobFormValues {
  client_id: string
  site_id: string | null
  title: string
  description: string
  service_type: ServiceType
  priority: Priority
  assignee_id: string | null
  scheduled_date: string
  due_date: string
}

export const EMPTY_JOB: JobFormValues = {
  client_id: "",
  site_id: null,
  title: "",
  description: "",
  service_type: "fault_repair",
  priority: "medium",
  assignee_id: null,
  scheduled_date: "",
  due_date: "",
}

const NONE = "__none__"

export function useClientsForPicker() {
  return useQuery({
    queryKey: ["clients", "picker"],
    queryFn: async () => (await api.get<Page<ClientListItem>>("/clients", { params: { limit: 200 } })).data.items,
    staleTime: 60_000,
  })
}

export function JobForm({
  initial,
  submitLabel,
  editing = false,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: JobFormValues
  submitLabel: string
  /** Editing an existing job: the client is fixed and assignment is done on the job page. */
  editing?: boolean
  busy: boolean
  onSubmit: (values: JobFormValues) => void
  onCancel: () => void
}) {
  const [v, setV] = useState<JobFormValues>(initial)
  const set = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }))

  const clients = useClientsForPicker()
  const client = clients.data?.find((c) => c.id === v.client_id)
  const sites = useQuery({
    queryKey: ["sites", v.client_id],
    queryFn: async () => (await api.get<Site[]>("/sites", { params: { client_id: v.client_id } })).data,
    enabled: !!v.client_id,
  })
  // People who can take a job in this client's region.
  const people = useQuery({
    queryKey: ["users", "assignable", client?.region.id],
    queryFn: async () =>
      (await api.get<User[]>("/users", { params: params({ region_id: client?.region.id }) })).data.filter(
        (u) => u.is_active && u.role !== "admin"
      ),
    enabled: !!client,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit(v)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Client</Label>
          <Select
            value={v.client_id || undefined}
            onValueChange={(id) => setV((prev) => ({ ...prev, client_id: id, site_id: null, assignee_id: null }))}
            disabled={editing}
          >
            <SelectTrigger>
              <SelectValue placeholder={clients.isLoading ? "Loading…" : "Choose a client"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {clients.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} <span className="text-muted-foreground">· {c.region.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Site</Label>
          <Select value={v.site_id ?? NONE} onValueChange={(id) => set("site_id", id === NONE ? null : id)} disabled={!v.client_id}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No specific site</SelectItem>
              {sites.data?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.system_size_kw ? ` · ${s.system_size_kw} kW` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="job-title">Title</Label>
        <Input id="job-title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="job-desc">Description</Label>
        <Textarea id="job-desc" rows={4} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Service</Label>
          <Select value={v.service_type} onValueChange={(s) => set("service_type", s as ServiceType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_TYPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SERVICE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Priority</Label>
          <Select value={v.priority} onValueChange={(p) => set("priority", p as Priority)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className={editing ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-3"}>
        <div className={editing ? "hidden" : "space-y-1.5"}>
          <Label>Assign to</Label>
          <Select value={v.assignee_id ?? NONE} onValueChange={(id) => set("assignee_id", id === NONE ? null : id)} disabled={!client}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Unassigned for now</SelectItem>
              {people.data?.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name}
                  {u.role === "manager" ? " (manager)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="job-scheduled">Scheduled for</Label>
          <Input id="job-scheduled" type="date" value={v.scheduled_date} onChange={(e) => set("scheduled_date", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="job-due">Due by</Label>
          <Input id="job-due" type="date" value={v.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !v.client_id || !v.title.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** Shape the form values for POST /jobs. */
export function toJobPayload(v: JobFormValues, source: "manual" | "ai_intake" = "manual") {
  return {
    ...v,
    description: v.description || null,
    scheduled_date: v.scheduled_date || null,
    due_date: v.due_date || null,
    source,
  }
}
