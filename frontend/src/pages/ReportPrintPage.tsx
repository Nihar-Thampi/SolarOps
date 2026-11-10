import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Printer } from "lucide-react"

import { api } from "@/api/client"
import { ReportView } from "@/components/jobs/ReportPanel"
import { SunLogo } from "@/components/layout/AppLayout"
import { Button } from "@/components/ui/button"
import { useMe } from "@/context/AuthContext"
import { SERVICE_LABELS, fmtDate } from "@/lib/format"
import type { JobDetail } from "@/types"

/** A clean, printable service report (the browser's "Save as PDF" makes the PDF). */
export default function ReportPrintPage() {
  const { id } = useParams()
  const me = useMe()
  const { data: job } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => (await api.get<JobDetail>(`/jobs/${id}`)).data,
  })

  useEffect(() => {
    if (job) document.title = `Service report ${job.number}`
  }, [job])

  if (!job) return <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
  const site = job.site_detail

  return (
    <div className="min-h-dvh bg-muted/40 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl justify-end px-4">
        <Button onClick={() => window.print()}>
          <Printer /> Print or save as PDF
        </Button>
      </div>
      <article className="mx-auto max-w-3xl bg-card p-10 text-card-foreground shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b pb-6">
          <div className="flex items-center gap-3">
            <SunLogo className="size-10" />
            <div>
              <div className="text-lg font-semibold">{me.tenant.name}</div>
              <div className="text-sm text-muted-foreground">Service report</div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{job.number}</div>
            <div className="text-muted-foreground">{fmtDate(job.completed_at ?? job.report?.finalized_at)}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b py-6 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Customer</h3>
            <p className="font-medium">{job.client.name}</p>
            {job.client.contact_name && <p>{job.client.contact_name}</p>}
            {job.client.address && <p className="text-muted-foreground">{job.client.address}</p>}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Site</h3>
            <p className="font-medium">{site?.name ?? "—"}</p>
            {site && (
              <p className="text-muted-foreground">
                {site.system_size_kw} kW · {site.panel_count} panels · {site.inverter_model}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Service</h3>
            <p>{SERVICE_LABELS[job.service_type]}</p>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Technician</h3>
            <p>{job.report?.author?.full_name ?? job.assignee?.full_name ?? "—"}</p>
          </div>
        </section>

        <section className="py-6">
          {job.report ? <ReportView report={job.report} /> : <p className="text-muted-foreground">No report yet.</p>}
        </section>

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          Report {job.report?.status === "final" ? "finalized" : "draft"} for {job.title}. Questions? Contact {me.tenant.name}.
        </footer>
      </article>
    </div>
  )
}
