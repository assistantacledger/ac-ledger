export const runtime = 'edge'

interface ScanRequest {
  base64: string
  mediaType: string
  apiKey: string
}

export async function POST(req: Request) {
  try {
    const { base64, mediaType, apiKey } = await req.json() as ScanRequest

    if (!apiKey) {
      return Response.json({ error: 'Anthropic API key not configured' }, { status: 400 })
    }

    const isPDF = mediaType === 'application/pdf'

    const contentBlock = isPDF
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        }

    const prompt = `You are an invoice data extraction assistant. Extract the following fields from this invoice document and return ONLY valid JSON with no extra text.

For each field, provide both a value and a confidence score (0.0 to 1.0).

Return this exact JSON structure:
{
  "party": { "value": "...", "confidence": 0.0 },
  "ref": { "value": "...", "confidence": 0.0 },
  "amount": { "value": 0, "confidence": 0.0 },
  "currency": { "value": "£", "confidence": 0.0 },
  "due": { "value": "YYYY-MM-DD or null", "confidence": 0.0 },
  "project_code": { "value": "... or null", "confidence": 0.0 },
  "type": { "value": "payable or receivable", "confidence": 0.0 }
}

Rules:
- party: the supplier/vendor name (for payable) or client name (for receivable)
- ref: the invoice number or reference (e.g. INV-001, 2024-045)
- amount: total amount as a number (no currency symbol)
- currency: £, $, or € based on the document
- due: payment due date in YYYY-MM-DD format, or null if not found
- project_code: any project code/number if present, or null
- type: "payable" if this is a bill/invoice you received (you owe money), "receivable" if this is an invoice you issued (client owes you)
- confidence: 1.0 = very clear, 0.8 = pretty sure, 0.5 = uncertain, 0.2 = guessing

Only return the JSON object, nothing else.`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    if (isPDF) {
      headers['anthropic-beta'] = 'pdfs-2024-09-25'
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return Response.json({ error: `Anthropic API error: ${err}` }, { status: res.status })
    }

    const data = await res.json() as { content: Array<{ type: string; text: string }> }
    const text = data.content.find(b => b.type === 'text')?.text ?? ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return Response.json({ error: 'Could not parse response from AI' }, { status: 500 })
    }

    const extracted = JSON.parse(jsonMatch[0])
    return Response.json({ extracted })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
