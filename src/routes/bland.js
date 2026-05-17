const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
const { sendSMS } = require('../lib/sms')
const { sendEmail, buildCallSummaryEmail } = require('../lib/email')

router.post('/', async (req, res) => {
  const payload = req.body

  try {
    // -------------------------
    // Ignore Bland log events
    // -------------------------
    const isLogEvent =
      payload?.message &&
      payload?.category &&
      payload?.log_level

    if (isLogEvent || !payload?.call_id) {
      return res.status(200).json({ ignored: true })
    }

    const callId = payload.call_id
    const callerNumber = payload.from || payload.caller || 'Unknown'
    const toNumber = payload.to || payload.inbound_number
    const summary = payload.summary || payload.call_summary || null
    const transcript = payload.transcript || null
    const duration = payload.call_length || payload.duration || null
    const status = payload.status || 'completed'

    console.log(`📞 Call: ${callId} | To: ${toNumber} | From: ${callerNumber}`)

    if (!toNumber) {
      return res.status(200).json({ ignored: true })
    }

    // -------------------------
    // Normalize phone numbers
    // -------------------------
    const normalize = (n) => (n || '').replace(/\D/g, '')
    const toNorm = normalize(toNumber)

    // -------------------------
    // Fetch clients
    // -------------------------
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('active', true)

    if (clientError) {
      console.log('⚠️ Client lookup error:', clientError.message)
    }
const { data: clients, error: clientError } = await supabase
  .from('clients')
  .select('*')
  .eq('active', true)

// ADD THIS TEMPORARILY
console.log('🔍 DB clients:', JSON.stringify(clients))
console.log('🔍 toNorm:', toNorm)
console.log('🔍 toNumber raw:', toNumber)
    // -------------------------
    // Match client by ANY number format
    // -------------------------
    const client = clients?.find(c => {
      const numbers = Array.isArray(c.bland_number)
        ? c.bland_number
        : [c.bland_number]

      return numbers.some(n => normalize(n) === toNorm)
    })

    if (!client) {
      console.log(`⚠️ No client found for ${toNumber}`)

      await supabase.from('calls').insert({
        call_id: callId,
        caller_number: callerNumber,
        inbound_number: toNumber,
        summary,
        duration,
        status,
        client_id: null
      })

      return res.status(200).json({ ok: true })
    }

    console.log(`✅ Client: ${client.business_name}`)

    // -------------------------
    // Prevent duplicates
    // -------------------------
    const { data: existing } = await supabase
      .from('calls')
      .select('id')
      .eq('call_id', callId)
      .maybeSingle()

    if (existing) return res.status(200).json({ ok: true })

    // -------------------------
    // Save call
    // -------------------------
    await supabase.from('calls').insert({
      call_id: callId,
      client_id: client.id,
      caller_number: callerNumber,
      inbound_number: toNumber,
      summary,
      duration,
      status
    })

    const callRecord = {
      call_id: callId,
      caller_number: callerNumber,
      summary,
      duration,
      created_at: new Date().toISOString()
    }

    // -------------------------
    // SMS alert
    // -------------------------
    if (client.notify_sms) {
      console.log('📱 Sending SMS...')
      await sendSMS(client.notify_sms, buildSMSBody(client, callRecord))
    }

    // -------------------------
    // Email alert
    // -------------------------
    if (client.notify_email) {
      console.log('📧 Sending email...')
      const subject = `📞 Missed Call — ${callerNumber} | ${client.business_name}`
      await sendEmail(client.notify_email, subject, buildCallSummaryEmail(client, callRecord))
    }

    // -------------------------
    // Booking detection
    // -------------------------
    const bookingKeywords = ['book', 'appointment', 'schedule', 'booking', 'reserve']

    const needsBooking = bookingKeywords.some(word =>
      ((summary || '') + ' ' + (transcript || '')).toLowerCase().includes(word)
    )

    if (needsBooking && client.booking_url) {
      console.log('📅 Sending booking link...')
      const callerSMS = `Hi! Thanks for calling ${client.business_name}. Book here: ${client.booking_url}`
      await sendSMS(callerNumber, callerSMS)
    }

    console.log(`✅ Done: ${callId}`)

    return res.status(200).json({ ok: true })

  } catch (error) {
    console.log('❌ Webhook error:', error.message)
    return res.status(500).json({ error: true })
  }
})

function buildSMSBody(client, call) {
  const duration = call.duration
    ? `${Math.round(call.duration / 60)} min`
    : 'Unknown'

  const summary = call.summary
    ? `\n\n${call.summary}`
    : '\n\nNo summary captured.'

  return `📞 CALLM8 — Missed Call\n📱 ${call.caller_number}\n⏱ ${duration}${summary}\n\n— Callm8`
}

module.exports = router
