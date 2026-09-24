export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString()
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

// Для значений, которые подставляются в HTML-отчёт строкой
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}
