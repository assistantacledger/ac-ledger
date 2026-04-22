// Minimal event-based toast system — no React context required.
// Call toast('message') from anywhere; ToastContainer listens via CustomEvent.

export type ToastType = 'success' | 'error' | 'info'

export interface ToastEvent {
  id: string
  message: string
  type: ToastType
}

const EVENT = 'ac-toast'

export function toast(message: string, type: ToastType = 'success') {
  if (typeof window === 'undefined') return
  const id = Math.random().toString(36).slice(2)
  window.dispatchEvent(new CustomEvent<ToastEvent>(EVENT, { detail: { id, message, type } }))
}

export { EVENT as TOAST_EVENT }
