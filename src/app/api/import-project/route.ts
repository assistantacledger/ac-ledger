export const runtime = 'edge'

const SYSTEM_PROMPT = `You are extracting project data from a document. Extract all of:
- Project name and a suggested code (format like "AC-001" or "RTW-2025-01")
- Budget or total contract value as a number
- Entity: only one of "Actually Creative", "419Studios", or "RTW Records" if mentioned; otherwise "Actually Creative"
- Start date in YYYY-MM-DD format
- All cost line items (description, category from: Equipment/Travel/Crew/Talent/Venue/Software/Marketing/Other, estimated amount as a number, actual amount as a number, due date as YYYY-MM-DD or null, status: planned/confirmed/paid, supplier or employee name if applicable)
- All invoice records (supplier/client name, invoice reference number, amount as a number, currency symbol £ $ or €, due date as YYYY-MM-DD or null, type: "payable" if you owe money / "receivable" if they owe you, status: draft/pending/submitted/approved/sent/paid/overdue/part-paid, bank details like sort code/account number/IBAN/SWIFT if present)
- Any employees or team members mentioned

Return ONLY valid JSON with exactly this structure, no other text or explanation:
{
  "project": {
    "name": "...",
    "code": "...",
    "budget": 0,
    "entity": "Actually Creative",
    "date": "YYYY-MM-DD",
    "notes": "..."
  },
  "costs": [
    {
      "description": "...",
      "category": "Other",
      "estimated": 0,
      "actual": 0,
      "status": "planned",
      "notes": "",
      "dueDate": null,
      "employeeName": null
    }
  ],
  "invoices": [
    {
      "party": "...",
      "ref": "...",
      "amount": 0,
      "currency": "£",
      "due": null,
      "type": "payable",
      "status": "pending",
      "notes": "",
      "bankName": null,
      "sortCode": null,
      "accNum": null,
      "accName": null,
      "iban": null,
      "swift": null
    }
  ],
  "uncertain": ["describe anything you could not clearly extract or are unsure about"]
}`

interface ImportRequest {
  apiKey: string
  content?: string      // parsed spreadsheet/CSV text
  base64?: string       // PDF or image as base64
  mediaType?: string    // MIME type for binary content
}

export async function POST(req: Request) {
  try {
    const { apiKey, content, base64, mediaType } = await req.json() as ImportRequest
    if (!apiKey) return Response.json({ error: 'API key required' }, { status: 400 })
    if (!content && !base64) return Response.json({ error: 'No content provided' }, { status: 400 })

    const isPDF = mediaType === 'application/pdf'

    // Build message content
    let msgContent: unknown[]
    if (base64 && mediaType) {
      const fileBlock = isPDF
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
      msgContent = [fileBlock, { type: 'text', text: 'Extract the project data from this document and return the JSON.' }]
    } else {
      msgContent = [{ type: 'text', text: `Extract the project data from this content and return the JSON.\n\n${content}` }]
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    if (isPDF) headers['anthropic-beta'] = 'pdfs-2024-09-25'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: msgContent }],
      }),
    })

    if (!res.ok) {
      let errBody: string
      try {
        const errJson = await res.json() as { error?: { message?: string } }
        errBody = errJson?.error?.message ?? JSON.stringify(errJson)
      } catch {
        errBody = await res.text().catch(() => `HTTP ${res.status}`)
      }
      return Response.json({ error: `Anthropic API error: ${errBody}` }, { status: res.status })
    }

    const data = await res.json() as { content: Array<{ type: string; text: string }> }
    const text = data.content.find(b => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return Response.json({ error: 'Could not parse AI response' }, { status: 500 })

    const extracted = JSON.parse(jsonMatch[0])
    return Response.json({ extracted })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: msg }, { status: 500 })
  }
}
