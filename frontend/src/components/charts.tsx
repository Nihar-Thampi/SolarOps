/**
 * Dashboard charts. Colors come from the validated reference palette (see index.css
 * --chart-*): blue/orange for the two-series trend, and the blue <-> red diverging pair
 * with a gray midpoint for sentiment. Every chart is paired with a table view (ChartCard).
 */
import type { ReactNode } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts"
import { format, parseISO } from "date-fns"

type TipProps = TooltipContentProps<TooltipValueType, string | number>

const AXIS = { stroke: "var(--chart-axis)", tick: { fill: "var(--chart-muted)", fontSize: 12 }, tickLine: false }

function TooltipBox({ title, rows }: { title: ReactNode; rows: { color: string; label: string; value: ReactNode }[] }) {
  return (
    <div className="min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="font-medium tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

// ---- Weekly created vs completed (two series, one axis) ----

export interface WeekPoint {
  week_start: string
  created: number
  completed: number
}

const weekLabel = (d: string) => format(parseISO(d), "d MMM")

export function WeeklyChart({ data }: { data: WeekPoint[] }) {
  const last = data[data.length - 1]
  // Endpoint labels: the higher series' label sits above its point, the other below, so they never collide.
  const completedOnTop = (last?.completed ?? 0) >= (last?.created ?? 0)
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 16, right: 92, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="week_start" tickFormatter={weekLabel} {...AXIS} interval="preserveStartEnd" minTickGap={24} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} width={40} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)" }}
          content={({ active, payload, label }: TipProps) =>
            active && payload?.length ? (
              <TooltipBox
                title={`Week of ${weekLabel(String(label))}`}
                rows={[
                  { color: "var(--chart-1)", label: "Completed", value: payload.find((p) => p.dataKey === "completed")?.value },
                  { color: "var(--chart-2)", label: "Created", value: payload.find((p) => p.dataKey === "created")?.value },
                ]}
              />
            ) : null
          }
        />
        <Line
          type="linear"
          dataKey="completed"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: "var(--chart-surface)", strokeWidth: 2 }}
        >
          {/* Direct label on the endpoint only. */}
          <LabelList
            dataKey="completed"
            content={({ x, y, index }) =>
              index === data.length - 1 ? (
                <text x={Number(x) + 8} y={Number(y) + (completedOnTop ? -4 : 14)} fontSize={12} fill="var(--foreground)">
                  {last?.completed} completed
                </text>
              ) : null
            }
          />
        </Line>
        <Line
          type="linear"
          dataKey="created"
          stroke="var(--chart-2)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: "var(--chart-surface)", strokeWidth: 2 }}
        >
          <LabelList
            dataKey="created"
            content={({ x, y, index }) =>
              index === data.length - 1 ? (
                <text x={Number(x) + 8} y={Number(y) + (completedOnTop ? 14 : -4)} fontSize={12} fill="var(--muted-foreground)">
                  {last?.created} created
                </text>
              ) : null
            }
          />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  )
}

// ---- Single-series horizontal bars (status, workload) ----

export function HBarChart({
  data,
  valueLabel,
  onBarClick,
}: {
  data: { label: string; value: number; id?: string }[]
  valueLabel: string
  onBarClick?: (row: { label: string; value: number; id?: string }) => void
}) {
  const height = Math.max(120, data.length * 34 + 16)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={8}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={120} {...AXIS} axisLine={false} />
        <Tooltip
          cursor={{ fill: "var(--accent)", opacity: 0.5 }}
          content={({ active, payload }: TipProps) =>
            active && payload?.length ? (
              <TooltipBox
                title={payload[0].payload.label}
                rows={[{ color: "var(--chart-1)", label: valueLabel, value: payload[0].value }]}
              />
            ) : null
          }
        />
        <Bar
          dataKey="value"
          fill="var(--chart-1)"
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          cursor={onBarClick ? "pointer" : undefined}
          onClick={onBarClick ? (d) => onBarClick(d.payload) : undefined}
        >
          <LabelList dataKey="value" position="right" fontSize={12} fill="var(--foreground)" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---- Sentiment: one 100% bar, diverging blue (positive) / gray / red (negative) ----

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "var(--chart-1)",
  neutral: "var(--chart-mid)",
  negative: "var(--chart-neg)",
}

export function SentimentBar({ data }: { data: { key: string; label: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  return (
    <div>
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label="Sentiment split">
        {data
          .filter((d) => d.count > 0)
          .map((d) => (
            <div
              key={d.key}
              title={`${d.label}: ${d.count}`}
              style={{ width: `${(100 * d.count) / total}%`, background: SENTIMENT_COLORS[d.key] }}
            />
          ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {data.map((d) => (
          <div key={d.key}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2.5 rounded-sm" style={{ background: SENTIMENT_COLORS[d.key] }} />
              {d.label}
            </div>
            <div className="text-xl font-semibold">{Math.round((100 * d.count) / total)}%</div>
            <div className="text-xs text-muted-foreground">{d.count} reviews</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Themes: stacked bars split by sentiment, 2px surface gap between segments ----

export interface ThemeRow {
  theme: string
  positive: number
  neutral: number
  negative: number
}

export function ThemesChart({ data }: { data: ThemeRow[] }) {
  const height = Math.max(120, data.length * 30 + 16)
  const seg = { stroke: "var(--chart-surface)", strokeWidth: 2, maxBarSize: 16 }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="theme" width={128} {...AXIS} axisLine={false} />
        <Tooltip
          cursor={{ fill: "var(--accent)", opacity: 0.5 }}
          content={({ active, payload }: TipProps) =>
            active && payload?.length ? (
              <TooltipBox
                title={payload[0].payload.theme}
                rows={[
                  { color: "var(--chart-1)", label: "Positive", value: payload[0].payload.positive },
                  { color: "var(--chart-mid)", label: "Neutral", value: payload[0].payload.neutral },
                  { color: "var(--chart-neg)", label: "Negative", value: payload[0].payload.negative },
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="positive" stackId="s" fill="var(--chart-1)" {...seg} />
        <Bar dataKey="neutral" stackId="s" fill="var(--chart-mid)" {...seg} />
        <Bar dataKey="negative" stackId="s" fill="var(--chart-neg)" radius={[0, 4, 4, 0]} {...seg} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={i ? "py-1.5 text-right font-medium" : "py-1.5 font-medium"}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])} className="border-b last:border-0">
            {r.map((c, i) => (
              <td key={i} className={i ? "py-1.5 text-right tabular-nums" : "py-1.5"}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
