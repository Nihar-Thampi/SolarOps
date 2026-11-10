// Mirrors backend/app/schemas.py.

export type Role = "admin" | "manager" | "technician"
export type ClientType = "residential" | "commercial" | "utility"
export type ServiceType =
  | "panel_cleaning"
  | "inverter_service"
  | "thermal_inspection"
  | "electrical_safety"
  | "vegetation_control"
  | "fault_repair"
  | "monitoring_check"
  | "installation_audit"
export type Priority = "low" | "medium" | "high" | "urgent"
export type JobStatus = "new" | "scheduled" | "in_progress" | "on_hold" | "completed" | "cancelled"
export type JobSource = "manual" | "ai_intake" | "schedule"
export type Sentiment = "positive" | "neutral" | "negative"

export interface Region {
  id: string
  name: string
  code: string
}

export interface UserBrief {
  id: string
  full_name: string
  role: Role
}

export interface User extends UserBrief {
  email: string
  phone: string | null
  skills: string[]
  is_active: boolean
  regions: Region[]
}

export interface Tenant {
  id: string
  name: string
  slug: string
}

export interface Me {
  user: User
  tenant: Tenant
  visible_regions: Region[]
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface Client {
  id: string
  region: Region
  name: string
  client_type: ClientType
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  created_at: string
}

export interface ClientListItem extends Client {
  site_count: number
  open_jobs: number
}

export interface Site {
  id: string
  client_id: string
  client_name: string
  region: Region
  name: string
  address: string | null
  system_size_kw: number | null
  panel_count: number | null
  panel_model: string | null
  inverter_model: string | null
  has_battery: boolean
  install_date: string | null
}

export interface Schedule {
  id: string
  site_id: string
  site_name: string
  client_id: string
  client_name: string
  region: Region
  service_type: ServiceType
  interval_days: number
  last_done_date: string | null
  next_due_date: string
  is_active: boolean
  days_until_due: number
  open_job_id: string | null
  open_job_number: string | null
}

export interface JobEvent {
  id: string
  kind: string
  message: string
  created_at: string
  user: UserBrief | null
}

export interface JobListItem {
  id: string
  number: string
  title: string
  service_type: ServiceType
  priority: Priority
  status: JobStatus
  source: JobSource
  region: Region
  client_id: string
  client_name: string
  site: { id: string; name: string; address: string | null } | null
  assignee: UserBrief | null
  scheduled_date: string | null
  due_date: string | null
  completed_at: string | null
  created_at: string
  is_overdue: boolean
}

export interface Report {
  id: string
  technician_notes: string
  summary: string
  work_performed: string[]
  findings: string[]
  recommendations: string[]
  readings: Record<string, string>
  status: "draft" | "final"
  ai_generated: boolean
  finalized_at: string | null
  author: UserBrief | null
  updated_at: string
}

export interface FeedbackItem {
  id: string
  job_id: string
  job_number: string
  client_id: string
  client_name: string
  region: Region
  rating: number
  comment: string
  sentiment: Sentiment | null
  sentiment_score: number | null
  themes: string[]
  created_at: string
}

export interface JobDetail extends JobListItem {
  description: string | null
  client: Client
  site_detail: Site | null
  schedule_id: string | null
  events: JobEvent[]
  report: Report | null
  feedback: FeedbackItem | null
  feedback_url: string | null
  suggested_assignees: UserBrief[]
}

export interface IntakeDraft {
  title: string
  description: string
  service_type: ServiceType
  priority: Priority
  client_id: string | null
  site_id: string | null
  new_client_name: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  reasoning: string
  confidence: number
  provider: string
  model: string
}

export interface Insights {
  summary: string
  praise: string[]
  complaints: string[]
  suggested_actions: string[]
  feedback_count: number
  provider: string
  model: string
  generated_at: string
}

export interface AIRequestLog {
  id: string
  feature: string
  provider: string
  model: string
  input_text: string
  output_text: string
  success: boolean
  error: string | null
  latency_ms: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
  user: UserBrief | null
}

export interface AIStatus {
  provider: string
  model: string
  is_demo: boolean
}

export interface CountRow {
  key: string
  label: string
  count: number
}

export interface Dashboard {
  kpis: {
    open_jobs: number
    unassigned_jobs: number
    overdue_jobs: number
    urgent_jobs: number
    services_due: number
    completed_30d: number
    completed_prev_30d: number
    avg_rating_90d: number | null
    feedback_90d: number
  }
  jobs_by_status: CountRow[]
  jobs_by_service: CountRow[]
  regions: { region_id: string; region: string; open: number; unassigned: number; overdue: number; completed_30d: number }[]
  weekly: { week_start: string; completed: number; created: number }[]
  workload: { user_id: string; name: string; open: number; in_progress: number }[]
  sentiment: CountRow[]
  themes: { theme: string; positive: number; neutral: number; negative: number }[]
  unassigned: JobListItem[]
  due_services: Schedule[]
  recent_negative: FeedbackItem[]
}

export interface PublicFeedbackJob {
  company_name: string
  job_number: string
  title: string
  site_name: string | null
  completed_at: string | null
  already_submitted: boolean
}
