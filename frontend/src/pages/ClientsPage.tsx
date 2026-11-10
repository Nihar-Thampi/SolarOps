import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Plus, Search } from "lucide-react"

import { api, params } from "@/api/client"
import { ClientDialog } from "@/components/clients/ClientForms"
import { EmptyState, PageHeader } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/context/AuthContext"
import { useRegion } from "@/context/RegionContext"
import { CLIENT_TYPE_LABELS } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ClientListItem, Page } from "@/types"

export default function ClientsPage() {
  const { canManage } = useAuth()
  const { regionId } = useRegion()
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [addOpen, setAddOpen] = useState(false)

  const clients = useQuery({
    queryKey: ["clients", regionId, search],
    queryFn: async () =>
      (await api.get<Page<ClientListItem>>("/clients", { params: params({ region_id: regionId, q: search, limit: 200 }) })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <div>
      <PageHeader
        title="Clients & sites"
        description="Customers, their solar installations and each site's maintenance record."
        actions={
          canManage && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> Add client
            </Button>
          )
        }
      />
      <form
        className="relative mb-4 w-72"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
        }}
      >
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} placeholder="Search name, contact, email" className="pl-8" />
      </form>

      <Card className={cn("overflow-hidden transition-opacity", clients.isPlaceholderData && "opacity-60")}>
        {clients.data?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No clients found" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Sites</TableHead>
                <TableHead className="pr-4 text-right">Open jobs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.data?.items.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/clients/${c.id}`)}>
                  <TableCell className="pl-4">
                    <Link to={`/clients/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    <div className="max-w-64 truncate text-xs text-muted-foreground">{c.address}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{CLIENT_TYPE_LABELS[c.client_type]}</Badge>
                  </TableCell>
                  <TableCell>{c.region.name}</TableCell>
                  <TableCell>
                    <div>{c.contact_name}</div>
                    <div className="text-xs text-muted-foreground">{c.phone}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.site_count}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">
                    {c.open_jobs ? <span className="font-medium">{c.open_jobs}</span> : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {clients.data && <p className="mt-2 text-xs text-muted-foreground">{clients.data.total} clients</p>}

      <ClientDialog open={addOpen} onOpenChange={setAddOpen} onSaved={(c) => navigate(`/clients/${c.id}`)} />
    </div>
  )
}
