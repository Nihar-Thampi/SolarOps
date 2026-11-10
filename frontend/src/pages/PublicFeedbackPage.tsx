import { useState } from "react"
import { useParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, Loader2 } from "lucide-react"

import { api, errorMessage } from "@/api/client"
import { SunLogo } from "@/components/layout/AppLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PublicFeedbackJob } from "@/types"

const RATING_WORDS = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"]

/** The page a customer opens from the link sent after a completed visit. No login. */
export default function PublicFeedbackPage() {
  const { token } = useParams()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")

  const job = useQuery({
    queryKey: ["public-feedback", token],
    queryFn: async () => (await api.get<PublicFeedbackJob>(`/public/feedback/${token}`)).data,
    retry: false,
  })
  const submit = useMutation({
    mutationFn: () => api.post(`/public/feedback/${token}`, { rating, comment }),
  })

  return (
    <div className="flex min-h-dvh items-start justify-center bg-background p-4 pt-[10vh]">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-2.5">
            <SunLogo className="size-8" />
            <span className="font-semibold">{job.data?.company_name ?? "Service feedback"}</span>
          </div>

          {job.isLoading && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {job.isError && <p className="text-sm text-muted-foreground">This feedback link isn't valid or has expired.</p>}

          {job.data && (job.data.already_submitted || submit.isSuccess) && (
            <div className="space-y-2 py-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" />
              <p className="font-medium">Thank you for your feedback!</p>
              <p className="text-sm text-muted-foreground">It helps our team do better on every visit.</p>
            </div>
          )}

          {job.data && !job.data.already_submitted && !submit.isSuccess && (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault()
                if (rating) submit.mutate()
              }}
            >
              <div>
                <h1 className="text-lg font-semibold">How was our visit?</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {job.data.title}
                  {job.data.site_name ? ` · ${job.data.site_name}` : ""} · {job.data.job_number}
                  {job.data.completed_at ? ` · ${fmtDate(job.data.completed_at)}` : ""}
                </p>
              </div>

              <div>
                <Label className="mb-2 block">Your rating</Label>
                <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      onClick={() => setRating(n)}
                      className={cn(
                        "text-4xl leading-none transition-transform hover:scale-110",
                        n <= rating ? "text-sun" : "text-muted-foreground/30"
                      )}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <p className="mt-1 h-5 text-sm text-muted-foreground">{RATING_WORDS[rating]}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="comment">Anything you'd like to tell us? (optional)</Label>
                <Textarea
                  id="comment"
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Punctuality, communication, quality of the work…"
                />
              </div>

              {submit.isError && <p className="text-sm text-destructive">{errorMessage(submit.error)}</p>}
              <Button type="submit" className="w-full" disabled={!rating || submit.isPending}>
                {submit.isPending && <Loader2 className="animate-spin" />}
                Send feedback
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
