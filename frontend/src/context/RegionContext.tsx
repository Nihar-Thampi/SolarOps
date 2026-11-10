import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { storage } from "@/api/client"
import { useMe } from "@/context/AuthContext"

/** The region picker in the top bar: scopes every list and the dashboard. null = all my regions. */
interface RegionState {
  regionId: string | null
  setRegionId: (id: string | null) => void
}

const RegionContext = createContext<RegionState | null>(null)

export function RegionProvider({ children }: { children: ReactNode }) {
  const me = useMe()
  const key = `solarops-region:${me.user.id}`
  const [regionId, setRegionIdState] = useState<string | null>(() => storage.get(key))

  // Drop a remembered region the user can no longer see.
  useEffect(() => {
    if (regionId && !me.visible_regions.some((r) => r.id === regionId)) setRegionIdState(null)
  }, [regionId, me.visible_regions])

  const setRegionId = (id: string | null) => {
    setRegionIdState(id)
    storage.set(key, id)
  }

  return <RegionContext.Provider value={{ regionId, setRegionId }}>{children}</RegionContext.Provider>
}

export function useRegion() {
  const ctx = useContext(RegionContext)
  if (!ctx) throw new Error("useRegion must be used inside RegionProvider")
  return ctx
}
