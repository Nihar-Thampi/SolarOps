import { Suspense, lazy, type ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Loader2 } from "lucide-react"

import { AppLayout } from "@/components/layout/AppLayout"
import { useAuth } from "@/context/AuthContext"
import { RegionProvider } from "@/context/RegionContext"
import type { Role } from "@/types"
import LoginPage from "@/pages/LoginPage"

// Pages load on demand, so the login screen doesn't download the charts.
const AiActivityPage = lazy(() => import("@/pages/AiActivityPage"))
const AuditLogPage = lazy(() => import("@/pages/AuditLogPage"))
const ClientDetailPage = lazy(() => import("@/pages/ClientDetailPage"))
const ClientsPage = lazy(() => import("@/pages/ClientsPage"))
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))
const FeedbackPage = lazy(() => import("@/pages/FeedbackPage"))
const JobDetailPage = lazy(() => import("@/pages/JobDetailPage"))
const JobsPage = lazy(() => import("@/pages/JobsPage"))
const PublicFeedbackPage = lazy(() => import("@/pages/PublicFeedbackPage"))
const ReportPrintPage = lazy(() => import("@/pages/ReportPrintPage"))
const ServicesPage = lazy(() => import("@/pages/ServicesPage"))
const TeamPage = lazy(() => import("@/pages/TeamPage"))

const spinner = (
  <div className="flex h-dvh items-center justify-center">
    <Loader2 className="animate-spin text-muted-foreground" />
  </div>
)

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return spinner
  if (!me) return <Navigate to="/login" replace />
  return <RegionProvider>{children}</RegionProvider>
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth()
  return hasRole(...roles) ? children : <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <Suspense fallback={spinner}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/feedback/:token" element={<PublicFeedbackPage />} />
      <Route
        path="/jobs/:id/report"
        element={
          <Protected>
            <ReportPrintPage />
          </Protected>
        }
      />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route
          path="/feedback"
          element={
            <RoleGate roles={["admin", "manager"]}>
              <FeedbackPage />
            </RoleGate>
          }
        />
        <Route
          path="/team"
          element={
            <RoleGate roles={["admin"]}>
              <TeamPage />
            </RoleGate>
          }
        />
        <Route
          path="/audit-log"
          element={
            <RoleGate roles={["admin"]}>
              <AuditLogPage />
            </RoleGate>
          }
        />
        <Route
          path="/ai-activity"
          element={
            <RoleGate roles={["admin", "manager"]}>
              <AiActivityPage />
            </RoleGate>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
