const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

export function apiUpload(endpoint: string, formData: FormData): Promise<Response> {
  return fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: formData,
  })
}
