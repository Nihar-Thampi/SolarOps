import { Fragment, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { CheckCircle2, ChevronDown, XCircle } from "lucide-react"

import { api, params } from "@/api/client"
import { EmptyState, PageHeader, StatTile } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AIRequestLog, AIStatus, Page } from "@/types"

const FEATURES: Record<string, string> = {
  intake: "Job intake",
  report: "Service report",
  feedback: "Feedback analysis",
  insights: "Feedback insights",
}

function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Every AI call: what was sent, what came back, which model, how long it took. */
export default function AiActivityPage() {
  const [feature, setFeature] = useState("all")
  const [open, setOpen] = useState<string | null>(null)

  const status = useQuery({ queryKey: ["ai-status"], queryFn: async () => (await api.get<AIStatus>("/ai/status")).data })
  const log = useQuery({
    queryKey: ["ai-requests", feature],
    queryFn: async () =>
      (await api.get<Page<AIRequestLog>>("/ai/requests", { params: params({ feature: feature === "all" ? null : feature, limit: 100 }) })).data,
    placeholderData: keepPreviousData,
  })

  const items = log.data?.items ?? []
  const failures = items.filter((r) => !r.success).length
  const avgMs = items.length ? Math.round(items.reduce((s, r) => s + r.latency_ms, 0) / items.length) : 0
  const tokens = items.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="AI activity"
        description="An audit log of AI requests: inputs, outputs, model, speed and failures. AI output is always a draft a person reviews."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Provider"
          value={<span className="text-xl">{status.data?.is_demo ? "Demo mode" : "Local model"}</span>}
          hint={status.data?.is_demo ? "Start Ollama and download the model to use it" : status.data?.model}
        />
        <StatTile label="Requests shown" value={log.data?.total ?? "—"} />
        <StatTile label="Avg latency" value={`${avgMs} ms`} hint="Shown requests" />
        <StatTile
          label="Fell back to rules"
          value={failures}
          tone={failures ? "warning" : undefined}
          hint={tokens ? `${tokens.toLocaleString()} tokens used` : "No tokens used in demo mode"}
        />
      </div>

      <Tabs value={feature} onValueChange={setFeature} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {Object.entries(FEATURES).map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className={cn("overflow-hidden transition-opacity", log.isPlaceholderData && "opacity-60")}>
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No AI requests yet">Use AI intake, draft a service report or generate feedback insights.</EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="pr-4">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <Fragment key={r.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <TableCell className="pl-4 whitespace-nowrap">
                      <ChevronDown className={cn("mr-1 inline size-4 text-muted-foreground transition-transform", open === r.id && "rotate-180")} />
                      {fmtDateTime(r.created_at)}
                    </TableCell>
                    <TableCell>{FEATURES[r.feature] ?? r.feature}</TableCell>
                    <TableCell>{r.user?.full_name ?? <span className="text-muted-foreground">Customer link</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {r.provider} · {r.model}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.latency_ms} ms</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.input_tokens != null ? `${r.input_tokens} / ${r.output_tokens}` : "—"}
                    </TableCell>
                    <TableCell className="pr-4">
                      {r.success ? (
                        <span className="inline-flex items-center gap-1 text-sm text-success">
                          <CheckCircle2 className="size-4" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-warning" title={r.error ?? ""}>
                          <XCircle className="size-4" /> Fallback used
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                  {open === r.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-muted/40 p-4">
                        {r.error && <p className="mb-2 text-sm text-warning">Error: {r.error}</p>}
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Input</p>
                            <pre className="max-h-72 overflow-auto rounded-md border bg-card p-3 text-xs whitespace-pre-wrap">{r.input_text}</pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Output</p>
                            <pre className="max-h-72 overflow-auto rounded-md border bg-card p-3 text-xs whitespace-pre-wrap">{pretty(r.output_text)}</pre>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
