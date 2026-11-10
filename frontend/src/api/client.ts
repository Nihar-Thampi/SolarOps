import axios, { AxiosError } from "axios"

const TOKEN_KEY = "solarops-token"

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* storage unavailable: state stays in memory */
    }
  },
}

export const getToken = () => storage.get(TOKEN_KEY)
export const setToken = (token: string | null) => storage.set(TOKEN_KEY, token)

export const api = axios.create({ baseURL: "/api" })

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ detail?: unknown }>) => {
    if (err.response?.status === 401 && getToken() && !err.config?.url?.includes("/auth/login")) {
      setToken(null)
      window.dispatchEvent(new Event("solarops:logout"))
    }
    return Promise.reject(err)
  }
)

/** A readable message from an API error. */
export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, "")
    if (!err.response) return "Can't reach the server. Is the backend running?"
    return "Something went wrong. Please try again."
  }
  return err instanceof Error ? err.message : "Something went wrong."
}

/** Drop empty values so they don't end up as ?key= in the URL. */
export function params(p: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false))
}
