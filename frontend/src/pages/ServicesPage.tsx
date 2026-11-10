import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CalendarPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, params } from "@/api/client"
import { EmptyState, PageHeader } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/context/AuthContext"
import { useRegion } from "@/context/RegionContext"
import { SERVICE_LABELS, fmtDate, fmtDue } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { JobDetail, Schedule } from "@/types"

const WINDOWS = { "14": "Next 14 days", "30": "Next 30 days", "90": "Next 90 days", all: "All schedules" } as const

/** Recurring maintenance each site needs, ordered by when it's due. */
export default function ServicesPage() {
  const { canManage } = useAuth()
  const { regionId } = useRegion()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [win, setWin] = useState<keyof typeof WINDOWS>("30")

  const schedules = useQuery({
    queryKey: ["schedules", regionId, win],
    queryFn: async () =>
      (
        await api.get<Schedule[]>("/schedules", {
          params: params({ region_id: regionId, due_within_days: win === "all" ? null : Number(win) }),
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const raise = useMutation({
    mutationFn: async (id: string) => (await api.post<JobDetail>(`/schedules/${id}/job`)).data,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(`${job.number} created`, { action: { label: "Open", onClick: () => navigate(`/jobs/${job.id}`) } })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const rows = schedules.data ?? []
  const overdue = rows.filter((s) => s.days_until_due < 0 && !s.open_job_id).length

  return (
    <div>
      <PageHeader
        title="Required services"
        description="Recurring maintenance due at each site. Raise a job for a service when it comes due; completing that job resets the next due date."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={win} onValueChange={(v) => setWin(v as keyof typeof WINDOWS)}>
          <TabsList>
            {Object.entries(WINDOWS).map(([k, label]) => (
              <TabsTrigger key={k} value={k}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" /> {overdue} overdue with no job yet
          </span>
        )}
      </div>

      <Card className={cn("overflow-hidden transition-opacity", schedules.isPlaceholderData && "opacity-60")}>
        {rows.length === 0 && !schedules.isLoading ? (
          <div className="p-6">
            <EmptyState title="Nothing due in this window" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Service</TableHead>
                <TableHead>Client · site</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Every</TableHead>
                <TableHead>Last done</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead className="pr-4 text-right">Job</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4 font-medium">{SERVICE_LABELS[s.service_type]}</TableCell>
                  <TableCell>
                    <Link to={`/clients/${s.client_id}?site=${s.site_id}`} className="hover:underline">
                      {s.client_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{s.site_name}</div>
                  </TableCell>
                  <TableCell>{s.region.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{s.interval_days} days</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(s.last_done_date)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fmtDate(s.next_due_date)}
                    <div className={cn("text-xs", s.days_until_due < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {fmtDue(s.next_due_date)}
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {s.open_job_id ? (
                      <Link to={`/jobs/${s.open_job_id}`}>
                        <Badge variant="secondary">{s.open_job_number}</Badge>
                      </Link>
                    ) : canManage ? (
                      <Button size="sm" variant="outline" onClick={() => raise.mutate(s.id)} disabled={raise.isPending}>
                        {raise.isPending && raise.variables === s.id ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
                        Create job
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">No job yet</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
