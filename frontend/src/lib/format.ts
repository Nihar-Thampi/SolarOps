import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from "date-fns"

import type { ClientType, JobStatus, Priority, Role, ServiceType } from "@/types"

export const SERVICE_LABELS: Record<ServiceType, string> = {
  panel_cleaning: "Panel cleaning",
  inverter_service: "Inverter service",
  thermal_inspection: "Thermal inspection",
  electrical_safety: "Electrical safety",
  vegetation_control: "Vegetation control",
  fault_repair: "Fault repair",
  monitoring_check: "Monitoring check",
  installation_audit: "Installation audit",
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  scheduled: "Scheduled",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  technician: "Technician",
}

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  residential: "Residential",
  commercial: "Commercial",
  utility: "Utility-scale",
}

export const SERVICE_TYPES = Object.keys(SERVICE_LABELS) as ServiceType[]
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"]

const toDate = (d: string) => (d.length === 10 ? parseISO(d) : new Date(d))

export function fmtDate(d: string | null | undefined): string {
  return d ? format(toDate(d), "d MMM yyyy") : "—"
}

export function fmtDateTime(d: string | null | undefined): string {
  return d ? format(toDate(d), "d MMM yyyy, HH:mm") : "—"
}

export function fmtAgo(d: string): string {
  return `${formatDistanceToNowStrict(toDate(d))} ago`
}

/** "in 3 days", "today", "5 days overdue" for a date-only string. */
export function fmtDue(d: string | null | undefined): string {
  if (!d) return "No due date"
  const days = differenceInCalendarDays(toDate(d), new Date())
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  if (days > 1) return `Due in ${days} days`
  return `${-days} day${days === -1 ? "" : "s"} overdue`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}
