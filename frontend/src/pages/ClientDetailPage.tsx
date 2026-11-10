import { useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Battery, CalendarPlus, ChevronDown, Loader2, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react"

import { api } from "@/api/client"
import { ClientDialog, ScheduleDialog, SiteDialog } from "@/components/clients/ClientForms"
import { AiBadge, EmptyState, Field, PriorityLabel, Stars, StatusBadge } from "@/components/common"
import { ReportView } from "@/components/jobs/ReportPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/context/AuthContext"
import { CLIENT_TYPE_LABELS, SERVICE_LABELS, fmtDate, fmtDue } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Client, JobDetail, JobListItem, Page, Schedule, Site } from "@/types"

export default function ClientDetailPage() {
  const { id } = useParams()
  const { canManage } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [editOpen, setEditOpen] = useState(false)
  const [siteDialog, setSiteDialog] = useState<{ site?: Site } | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const client = useQuery({ queryKey: ["client", id], queryFn: async () => (await api.get<Client>(`/clients/${id}`)).data })
  const sites = useQuery({ queryKey: ["sites", id], queryFn: async () => (await api.get<Site[]>("/sites", { params: { client_id: id } })).data })
  const openJobs = useQuery({
    queryKey: ["jobs", { client: id }],
    queryFn: async () => (await api.get<Page<JobListItem>>("/jobs", { params: { client_id: id, view: "open" } })).data.items,
  })

  const siteId = sp.get("site") ?? sites.data?.[0]?.id
  const site = sites.data?.find((s) => s.id === siteId)

  if (!client.data) return <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
  const c = client.data

  return (
    <div>
      <Link to="/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Clients
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <Badge variant="secondary">{CLIENT_TYPE_LABELS[c.client_type]}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{c.region.name}</span>
            {c.contact_name && <span>{c.contact_name}</span>}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Phone className="size-3.5" /> {c.phone}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Mail className="size-3.5" /> {c.email}
              </a>
            )}
          </div>
          {c.notes && <p className="mt-2 max-w-2xl text-sm">{c.notes}</p>}
        </div>
        {canManage && (
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil /> Edit client
          </Button>
        )}
      </div>

      {openJobs.data && openJobs.data.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="p-5 pb-2">
            <CardTitle className="text-base font-semibold text-foreground">Open jobs</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-5 pt-0">
            {openJobs.data.map((j) => (
              <Link key={j.id} to={`/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-accent/40">
                <span className="text-sm font-medium">
                  {j.number} · {j.title}
                </span>
                <span className="flex items-center gap-3">
                  <PriorityLabel priority={j.priority} />
                  <StatusBadge status={j.status} />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Sites</h2>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => setSiteDialog({})}>
                <Plus /> Add
              </Button>
            )}
          </div>
          {sites.data?.length === 0 && <EmptyState title="No sites yet" />}
          {sites.data?.map((s) => (
            <button
              key={s.id}
              onClick={() => setSp({ site: s.id }, { replace: true })}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                s.id === siteId ? "border-primary bg-accent/50" : "hover:bg-accent/40"
              )}
            >
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {s.system_size_kw ? `${s.system_size_kw} kW` : "Size unknown"}
                {s.has_battery ? " · battery" : ""}
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-4 lg:col-span-3">
          {site && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
                  <CardTitle className="text-base font-semibold text-foreground">{site.name}</CardTitle>
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => setSiteDialog({ site })}>
                      <Pencil /> Edit
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  {site.address && (
                    <p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" /> {site.address}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Field label="System size">{site.system_size_kw ? `${site.system_size_kw} kW` : "—"}</Field>
                    <Field label="Panels">{site.panel_count ? `${site.panel_count} × ${site.panel_model ?? ""}` : "—"}</Field>
                    <Field label="Inverter">{site.inverter_model ?? "—"}</Field>
                    <Field label="Installed">
                      {fmtDate(site.install_date)}
                      {site.has_battery && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Battery className="size-3.5" /> Battery
                        </span>
                      )}
                    </Field>
                  </dl>
                </CardContent>
              </Card>

              <SiteSchedules siteId={site.id} canManage={canManage} onAdd={() => setScheduleOpen(true)} />
              <MaintenanceHistory siteId={site.id} />
            </>
          )}
        </div>
      </div>

      <ClientDialog open={editOpen} onOpenChange={setEditOpen} client={c} />
      {siteDialog && <SiteDialog open onOpenChange={(v) => !v && setSiteDialog(null)} clientId={c.id} site={siteDialog.site} />}
      {site && scheduleOpen && <ScheduleDialog open onOpenChange={setScheduleOpen} siteId={site.id} />}
    </div>
  )
}

function SiteSchedules({ siteId, canManage, onAdd }: { siteId: string; canManage: boolean; onAdd: () => void }) {
  const schedules = useQuery({
    queryKey: ["schedules", "site", siteId],
    queryFn: async () => (await api.get<Schedule[]>("/schedules", { params: { site_id: siteId } })).data,
  })
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
        <CardTitle className="text-base font-semibold text-foreground">Recurring services</CardTitle>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <CalendarPlus /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-5 pt-0">
        {schedules.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recurring services set up.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {schedules.data?.map((s) => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{SERVICE_LABELS[s.service_type]}</span>
                  {s.open_job_id ? (
                    <Link to={`/jobs/${s.open_job_id}`}>
                      <Badge variant="secondary">{s.open_job_number}</Badge>
                    </Link>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Every {s.interval_days} days · last {fmtDate(s.last_done_date)}
                </div>
                <div className={cn("text-xs", s.days_until_due < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {fmtDue(s.next_due_date)} ({fmtDate(s.next_due_date)})
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MaintenanceHistory({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const history = useQuery({
    queryKey: ["site-history", siteId],
    queryFn: async () => (await api.get<JobDetail[]>(`/sites/${siteId}/history`)).data,
  })
  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <CardTitle className="text-base font-semibold text-foreground">Maintenance history</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No completed work at this site yet.</p>}
        <ol className="space-y-2">
          {history.data?.map((j) => (
            <li key={j.id} className="rounded-md border">
              <button className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen(open === j.id ? null : j.id)}>
                <span>
                  <span className="text-sm font-medium">{SERVICE_LABELS[j.service_type]}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {fmtDate(j.completed_at)} · {j.number} · {j.assignee?.full_name ?? "—"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {j.feedback && <Stars rating={j.feedback.rating} className="text-xs" />}
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open === j.id && "rotate-180")} />
                </span>
              </button>
              {open === j.id && (
                <div className="border-t p-3">
                  {j.report ? (
                    <>
                      {j.report.ai_generated && <AiBadge />}
                      <div className="mt-2">
                        <ReportView report={j.report} />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No report.</p>
                  )}
                  <Link to={`/jobs/${j.id}`} className="mt-3 inline-block text-xs text-link hover:underline">
                    Open job →
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
