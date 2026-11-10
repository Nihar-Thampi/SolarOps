import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/api/client"
import { PageHeader } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMe } from "@/context/AuthContext"
import { ROLE_LABELS, SERVICE_LABELS, SERVICE_TYPES } from "@/lib/format"
import type { Region, Role, User } from "@/types"

export default function TeamPage() {
  const me = useMe()
  const [userDialog, setUserDialog] = useState<{ user?: User } | null>(null)
  const [regionDialog, setRegionDialog] = useState<{ region?: Region } | null>(null)

  const users = useQuery({ queryKey: ["users", "all-admin"], queryFn: async () => (await api.get<User[]>("/users")).data })
  const regions = useQuery({ queryKey: ["regions"], queryFn: async () => (await api.get<Region[]>("/regions")).data })

  return (
    <div>
      <PageHeader title="Team & regions" description={`People and service regions at ${me.tenant.name}.`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
            <CardTitle className="text-base font-semibold text-foreground">People</CardTitle>
            <Button size="sm" onClick={() => setUserDialog({})}>
              <Plus /> Add person
            </Button>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Regions</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.map((u) => (
                <TableRow key={u.id} className={u.is_active ? "" : "opacity-50"}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{u.full_name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {ROLE_LABELS[u.role]}
                    {!u.is_active && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">{u.role === "admin" ? "All" : u.regions.map((r) => r.name).join(", ") || "—"}</TableCell>
                  <TableCell className="max-w-56">
                    <div className="flex flex-wrap gap-1">
                      {u.skills.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {SERVICE_LABELS[s as keyof typeof SERVICE_LABELS] ?? s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${u.full_name}`} onClick={() => setUserDialog({ user: u })}>
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
            <CardTitle className="text-base font-semibold text-foreground">Regions</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setRegionDialog({})}>
              <Plus /> Add
            </Button>
          </CardHeader>
          <CardContent className="divide-y p-5 pt-0">
            {regions.data?.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.code}</span>
                  <div className="text-xs text-muted-foreground">
                    {users.data?.filter((u) => u.regions.some((x) => x.id === r.id)).length ?? 0} people
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setRegionDialog({ region: r })}>
                  <Pencil />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {userDialog && <UserDialog user={userDialog.user} regions={regions.data ?? []} onClose={() => setUserDialog(null)} />}
      {regionDialog && <RegionDialog region={regionDialog.region} onClose={() => setRegionDialog(null)} />}
    </div>
  )
}

function UserDialog({ user, regions, onClose }: { user?: User; regions: Region[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [v, setV] = useState({
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? ("technician" as Role),
    phone: user?.phone ?? "",
    password: "",
    is_active: user?.is_active ?? true,
    region_ids: user?.regions.map((r) => r.id) ?? [],
    skills: user?.skills ?? [],
  })
  const toggle = (key: "region_ids" | "skills", id: string) =>
    setV((p) => ({ ...p, [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id] }))

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...v, phone: v.phone || null, password: v.password || null }
      if (user) {
        const { email: _email, ...update } = body
        return (await api.patch(`/users/${user.id}`, update)).data
      }
      return (await api.post("/users", body)).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      toast.success(user ? "Saved" : "Person added")
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.full_name}` : "Add person"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" type="email" value={v.email} disabled={!!user} onChange={(e) => setV({ ...v, email: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={v.role} onValueChange={(r) => setV({ ...v, role: r as Role })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-phone">Phone</Label>
              <Input id="u-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pw">{user ? "New password (leave blank to keep)" : "Initial password"}</Label>
            <Input id="u-pw" type="password" minLength={8} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required={!user} />
          </div>

          {v.role !== "admin" && (
            <div className="space-y-1.5">
              <Label>Regions they work in</Label>
              <div className="grid grid-cols-2 gap-2">
                {regions.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={v.region_ids.includes(r.id)} onCheckedChange={() => toggle("region_ids", r.id)} />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {v.role === "technician" && (
            <div className="space-y-1.5">
              <Label>Skills (used to suggest who to assign)</Label>
              <div className="grid grid-cols-2 gap-2">
                {SERVICE_TYPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={v.skills.includes(s)} onCheckedChange={() => toggle("skills", s)} />
                    {SERVICE_LABELS[s]}
                  </label>
                ))}
              </div>
            </div>
          )}
          {user && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} /> Active (can sign in)
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {user ? "Save" : "Add person"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RegionDialog({ region, onClose }: { region?: Region; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(region?.name ?? "")
  const [code, setCode] = useState(region?.code ?? "")
  const save = useMutation({
    mutationFn: async () =>
      region ? (await api.patch(`/regions/${region.id}`, { name, code })).data : (await api.post("/regions", { name, code })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["regions"] })
      toast.success("Region saved. Sign in again to see it in the region picker.")
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{region ? "Edit region" : "Add region"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="r-name">Name</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-code">Short code</Label>
            <Input id="r-code" value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
