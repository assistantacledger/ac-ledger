export const runtime = 'edge'

export async function POST(req: Request): Promise<Response> {
  try {
    const { webhookUrl, text } = await req.json()

    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      return Response.json({ error: 'Invalid webhook URL' }, { status: 400 })
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!res.ok) {
      const body = await res.text()
      return Response.json({ error: body }, { status: res.status })
    }

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
