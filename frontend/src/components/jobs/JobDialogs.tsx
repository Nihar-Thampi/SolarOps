import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Sparkles, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/api/client"
import { AiBadge } from "@/components/common"
import { EMPTY_JOB, JobForm, toJobPayload, useClientsForPicker, type JobFormValues } from "@/components/jobs/JobForm"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ClientListItem, IntakeDraft, JobDetail } from "@/types"

function useCreateJob(onDone: () => void) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async (payload: ReturnType<typeof toJobPayload>) => (await api.post<JobDetail>("/jobs", payload)).data,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      toast.success(`${job.number} created`)
      onDone()
      navigate(`/jobs/${job.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

export function NewJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateJob(() => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New job</DialogTitle>
          <DialogDescription>Log work for a client. You can leave it unassigned and assign it later.</DialogDescription>
        </DialogHeader>
        {open && (
          <JobForm
            initial={EMPTY_JOB}
            submitLabel="Create job"
            busy={create.isPending}
            onSubmit={(v) => create.mutate(toJobPayload(v))}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Sample messages written about the user's own clients, so the demo shows a real match. */
function buildExamples(clients: ClientListItem[]): string[] {
  const home = clients.find((c) => c.client_type === "residential")
  const business = clients.find((c) => c.client_type === "commercial")
  const third = clients.find((c) => c !== home && c !== business && c.email)
  return [
    home &&
      `Hi, it's ${home.contact_name} (${home.name.split(" ")[0]} family). Since Tuesday the inverter keeps beeping and shows error E-31. Panels look fine. Mornings are best, gate code 4471.`,
    business &&
      `URGENT – staff at ${business.name} noticed a burning smell near the solar isolator on the main roof this morning. We've switched the system off. Please send someone today.`,
    third &&
      `From: ${third.email}\nOur production in the app has dropped by about half over the last two weeks. I think the neighbour's tree has grown over the west side of the roof. No rush, next week is fine.`,
  ].filter((x): x is string => !!x)
}

/** AI job intake: paste a customer's message, review the AI's draft, then create the job. */
export function IntakeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [text, setText] = useState("")
  const [draft, setDraft] = useState<IntakeDraft | null>(null)
  const create = useCreateJob(() => close(false))
  const clients = useClientsForPicker()
  const examples = buildExamples(clients.data ?? [])

  const analyze = useMutation({
    mutationFn: async () => (await api.post<IntakeDraft>("/ai/intake", { text })).data,
    onSuccess: setDraft,
    onError: (err) => toast.error(errorMessage(err)),
  })

  function close(v: boolean) {
    onOpenChange(v)
    if (!v) {
      setDraft(null)
      setText("")
    }
  }

  const initial: JobFormValues | null = draft && {
    ...EMPTY_JOB,
    client_id: draft.client_id ?? "",
    site_id: draft.site_id,
    title: draft.title,
    description: draft.description,
    service_type: draft.service_type,
    priority: draft.priority,
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-sun" /> AI job intake
          </DialogTitle>
          <DialogDescription>
            Paste a customer email, text or call notes. AI drafts the job (service, priority, client and site) for you to
            check before it's created.
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intake-text">Customer message</Label>
              <Textarea
                id="intake-text"
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the message here…"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">Try an example:</span>
              {examples.map((ex, i) => (
                <button key={i} type="button" onClick={() => setText(ex)} className="text-xs text-link hover:underline">
                  Example {i + 1}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={() => analyze.mutate()} disabled={text.trim().length < 5 || analyze.isPending}>
                {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Draft job with AI
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-accent/40 p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <AiBadge provider={draft.provider} />
                <span className="text-xs text-muted-foreground">Confidence {Math.round(draft.confidence * 100)}%</span>
              </div>
              <p>{draft.reasoning}</p>
              {(draft.new_client_name || draft.contact_name || draft.contact_phone || draft.contact_email) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Contact details found:{" "}
                  {[draft.new_client_name, draft.contact_name, draft.contact_phone, draft.contact_email].filter(Boolean).join(" · ")}
                </p>
              )}
              {!draft.client_id && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <UserPlus className="size-3.5" /> No existing client matched. Choose one below, or add the client first.
                </p>
              )}
            </div>
            <JobForm
              initial={initial!}
              submitLabel="Create job"
              busy={create.isPending}
              onSubmit={(v) => create.mutate(toJobPayload(v, "ai_intake"))}
              onCancel={() => setDraft(null)}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
