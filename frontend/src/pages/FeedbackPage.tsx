import { Link, useSearchParams } from "react-router-dom"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { Lightbulb, Loader2, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, params } from "@/api/client"
import { AiBadge, EmptyState, PageHeader, SentimentBadge, Stars } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRegion } from "@/context/RegionContext"
import { fmtAgo, fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { FeedbackItem, Insights, Page } from "@/types"

const ANY = "__any__"

export default function FeedbackPage() {
  const { regionId } = useRegion()
  const [sp, setSp] = useSearchParams()
  const sentiment = sp.get("sentiment")
  const theme = sp.get("theme")

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp)
    if (value) next.set(key, value)
    else next.delete(key)
    setSp(next, { replace: true })
  }

  const feedback = useQuery({
    queryKey: ["feedback", regionId, sentiment, theme],
    queryFn: async () =>
      (await api.get<Page<FeedbackItem>>("/feedback", { params: params({ region_id: regionId, sentiment, theme, limit: 100 }) })).data,
    placeholderData: keepPreviousData,
  })
  const themes = useQuery({
    queryKey: ["feedback-themes"],
    queryFn: async () => (await api.get<string[]>("/feedback/themes")).data,
    staleTime: Infinity,
  })
  const insights = useMutation({
    mutationFn: async () => (await api.post<Insights>("/feedback/insights", null, { params: params({ region_id: regionId }) })).data,
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div>
      <PageHeader
        title="Customer feedback"
        description="Reviews customers leave from the link sent after each completed visit. AI tags every review with sentiment and themes."
        actions={
          <Button onClick={() => insights.mutate()} disabled={insights.isPending}>
            {insights.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {insights.data ? "Refresh AI insights" : "Generate AI insights"}
          </Button>
        }
      />

      {insights.data && (
        <Card className="mb-6 border-primary/30">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              What customers are saying <AiBadge provider={insights.data.provider} />
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {insights.data.feedback_count} reviews, last 90 days · {fmtDateTime(insights.data.generated_at)}
            </span>
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-0">
            <p className="text-sm leading-relaxed">{insights.data.summary}</p>
            <div className="grid gap-4 md:grid-cols-3">
              <InsightList icon={ThumbsUp} title="Customers value" items={insights.data.praise} empty="Nothing stands out yet." />
              <InsightList icon={ThumbsDown} title="Recurring complaints" items={insights.data.complaints} empty="No recurring complaints." />
              <InsightList icon={Lightbulb} title="Suggested actions" items={insights.data.suggested_actions} empty="No actions needed." />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={sentiment ?? ANY} onValueChange={(v) => set("sentiment", v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any sentiment</SelectItem>
            <SelectItem value="positive">Positive</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="negative">Negative</SelectItem>
          </SelectContent>
        </Select>
        <Select value={theme ?? ANY} onValueChange={(v) => set("theme", v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any theme</SelectItem>
            {themes.data?.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {feedback.data && <span className="self-center text-sm text-muted-foreground">{feedback.data.total} reviews</span>}
      </div>

      <div className={cn("space-y-3 transition-opacity", feedback.isPlaceholderData && "opacity-60")}>
        {feedback.data?.items.length === 0 && <EmptyState title="No feedback matches these filters" />}
        {feedback.data?.items.map((f) => (
          <Card key={f.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <Stars rating={f.rating} />
                  <SentimentBadge sentiment={f.sentiment} />
                  {f.themes.map((t) => (
                    <Badge key={t} variant="secondary" className="cursor-pointer" onClick={() => set("theme", t)}>
                      {t}
                    </Badge>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground" title={fmtDateTime(f.created_at)}>
                  {fmtAgo(f.created_at)}
                </span>
              </div>
              <p className="mt-2 text-sm">{f.comment || <span className="text-muted-foreground">No comment.</span>}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {f.client_name} · {f.region.name} ·{" "}
                <Link to={`/jobs/${f.job_id}`} className="text-link hover:underline">
                  {f.job_number}
                </Link>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function InsightList({ icon: Icon, title, items, empty }: { icon: typeof ThumbsUp; title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h3>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}
