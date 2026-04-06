/**
 * Send a message to Slack.
 * Routes through /api/slack to avoid CORS issues in the browser.
 * Falls back to direct fetch on server-side.
 */
export async function slackSend(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) throw new Error('No Slack webhook URL configured')

  // In browser — proxy through our API route
  if (typeof window !== 'undefined') {
    const res = await fetch('/api/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, text }),
    })
    if (!res.ok) throw new Error(await res.text())
    return
  }

  // Server-side — direct fetch
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Slack error: ${res.status}`)
}

// ─── Message builders ────────────────────────────────────────────────────────

import type { Invoice, Expense } from '@/types'
import { fmt, fmtDate } from './format'

export function buildSummaryMessage(invoices: Invoice[]): string {
  const open = invoices.filter(i => ['pending', 'overdue', 'part-paid'].includes(i.status))
  const pay = open.filter(i => i.type === 'payable')
  const recv = open.filter(i => i.type === 'receivable')
  const over = invoices.filter(i => i.status === 'overdue')
  const sum = (arr: Invoice[]) => arr.reduce((t, i) => t + Number(i.amount), 0)
  const net = sum(recv) - sum(pay)
  const overList = over
    .slice(0, 5)
    .map(i => `• ${i.ref} — ${i.party} — ${fmt(i.amount)} (due ${fmtDate(i.due)})`)
    .join('\n')

  return [
    `📊 *AC Ledger Summary* — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    '',
    `*💸 To Pay:* ${fmt(sum(pay))} across ${pay.length} invoice${pay.length !== 1 ? 's' : ''}`,
    `*📥 To Receive:* ${fmt(sum(recv))} across ${recv.length} invoice${recv.length !== 1 ? 's' : ''}`,
    `*🔴 Overdue:* ${over.length} invoice${over.length !== 1 ? 's' : ''} totalling ${fmt(sum(over))}`,
    `*📈 Net Balance:* ${net >= 0 ? '+' : ''}${fmt(net)}`,
    over.length ? `\n*Overdue invoices:*\n${overList}` : '',
  ].filter(Boolean).join('\n')
}

export function buildExpenseNotification(exp: Expense): string {
  const items = (exp.line_items ?? [])
    .map(l => `${l.description} (${fmt(l.amount)})`)
    .join(', ')
  return [
    `📋 *Expense submitted for approval*`,
    `*Employee:* ${exp.employee}`,
    `*Company:* ${exp.entity}`,
    `*Total:* ${fmt(exp.total)}`,
    `*Project:* ${exp.project_code || exp.project_name || 'None'}`,
    items ? `*Items:* ${items}` : '',
  ].filter(Boolean).join('\n')
}
