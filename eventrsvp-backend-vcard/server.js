import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'csv-parse/sync'
import { PrismaClient } from '@prisma/client'

// ===== תשתית קבצים =====
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR)

// Multer לתמונות (לדיסק)
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    cb(null, name)
  }
})
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.png', '.jpg', '.jpeg', '.webp']
    ok.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Only PNG/JPG/JPEG/WEBP up to 5MB'))
  }
})

// Multer ל-CSV (בזיכרון)
const uploadMem = multer({ storage: multer.memoryStorage() })

const app = express()
const prisma = new PrismaClient()

app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(UPLOAD_DIR))

const PORT = process.env.PORT || 3001
const SCHEDULER_POLL_SECONDS = Number(process.env.SCHEDULER_POLL_SECONDS || 30)
const PUBLIC_BASE = process.env.BASE_URL || `http://localhost:${PORT}`
const toAbsolute = (u) => (!u ? null : (u.startsWith('http') ? u : `${PUBLIC_BASE}${u}`))

// ===== Utils =====
const digits = (s='') => String(s).replace(/\D/g, '')
const hasWaba = () => !!(process.env.WABA_PHONE_NUMBER_ID && process.env.WABA_ACCESS_TOKEN)

function deleteFileSafe(relPath) {
  try {
    if (!relPath) return
    if (!relPath.startsWith('/uploads/')) return
    const filename = path.basename(relPath)
    const abs = path.join(UPLOAD_DIR, filename)
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
  } catch (e) { console.error('delete image error', e) }
}

async function sendWhatsApp({ phone, text, imageUrl }) {
  if (!hasWaba()) {
    console.log(`[SIM] send -> ${phone}\nTEXT: ${text?.slice(0,120) || ''}\nIMAGE: ${imageUrl || '—'}`)
    return { ok: true, providerMessageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2)}` }
  }
  const endpoint = `https://graph.facebook.com/v20.0/${process.env.WABA_PHONE_NUMBER_ID}/messages`
  const headers = {
    'Authorization': `Bearer ${process.env.WABA_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
  const payload = imageUrl ? {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'image',
    image: { link: imageUrl, caption: text || '' }
  } : {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { body: text }
  }
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) })
  if (!res.ok) {
    const err = await res.text()
    console.error('WABA error:', err)
    return { ok: false, error: err }
  }
  const data = await res.json()
  const providerMessageId = data?.messages?.[0]?.id || null
  return { ok: true, providerMessageId }
}

// ===== Bootstrap & Admin =====
app.post('/workspaces/init', async (req, res) => {
  const { name = 'Default Workspace', credits = 500, ownerPhone } = req.body || {}
  const ws = await prisma.workspace.create({
    data: { name, ownerPhone: ownerPhone ? digits(ownerPhone) : null, messageCreditsRemaining: credits }
  })
  await prisma.creditLedger.create({ data: { workspaceId: ws.id, delta: credits, reason: 'purchase' }})
  res.json(ws)
})

// 🔋 טעינת קרדיטים ל-Workspace
app.post('/workspaces/:id/credits/add', async (req, res) => {
  try {
    const { amount = 0, reason = 'manual_topup' } = req.body || {}
    const inc = Number(amount) || 0
    if (!Number.isFinite(inc) || inc === 0) return res.status(400).json({ error: 'amount must be non-zero number' })
    const ws = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { messageCreditsRemaining: { increment: inc } }
    })
    await prisma.creditLedger.create({ data: { workspaceId: ws.id, delta: inc, reason } })
    res.json({ ok: true, workspaceId: ws.id, newBalance: ws.messageCreditsRemaining + inc })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'credits_add_failed' })
  }
})

app.post('/workspaces/:id/active-event', async (req, res) => {
  const { eventId } = req.body || {}
  if (!eventId) return res.status(400).json({ error: 'eventId required' })
  const ev = await prisma.event.findUnique({ where: { id: eventId } })
  if (!ev) return res.status(404).json({ error: 'event not found' })
  if (ev.workspaceId !== req.params.id) return res.status(400).json({ error: 'event not in workspace' })
  const ws = await prisma.workspace.update({ where: { id: req.params.id }, data: { activeEventId: eventId } })
  res.json({ ok: true, workspaceId: ws.id, activeEventId: ws.activeEventId })
})

// ===== Events =====
app.post('/events', async (req, res) => {
  const { workspaceId, title, date, timeStr, venue, inviteImageUrl, timezone } = req.body
  if (!workspaceId || !title) return res.status(400).json({ error: 'workspaceId & title required' })
  const event = await prisma.event.create({
    data: {
      workspaceId, title,
      date: date ? new Date(date) : null,
      timeStr: timeStr || null,
      venue: venue || null,
      inviteImageUrl: inviteImageUrl || null,
      timezone: timezone || null
    }
  })
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  if (ws && !ws.activeEventId) {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { activeEventId: event.id } })
  }
  res.json(event)
})

app.post('/events/:id/invite-image', uploadImage.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' })
    const eventId = req.params.id
    const prev = await prisma.event.findUnique({ where: { id: eventId }, select: { inviteImageUrl: true } })
    deleteFileSafe(prev?.inviteImageUrl)

    const relativeUrl = `/uploads/${req.file.filename}`
    await prisma.event.update({ where: { id: eventId }, data: { inviteImageUrl: relativeUrl } })
    res.json({ url: relativeUrl })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'upload_failed' })
  }
})

app.delete('/events/:id/invite-image', async (req, res) => {
  try {
    const ev = await prisma.event.findUnique({ where: { id: req.params.id }, select: { inviteImageUrl: true } })
    if (!ev) return res.status(404).json({ error: 'event_not_found' })
    deleteFileSafe(ev.inviteImageUrl)
    await prisma.event.update({ where: { id: req.params.id }, data: { inviteImageUrl: null } })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'delete_failed' })
  }
})

app.get('/events/:id', async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: { guests: true, messages: { include: { targets: true } }, workspace: true }
  })
  if (!event) return res.status(404).json({ error: 'not found' })
  res.json(event)
})

// ===== Guests =====
app.post('/events/:id/guests', async (req, res) => {
  const { name, phone, relation, side } = req.body
  if (!name || !phone) return res.status(400).json({ error: 'name & phone required' })
  const guest = await prisma.guest.create({ data: { eventId: req.params.id, name, phone: digits(phone), relation, side } })
  res.json(guest)
})

app.post('/events/:id/guests/import', uploadMem.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required in field "file"' })
  const csv = req.file.buffer.toString('utf-8')
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true })
  const rows = records.map(r => ({
    eventId: req.params.id,
    name: r.name || r.שם,
    phone: digits(r.phone || r['טלפון'] || ''),
    relation: r.relation || r['סוג קשר'] || r.type || null,
    side: r.side || r.group || r['קבוצה'] || r['כלה/חתן'] || null
  })).filter(r => r.name && r.phone)
  if (!rows.length) return res.status(400).json({ error: 'no valid rows' })
  const created = await prisma.$transaction(rows.map(data => prisma.guest.create({ data })))
  res.json({ inserted: created.length })
})

// ===== Credits helper =====
async function debitCreditsTx(tx, workspaceId, amount, reason, referenceId) {
  const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { messageCreditsRemaining: true } })
  if (!ws) throw new Error('workspace not found')
  if (ws.messageCreditsRemaining < amount) {
    const e = new Error('INSUFFICIENT_CREDITS'); e.status = 402; throw e
  }
  await tx.workspace.update({ where: { id: workspaceId }, data: { messageCreditsRemaining: { decrement: amount } } })
  await tx.creditLedger.create({ data: { workspaceId, delta: -amount, reason, referenceId } })
}

// ===== Send now / schedule =====
app.post('/events/:id/messages/send-now', async (req, res) => {
  const { bodyText, imageUrl } = req.body || {}
  const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { workspace: true } })
  if (!event) return res.status(404).json({ error: 'event not found' })
  const targets = await prisma.guest.findMany({ where: { eventId: event.id, status: 'pending' } })
  if (!targets.length) return res.status(400).json({ error: 'no pending guests' })

  const chosenImage = imageUrl || event.inviteImageUrl || null

  try {
    const result = await prisma.$transaction(async (tx) => {
      await debitCreditsTx(tx, event.workspaceId, targets.length, 'send_debit', event.id)
      const msg = await tx.message.create({ data: { eventId: event.id, bodyText, imageUrl: chosenImage } })
      await Promise.all(targets.map(g => tx.messageTarget.create({ data: { messageId: msg.id, guestId: g.id, phone: g.phone } })))
      return msg
    })
    dispatchMessage(result.id).catch(console.error)
    res.json({ ok: true, messageId: result.id, targets: targets.length, imageUsed: !!chosenImage })
  } catch (e) {
    if (e.status === 402) return res.status(402).json({ error: 'insufficient_credits' })
    console.error(e); return res.status(500).json({ error: 'internal_error' })
  }
})

app.post('/events/:id/messages/schedule', async (req, res) => {
  const { bodyText, imageUrl, scheduledAt } = req.body || {}
  if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt required' })
  const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { workspace: true } })
  if (!event) return res.status(404).json({ error: 'event not found' })
  const targets = await prisma.guest.findMany({ where: { eventId: event.id, status: 'pending' } })
  if (!targets.length) return res.status(400).json({ error: 'no pending guests' })

  const chosenImage = imageUrl || event.inviteImageUrl || null

  try {
    const msg = await prisma.$transaction(async (tx) => {
      await debitCreditsTx(tx, event.workspaceId, targets.length, 'send_debit', event.id)
      const created = await tx.message.create({ data: { eventId: event.id, bodyText, imageUrl: chosenImage, scheduledAt: new Date(scheduledAt) } })
      await Promise.all(targets.map(g => tx.messageTarget.create({ data: { messageId: created.id, guestId: g.id, phone: g.phone } })))
      return created
    })
    res.json({ ok: true, messageId: msg.id, targets: targets.length, scheduledAt: msg.scheduledAt, imageUsed: !!chosenImage })
  } catch (e) {
    if (e.status === 402) return res.status(402).json({ error: 'insufficient_credits' })
    console.error(e); return res.status(500).json({ error: 'internal_error' })
  }
})

// ===== Webhook WhatsApp =====
app.get('/webhooks/whatsapp', (req, res) => {
  const verifyToken = process.env.WABA_VERIFY_TOKEN
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && token === verifyToken) return res.status(200).send(challenge)
  return res.sendStatus(403)
})

app.post('/webhooks/whatsapp', async (req, res) => {
  const body = req.body
  try {
    const entries = body?.entry || []
    for (const entry of entries) {
      const changes = entry.changes || []
      for (const ch of changes) {
        const value = ch.value || {}
        const msgs = value.messages || []
        for (const m of msgs) {
          const from = digits(m.from)
          const ws = await prisma.workspace.findFirst({ where: { ownerPhone: from } })
          if (!ws) continue

          let evId = ws.activeEventId
          if (!evId) {
            const last = await prisma.event.findFirst({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'desc' } })
            if (last) {
              evId = last.id
              await prisma.workspace.update({ where: { id: ws.id }, data: { activeEventId: evId } })
            }
          }
          if (!evId) {
            await sendWhatsApp({ phone: from, text: "לא נמצא אירוע פעיל לייבוא אנשי קשר. צרו אירוע במערכת והגדירו אותו כפעיל." })
            continue
          }

          if (m.type === 'contacts' && Array.isArray(m.contacts)) {
            let added = 0, duplicates = 0
            for (const c of m.contacts) {
              const name = c.name?.formatted_name || c.profile?.name || 'ללא שם'
              const phones = (c.phones || []).map(p => digits(p.phone)).filter(Boolean)
              for (const ph of phones) {
                const exists = await prisma.guest.findFirst({ where: { eventId: evId, phone: ph } })
                if (exists) { duplicates++; continue }
                await prisma.guest.create({ data: { eventId: evId, name, phone: ph, status: 'pending' } })
                added++
              }
            }
            await sendWhatsApp({ phone: from, text: `נוספו ${added} אנשי קשר לאירוע.\nכפולים: ${duplicates}.` })
          }

          if (m.type === 'text') {
            const t = (m.text?.body || '').trim().toLowerCase()
            if (t.startsWith('set ')) {
              const key = t.slice(4).trim()
              const ev = await prisma.event.findFirst({
                where: { workspaceId: ws.id, OR: [{ id: key }, { title: { contains: key, mode: 'insensitive' } }] },
                orderBy: { createdAt: 'desc' }
              })
              if (ev) {
                await prisma.workspace.update({ where: { id: ws.id }, data: { activeEventId: ev.id } })
                await sendWhatsApp({ phone: from, text: `עודכן האירוע הפעיל: ${ev.title}` })
              } else {
                await sendWhatsApp({ phone: from, text: `לא נמצא אירוע תואם למילת המפתח: ${key}` })
              }
            }
          }
        }

        const statuses = value.statuses || []
        for (const st of statuses) {
          const providerId = st.id
          const status = st.status
          const ts = new Date(Number(st.timestamp) * 1000)
          if (providerId) {
            await prisma.messageTarget.updateMany({
              where: { providerMessageId: providerId },
              data: {
                status: status === 'delivered' ? 'delivered' : status === 'read' ? 'read' : status === 'failed' ? 'failed' : undefined,
                deliveredAt: status === 'delivered' ? ts : undefined,
                readAt: status === 'read' ? ts : undefined
              }
            })
          }
        }
      }
    }
  } catch (e) { console.error('webhook error', e) }
  res.sendStatus(200)
})

// ===== Dispatcher & Scheduler =====
async function dispatchMessage(messageId) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include: { targets: true } })
  if (!msg) return
  const absoluteImageUrl = toAbsolute(msg.imageUrl || null)
  for (const t of msg.targets) {
    try {
      const res = await sendWhatsApp({ phone: t.phone, text: msg.bodyText, imageUrl: absoluteImageUrl })
      if (res.ok) {
        await prisma.messageTarget.update({ where: { id: t.id }, data: { status: 'sent', sentAt: new Date(), providerMessageId: res.providerMessageId || undefined } })
      } else {
        await prisma.messageTarget.update({ where: { id: t.id }, data: { status: 'failed', errorCode: (res.error || '').slice(0,120) } })
      }
    } catch (e) {
      console.error('dispatch error', e)
      await prisma.messageTarget.update({ where: { id: t.id }, data: { status: 'failed', errorCode: 'exception' } })
    }
  }
  await prisma.message.update({ where: { id: messageId }, data: { processedAt: new Date() } })
}

async function schedulerTick() {
  const due = await prisma.message.findMany({ where: { scheduledAt: { lte: new Date() }, processedAt: null } })
  for (const m of due) dispatchMessage(m.id).catch(console.error)
}
setInterval(schedulerTick, SCHEDULER_POLL_SECONDS * 1000)

app.get('/', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`)
  console.log('Run: npx prisma generate && npx prisma migrate dev --name init')
})
