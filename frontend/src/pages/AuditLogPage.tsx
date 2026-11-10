import { Fragment, useState } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { ChevronDown, Download, Loader2, Search, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, params } from "@/api/client"
import { EmptyState, PageHeader } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ROLE_LABELS, fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Page, Role, User } from "@/types"

interface AuditEntry {
  id: number
  created_at: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  user_role: string | null
  action: string
  summary: string
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  changes: Record<string, [unknown, unknown]> | null
  method: string
  path: string
  status_code: number
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  duration_ms: number
  hash: string
}

interface VerifyResult {
  valid: boolean
  entries_checked: number
  broken_at_id: number | null
  broken_at: string | null
}

const ANY = "__any__"
const PAGE = 50

// Action families shown in the filter; the backend matches "job" to every job.* action.
const CATEGORIES: Record<string, string> = {
  auth: "Sign-ins",
  access: "Refused requests",
  job: "Jobs",
  report: "Service reports",
  client: "Clients",
  site: "Sites",
  schedule: "Recurring services",
  user: "People",
  region: "Regions",
  feedback: "Feedback",
  ai: "AI",
  audit: "Audit trail access",
}

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  job: (id) => `/jobs/${id}`,
  client: (id) => `/clients/${id}`,
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

function Outcome({ status }: { status: number }) {
  if (status === 401 || status === 403)
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <ShieldX className="size-3" /> Refused
      </Badge>
    )
  if (status >= 400)
    return (
      <Badge variant="outline" className="gap-1 text-warning">
        Failed · {status}
      </Badge>
    )
  return <span className="text-xs text-muted-foreground">OK</span>
}

/** Admin-only: the tamper-evident trail of everything people did on the platform. */
export default function AuditLogPage() {
  const [filters, setFilters] = useState({
    user_id: "",
    action: "",
    outcome: "",
    date_from: "",
    date_to: "",
    q: "",
  })
  const [q, setQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setOffset(0)
  }

  const users = useQuery({ queryKey: ["users", "all-admin"], queryFn: async () => (await api.get<User[]>("/users")).data })
  const log = useQuery({
    queryKey: ["audit", filters, offset],
    queryFn: async () =>
      (await api.get<Page<AuditEntry>>("/audit", { params: params({ ...filters, limit: PAGE, offset }) })).data,
    placeholderData: keepPreviousData,
  })
  const verify = useMutation({
    mutationFn: async () => (await api.get<VerifyResult>("/audit/verify")).data,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await api.get<Blob>("/audit/export", { params: params(filters), responseType: "blob" })
      const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] ?? "")?.[1] ?? "audit-log.csv"
      const url = URL.createObjectURL(res.data)
      const a = Object.assign(document.createElement("a"), { href: url, download: name })
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const items = log.data?.items ?? []
  const total = log.data?.total ?? 0

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every change, sign-in and refused request on the platform: who, what, when and from where. Only admins can see this page. Entries can't be edited or deleted."
        actions={
          <>
            <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
              {verify.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Verify integrity
            </Button>
            <Button variant="outline" onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
              {exportCsv.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              Export CSV
            </Button>
          </>
        }
      />

      {verify.data && (
        <div
          className={cn(
            "mb-4 flex items-start gap-3 rounded-lg border p-4 text-sm",
            verify.data.valid ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"
          )}
        >
          {verify.data.valid ? <ShieldCheck className="size-5 shrink-0 text-success" /> : <ShieldAlert className="size-5 shrink-0 text-destructive" />}
          <div>
            <p className="font-medium">
              {verify.data.valid ? "Audit trail intact" : `Audit trail broken at entry #${verify.data.broken_at_id}`}
            </p>
            <p className="text-muted-foreground">
              {verify.data.valid
                ? `All ${verify.data.entries_checked} entries match their hash chain: nothing has been altered, removed or reordered.`
                : `Entry #${verify.data.broken_at_id} (${fmtDateTime(verify.data.broken_at)}) doesn't match its recorded hash. It, or an entry before it, was changed outside the application.`}
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault()
            set("q", q.trim())
          }}
        >
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => set("q", q.trim())}
            placeholder="Search summary, record, email, IP"
            className="h-9 w-64 pl-8"
          />
        </form>
        <Select value={filters.user_id || ANY} onValueChange={(v) => set("user_id", v === ANY ? "" : v)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Anyone</SelectItem>
            {users.data?.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.action || ANY} onValueChange={(v) => set("action", v === ANY ? "" : v)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All activity</SelectItem>
            {Object.entries(CATEGORIES).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.outcome || ANY} onValueChange={(v) => set("outcome", v === ANY ? "" : v)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any outcome</SelectItem>
            <SelectItem value="success">Succeeded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="denied">Refused (401/403)</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Input type="date" className="h-9 w-38" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} aria-label="From date" />
          to
          <Input type="date" className="h-9 w-38" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} aria-label="To date" />
        </div>
      </div>

      <Card className={cn("overflow-hidden transition-opacity", log.isPlaceholderData && "opacity-60")}>
        {items.length === 0 && !log.isLoading ? (
          <div className="p-6">
            <EmptyState title="No activity matches these filters" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>IP address</TableHead>
                <TableHead className="pr-4">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <Fragment key={e.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <TableCell className="pl-4 align-top whitespace-nowrap">
                      <ChevronDown className={cn("mr-1 inline size-4 text-muted-foreground transition-transform", open === e.id && "rotate-180")} />
                      {fmtDateTime(e.created_at)}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="font-medium">{e.user_name ?? e.user_email ?? <span className="text-muted-foreground">Unknown</span>}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.user_role ? (ROLE_LABELS[e.user_role as Role] ?? e.user_role) : "Not signed in"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md align-top">
                      <div className="whitespace-normal">{e.summary}</div>
                      <code className="text-xs text-muted-foreground">{e.action}</code>
                    </TableCell>
                    <TableCell className="max-w-56 align-top">
                      {e.entity_label ? (
                        e.entity_id && e.entity_type && ENTITY_LINKS[e.entity_type] ? (
                          <Link
                            to={ENTITY_LINKS[e.entity_type](e.entity_id)}
                            className="block truncate text-link hover:underline"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            {e.entity_label}
                          </Link>
                        ) : (
                          <span className="block truncate">{e.entity_label}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs tabular-nums">{e.ip_address ?? "—"}</TableCell>
                    <TableCell className="pr-4 align-top">
                      <Outcome status={e.status_code} />
                    </TableCell>
                  </TableRow>
                  {open === e.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-muted/40 p-4 whitespace-normal">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Changes</p>
                            {e.changes && Object.keys(e.changes).length ? (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-muted-foreground">
                                    <th className="py-1 pr-3 font-medium">Field</th>
                                    <th className="py-1 pr-3 font-medium">Before</th>
                                    <th className="py-1 font-medium">After</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(e.changes).map(([field, [before, after]]) => (
                                    <tr key={field} className="border-t align-top">
                                      <td className="py-1 pr-3 font-medium">{field.replace(/_/g, " ")}</td>
                                      <td className="py-1 pr-3 text-muted-foreground line-through decoration-muted-foreground/50">{show(before)}</td>
                                      <td className="py-1">{show(after)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-xs text-muted-foreground">No field changes recorded for this action.</p>
                            )}
                          </div>
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                            <dt className="text-muted-foreground">Entry</dt>
                            <dd>#{e.id}</dd>
                            <dt className="text-muted-foreground">Account</dt>
                            <dd>{e.user_email ?? "—"}</dd>
                            <dt className="text-muted-foreground">Request</dt>
                            <dd className="break-all">
                              <code>
                                {e.method} {e.path}
                              </code>{" "}
                              → {e.status_code} in {e.duration_ms} ms
                            </dd>
                            <dt className="text-muted-foreground">Request ID</dt>
                            <dd>
                              <code>{e.request_id ?? "—"}</code>
                            </dd>
                            <dt className="text-muted-foreground">Device</dt>
                            <dd className="break-all">{e.user_agent || "—"}</dd>
                            <dt className="text-muted-foreground">Chain hash</dt>
                            <dd className="break-all">
                              <code>{e.hash}</code>
                            </dd>
                          </dl>
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

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total} entries
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Newer
            </Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
              Older
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
