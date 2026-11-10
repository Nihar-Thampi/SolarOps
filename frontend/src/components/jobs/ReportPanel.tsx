import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, FileText, Loader2, Lock, Plus, Printer, Sparkles, Trash2, Unlock } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/api/client"
import { AiBadge } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { fmtDateTime } from "@/lib/format"
import type { JobDetail, Report } from "@/types"

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean)

export function ReportView({ report }: { report: Report }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="leading-relaxed">{report.summary}</p>
      <ReportList title="Work performed" items={report.work_performed} />
      <ReportList title="Findings" items={report.findings} />
      <ReportList title="Recommendations" items={report.recommendations} />
      {Object.keys(report.readings).length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Readings</h4>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {Object.entries(report.readings).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  )
}

/** The service report: technician notes -> AI draft -> edit -> finalize (becomes the maintenance record). */
export function ReportPanel({ job, canWork, canManage }: { job: JobDetail; canWork: boolean; canManage: boolean }) {
  const queryClient = useQueryClient()
  const report = job.report
  const isFinal = report?.status === "final"
  const closed = job.status === "cancelled"

  const [notes, setNotes] = useState(report?.technician_notes ?? "")
  const [readings, setReadings] = useState<[string, string][]>(
    Object.entries(report?.readings ?? {}).length ? Object.entries(report!.readings) : [["", ""]]
  )
  const [editing, setEditing] = useState<{ summary: string; work: string; findings: string; recs: string } | null>(null)

  const onJob = (updated: JobDetail) => {
    queryClient.setQueryData(["job", job.id], updated)
    queryClient.invalidateQueries({ queryKey: ["jobs"] })
    queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }
  const readingsObj = Object.fromEntries(readings.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()]))

  const draft = useMutation({
    mutationFn: async () =>
      (await api.post<JobDetail>(`/jobs/${job.id}/report/draft`, { technician_notes: notes, readings: readingsObj })).data,
    onSuccess: (j) => {
      onJob(j)
      setEditing(null)
      toast.success("Report drafted. Review it, then finalize.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch<JobDetail>(`/jobs/${job.id}/report`, {
          summary: editing!.summary,
          work_performed: lines(editing!.work),
          findings: lines(editing!.findings),
          recommendations: lines(editing!.recs),
          readings: readingsObj,
        })
      ).data,
    onSuccess: (j) => {
      onJob(j)
      setEditing(null)
      toast.success("Report saved")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const finalize = useMutation({
    mutationFn: async () => (await api.post<JobDetail>(`/jobs/${job.id}/report/finalize`)).data,
    onSuccess: (j) => {
      onJob(j)
      toast.success(`Report finalized and ${j.number} completed`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const reopen = useMutation({
    mutationFn: async () => (await api.post<JobDetail>(`/jobs/${job.id}/report/reopen`)).data,
    onSuccess: onJob,
    onError: (e) => toast.error(errorMessage(e)),
  })

  const header = (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-5 pb-3">
      <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
        <FileText className="size-4" /> Service report
        {report && (
          <Badge variant={isFinal ? "success" : "secondary"} className="gap-1">
            {isFinal ? <Lock className="size-3" /> : null}
            {isFinal ? "Final" : "Draft"}
          </Badge>
        )}
        {report?.ai_generated && <AiBadge />}
      </CardTitle>
      {isFinal && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/jobs/${job.id}/report`} target="_blank">
              <Printer /> Print / PDF
            </Link>
          </Button>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              <Unlock /> Reopen
            </Button>
          )}
        </div>
      )}
    </CardHeader>
  )

  if (isFinal && report) {
    return (
      <Card>
        {header}
        <CardContent className="p-5 pt-0">
          <ReportView report={report} />
          <p className="mt-4 text-xs text-muted-foreground">
            Finalized {fmtDateTime(report.finalized_at)}
            {report.author ? ` by ${report.author.full_name}` : ""}. This is the site's maintenance record for this visit.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!canWork || closed) {
    return (
      <Card>
        {header}
        <CardContent className="p-5 pt-0 text-sm text-muted-foreground">
          {report ? <ReportView report={report} /> : "No report yet. The assigned technician writes it after the visit."}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      {header}
      <CardContent className="space-y-5 p-5 pt-0">
        <div className="space-y-1.5">
          <Label htmlFor="tech-notes">Technician notes</Label>
          <Textarea
            id="tech-notes"
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Write it the way you would on site, e.g. 'inv E-31, repl fan, found corrosion on DC terminals, recommend new isolator next visit'"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Readings (optional)</Label>
          {readings.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="e.g. Output after (kW)"
                value={k}
                onChange={(e) => setReadings((r) => r.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))}
              />
              <Input
                placeholder="Value"
                className="w-32"
                value={v}
                onChange={(e) => setReadings((r) => r.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove reading"
                onClick={() => setReadings((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [["", ""]]))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setReadings((r) => [...r, ["", ""]])}>
            <Plus /> Add reading
          </Button>
        </div>

        <Button onClick={() => draft.mutate()} disabled={!notes.trim() || draft.isPending}>
          {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {report ? "Redraft with AI" : "Draft report with AI"}
        </Button>

        {report && !editing && (
          <div className="rounded-lg border p-4">
            <ReportView report={report} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setEditing({
                    summary: report.summary,
                    work: report.work_performed.join("\n"),
                    findings: report.findings.join("\n"),
                    recs: report.recommendations.join("\n"),
                  })
                }
              >
                Edit
              </Button>
              <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>
                {finalize.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                Finalize & complete job
              </Button>
            </div>
          </div>
        )}

        {report && editing && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1.5">
              <Label>Summary</Label>
              <Textarea rows={3} value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} />
            </div>
            {(
              [
                ["work", "Work performed"],
                ["findings", "Findings"],
                ["recs", "Recommendations"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>
                  {label} <span className="font-normal text-muted-foreground">(one per line)</span>
                </Label>
                <Textarea rows={3} value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
