import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useMe } from "@/context/AuthContext"
import { CLIENT_TYPE_LABELS, SERVICE_LABELS, SERVICE_TYPES } from "@/lib/format"
import type { Client, ClientType, Schedule, ServiceType, Site } from "@/types"

function useSave<T>(url: string, method: "post" | "patch", onDone: (data: T) => void, success: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: unknown) => (await api.request<T>({ url, method, data: body })).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] })
      queryClient.invalidateQueries({ queryKey: ["client"] })
      queryClient.invalidateQueries({ queryKey: ["sites"] })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(success)
      onDone(data)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

function Actions({ busy, onCancel, label, disabled }: { busy: boolean; onCancel: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy || disabled}>
        {busy && <Loader2 className="animate-spin" />}
        {label}
      </Button>
    </div>
  )
}

// ---- Client ----

export function ClientDialog({
  open,
  onOpenChange,
  client,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  client?: Client
  onSaved?: (c: Client) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "Add client"}</DialogTitle>
        </DialogHeader>
        {open && <ClientForm client={client} onCancel={() => onOpenChange(false)} onSaved={(c) => { onOpenChange(false); onSaved?.(c) }} />}
      </DialogContent>
    </Dialog>
  )
}

function ClientForm({ client, onCancel, onSaved }: { client?: Client; onCancel: () => void; onSaved: (c: Client) => void }) {
  const me = useMe()
  const [v, setV] = useState({
    region_id: client?.region.id ?? me.visible_regions[0]?.id ?? "",
    name: client?.name ?? "",
    client_type: client?.client_type ?? ("residential" as ClientType),
    contact_name: client?.contact_name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    address: client?.address ?? "",
    notes: client?.notes ?? "",
  })
  const set = (k: keyof typeof v, value: string) => setV((p) => ({ ...p, [k]: value }))
  const save = useSave<Client>(client ? `/clients/${client.id}` : "/clients", client ? "patch" : "post", onSaved, client ? "Client updated" : "Client added")

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ ...v, email: v.email || null, contact_name: v.contact_name || null, phone: v.phone || null, address: v.address || null, notes: v.notes || null })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="c-name">Name</Label>
        <Input id="c-name" value={v.name} onChange={(e) => set("name", e.target.value)} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={v.client_type} onValueChange={(t) => set("client_type", t)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CLIENT_TYPE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Region</Label>
          <Select value={v.region_id} onValueChange={(r) => set("region_id", r)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {me.visible_regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-contact">Contact name</Label>
          <Input id="c-contact" value={v.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-address">Address</Label>
        <Input id="c-address" value={v.address} onChange={(e) => set("address", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-notes">Notes</Label>
        <Textarea id="c-notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Access instructions, gate codes, preferences…" />
      </div>
      <Actions busy={save.isPending} onCancel={onCancel} label={client ? "Save" : "Add client"} disabled={!v.name.trim() || !v.region_id} />
    </form>
  )
}

// ---- Site ----

export function SiteDialog({
  open,
  onOpenChange,
  clientId,
  site,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  clientId: string
  site?: Site
}) {
  const [v, setV] = useState({
    name: site?.name ?? "",
    address: site?.address ?? "",
    system_size_kw: site?.system_size_kw?.toString() ?? "",
    panel_count: site?.panel_count?.toString() ?? "",
    panel_model: site?.panel_model ?? "",
    inverter_model: site?.inverter_model ?? "",
    has_battery: site?.has_battery ?? false,
    install_date: site?.install_date ?? "",
  })
  const set = (k: keyof typeof v, value: string | boolean) => setV((p) => ({ ...p, [k]: value }))
  const save = useSave<Site>(site ? `/sites/${site.id}` : "/sites", site ? "patch" : "post", () => onOpenChange(false), site ? "Site updated" : "Site added")

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({
      client_id: clientId,
      name: v.name,
      address: v.address || null,
      system_size_kw: v.system_size_kw ? Number(v.system_size_kw) : null,
      panel_count: v.panel_count ? Number(v.panel_count) : null,
      panel_model: v.panel_model || null,
      inverter_model: v.inverter_model || null,
      has_battery: v.has_battery,
      install_date: v.install_date || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{site ? "Edit site" : "Add site"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Site name</Label>
              <Input id="s-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Main roof" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-installed">Installed on</Label>
              <Input id="s-installed" type="date" value={v.install_date} onChange={(e) => set("install_date", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-address">Address</Label>
            <Input id="s-address" value={v.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-kw">System size (kW)</Label>
              <Input id="s-kw" type="number" min="0" step="0.1" value={v.system_size_kw} onChange={(e) => set("system_size_kw", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-panels">Panel count</Label>
              <Input id="s-panels" type="number" min="0" value={v.panel_count} onChange={(e) => set("panel_count", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pmodel">Panel model</Label>
              <Input id="s-pmodel" value={v.panel_model} onChange={(e) => set("panel_model", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-inv">Inverter model</Label>
              <Input id="s-inv" value={v.inverter_model} onChange={(e) => set("inverter_model", e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.has_battery} onCheckedChange={(c) => set("has_battery", c)} /> Battery storage
          </label>
          <Actions busy={save.isPending} onCancel={() => onOpenChange(false)} label={site ? "Save" : "Add site"} disabled={!v.name.trim()} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- Service schedule ----

const SUGGESTED_INTERVAL: Record<ServiceType, number> = {
  panel_cleaning: 90,
  inverter_service: 365,
  thermal_inspection: 365,
  electrical_safety: 365,
  vegetation_control: 120,
  fault_repair: 180,
  monitoring_check: 180,
  installation_audit: 730,
}

export function ScheduleDialog({ open, onOpenChange, siteId }: { open: boolean; onOpenChange: (v: boolean) => void; siteId: string }) {
  const [service, setService] = useState<ServiceType>("panel_cleaning")
  const [intervalDays, setIntervalDays] = useState("90")
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10))
  const save = useSave<Schedule>("/schedules", "post", () => onOpenChange(false), "Service schedule added")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add recurring service</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ site_id: siteId, service_type: service, interval_days: Number(intervalDays), next_due_date: due })
          }}
        >
          <div className="space-y-1.5">
            <Label>Service</Label>
            <Select
              value={service}
              onValueChange={(s) => {
                setService(s as ServiceType)
                setIntervalDays(String(SUGGESTED_INTERVAL[s as ServiceType]))
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SERVICE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sch-int">Every (days)</Label>
              <Input id="sch-int" type="number" min="1" max="3650" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sch-due">Next due</Label>
              <Input id="sch-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
            </div>
          </div>
          <Actions busy={save.isPending} onCancel={() => onOpenChange(false)} label="Add" />
        </form>
      </DialogContent>
    </Dialog>
  )
}
