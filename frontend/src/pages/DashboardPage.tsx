import { Link, useNavigate } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { api, params } from "@/api/client"
import { HBarChart, MiniTable, SentimentBar, ThemesChart, WeeklyChart } from "@/components/charts"
import {
  ChartCard,
  EmptyState,
  LegendItem,
  PageHeader,
  PriorityLabel,
  Stars,
  StatTile,
} from "@/components/common"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth, useMe } from "@/context/AuthContext"
import { useRegion } from "@/context/RegionContext"
import { SERVICE_LABELS, fmtDate, fmtDue } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Dashboard } from "@/types"

export default function DashboardPage() {
  const me = useMe()
  const { canManage } = useAuth()
  const { regionId } = useRegion()
  const navigate = useNavigate()
  const { data, isPlaceholderData } = useQuery({
    queryKey: ["dashboard", regionId],
    queryFn: async () => (await api.get<Dashboard>("/dashboard", { params: params({ region_id: regionId }) })).data,
    placeholderData: keepPreviousData,
  })

  if (!data) {
    return <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
  }
  const k = data.kpis
  const delta = k.completed_30d - k.completed_prev_30d
  const firstName = me.user.full_name.split(" ")[0]

  return (
    // Hold the previous numbers (dimmed) while a new region loads, instead of flashing.
    <div className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${firstName}`}
        description="Open work, upcoming services and how customers feel, for the regions you've selected."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Open jobs" value={k.open_jobs} hint={`${k.urgent_jobs} urgent`} onClick={() => navigate("/jobs")} />
        <StatTile
          label="Unassigned"
          value={k.unassigned_jobs}
          tone={k.unassigned_jobs ? "warning" : undefined}
          hint="Need an owner"
          onClick={() => navigate("/jobs?assignee=unassigned")}
        />
        <StatTile
          label="Overdue"
          value={k.overdue_jobs}
          tone={k.overdue_jobs ? "critical" : undefined}
          hint="Past due date"
          onClick={() => navigate("/jobs?overdue=1")}
        />
        <StatTile label="Services due" value={k.services_due} hint="Next 14 days, no job yet" onClick={() => navigate("/services")} />
        <StatTile
          label="Completed, 30 days"
          value={k.completed_30d}
          hint={
            <span className={delta >= 0 ? "text-success" : "text-destructive"}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} vs prior 30 days
            </span>
          }
        />
        <StatTile
          label="Avg rating, 90 days"
          value={k.avg_rating_90d ? k.avg_rating_90d.toFixed(1) : "—"}
          hint={`${k.feedback_90d} reviews`}
          onClick={canManage ? () => navigate("/feedback") : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Jobs created vs completed"
          description="Per week, last 12 weeks"
          legend={
            <>
              <LegendItem color="var(--chart-1)" label="Completed" />
              <LegendItem color="var(--chart-2)" label="Created" />
            </>
          }
          table={
            <MiniTable
              head={["Week of", "Created", "Completed"]}
              rows={data.weekly.map((w) => [fmtDate(w.week_start), w.created, w.completed])}
            />
          }
        >
          <WeeklyChart data={data.weekly} />
        </ChartCard>

        <ChartCard
          title="Open jobs by status"
          table={<MiniTable head={["Status", "Jobs"]} rows={data.jobs_by_status.map((r) => [r.label, r.count])} />}
        >
          <HBarChart
            data={data.jobs_by_status.map((r) => ({ label: r.label, value: r.count, id: r.key }))}
            valueLabel="Open jobs"
            onBarClick={(r) => navigate(`/jobs?status=${r.id}`)}
          />
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="font-display text-lg font-semibold text-foreground">By region</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <MiniTable
              head={["Region", "Open", "Unassigned", "Overdue", "Completed (30d)"]}
              rows={data.regions.map((r) => [r.region, r.open, r.unassigned, r.overdue, r.completed_30d])}
            />
          </CardContent>
        </Card>

        <ChartCard
          title="Technician workload"
          description="Open jobs assigned to each technician"
          table={
            <MiniTable head={["Technician", "Open", "In progress"]} rows={data.workload.map((w) => [w.name, w.open, w.in_progress])} />
          }
        >
          {data.workload.length ? (
            <HBarChart
              data={data.workload.map((w) => ({ label: w.name, value: w.open, id: w.user_id }))}
              valueLabel="Open jobs"
              onBarClick={(r) => navigate(`/jobs?assignee=${r.id}`)}
            />
          ) : (
            <EmptyState title="No technicians in this region" />
          )}
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ActionList title="Unassigned jobs" link="/jobs?assignee=unassigned" empty="Every open job has an owner.">
          {data.unassigned.map((j) => (
            <Link key={j.id} to={`/jobs/${j.id}`} className="block rounded-md px-2 py-2 hover:bg-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{j.title}</span>
                <PriorityLabel priority={j.priority} />
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {j.number} · {j.client_name} · {j.region.name}
              </div>
            </Link>
          ))}
        </ActionList>

        <ActionList title="Services coming due" link="/services" empty="No services due in the next 14 days.">
          {data.due_services.map((s) => (
            <Link key={s.id} to="/services" className="block rounded-md px-2 py-2 hover:bg-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{SERVICE_LABELS[s.service_type]}</span>
                <span className={cn("text-xs", s.days_until_due < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {fmtDue(s.next_due_date)}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {s.client_name} · {s.site_name}
              </div>
            </Link>
          ))}
        </ActionList>

        <ActionList
          title="Recent unhappy customers"
          link={canManage ? "/feedback?sentiment=negative" : undefined}
          empty="No negative feedback in the last 90 days."
        >
          {data.recent_negative.map((f) => (
            <Link key={f.id} to={`/jobs/${f.job_id}`} className="block rounded-md px-2 py-2 hover:bg-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{f.client_name}</span>
                <Stars rating={f.rating} className="text-xs" />
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">{f.comment || "No comment"}</div>
            </Link>
          ))}
        </ActionList>
      </div>

      {canManage && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <ChartCard
            title="Customer sentiment"
            description="AI-analyzed reviews, last 90 days"
            table={<MiniTable head={["Sentiment", "Reviews"]} rows={data.sentiment.map((s) => [s.label, s.count])} />}
          >
            <SentimentBar data={data.sentiment} />
          </ChartCard>
          <ChartCard
            className="lg:col-span-2"
            title="What customers talk about"
            description="Themes the AI found in reviews, split by sentiment"
            legend={
              <>
                <LegendItem color="var(--chart-1)" label="Positive" />
                <LegendItem color="var(--chart-mid)" label="Neutral" />
                <LegendItem color="var(--chart-neg)" label="Negative" />
              </>
            }
            table={
              <MiniTable
                head={["Theme", "Positive", "Neutral", "Negative"]}
                rows={data.themes.map((t) => [t.theme, t.positive, t.neutral, t.negative])}
              />
            }
          >
            {data.themes.length ? <ThemesChart data={data.themes} /> : <EmptyState title="No reviews yet" />}
          </ChartCard>
        </div>
      )}
    </div>
  )
}

function ActionList({
  title,
  link,
  empty,
  children,
}: {
  title: string
  link?: string
  empty: string
  children: React.ReactNode[]
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-5 pb-2">
        <CardTitle className="font-display text-lg font-semibold text-foreground">{title}</CardTitle>
        {link && (
          <Link to={link} className="text-sm font-medium text-link underline-offset-4 hover:underline">
            View all
          </Link>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {children.length ? children : <p className="px-2 py-4 text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  )
}
