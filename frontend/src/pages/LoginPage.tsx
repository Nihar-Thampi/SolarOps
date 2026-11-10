import { useState, type FormEvent } from "react"
import { Navigate } from "react-router-dom"
import { Loader2 } from "lucide-react"

import { errorMessage } from "@/api/client"
import { SunLogo } from "@/components/layout/AppLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/AuthContext"

const DEMO_PASSWORD = "SolarOps!2026"
const DEMO_ACCOUNTS = [
  { email: "admin@sunpeak.demo", who: "Alex Morgan", role: "Admin, all 4 regions" },
  { email: "priya@sunpeak.demo", who: "Priya Nair", role: "Manager, Metro and North Coast" },
  { email: "marco@sunpeak.demo", who: "Marco Ruiz", role: "Technician, Metro" },
  { email: "admin@brightgrid.demo", who: "Sam Patel", role: "Admin, second company (BrightGrid)" },
]

export default function LoginPage() {
  const { me, login } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to="/dashboard" replace />

  async function signIn(e: string, p: string) {
    setBusy(true)
    setError(null)
    try {
      await login(e, p)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    signIn(email, password)
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="panel-cells hidden flex-col justify-between p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <SunLogo className="size-9" />
          <span className="font-display text-xl font-semibold text-white">SolarOps</span>
        </div>
        <div className="max-w-lg">
          <h1 className="font-display text-5xl font-semibold leading-[1.02] tracking-tight text-white">
            Every panel cleaned, every inverter checked, every visit on record.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-sidebar-muted">
            Jobs go from a customer&rsquo;s call to a signed-off service report. Recurring services raise their own
            jobs when they come due.
          </p>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-sidebar-border pt-6">
            <div>
              <dt className="text-sm text-sidebar-muted">Intake</dt>
              <dd className="mt-1 font-medium text-white">Email or call to job</dd>
            </div>
            <div>
              <dt className="text-sm text-sidebar-muted">On site</dt>
              <dd className="mt-1 font-medium text-white">Notes to report</dd>
            </div>
            <div>
              <dt className="text-sm text-sidebar-muted">After</dt>
              <dd className="mt-1 font-medium text-white">Rating to insight</dd>
            </div>
          </dl>
        </div>
        <p className="text-sm text-sidebar-muted">Demo build with sample data.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <SunLogo className="size-8" />
            <span className="text-lg font-semibold">SolarOps</span>
          </div>
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use your work account, or try a demo account below.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="h-10 w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Sign in
            </Button>
          </form>

          <Card>
            <CardContent className="space-y-0.5 p-2">
              <p className="px-2 pb-1 pt-1 text-sm font-medium text-muted-foreground">Sign in with a demo account</p>
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  disabled={busy}
                  onClick={() => signIn(a.email, DEMO_PASSWORD)}
                  className="flex min-h-11 w-full flex-col justify-center rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                >
                  <span className="text-sm font-medium">{a.who}</span>
                  <span className="text-xs text-muted-foreground">{a.role}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
