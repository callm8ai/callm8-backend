const axios = require('axios')
const { sendSMS } = require('./sms')

const BLAND_BASE = 'https://api.bland.ai/v1'

const headers = () => ({
  authorization: process.env.BLAND_API_KEY,
  'Content-Type': 'application/json'
})

async function importTwilioNumber(phoneNumber) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping BYOT import for ${phoneNumber}`)
    return { success: true, testMode: true }
  }

  try {
    const res = await axios.post(
      `${BLAND_BASE}/inbound/insert`,
      { numbers: [phoneNumber] },
      {
        headers: {
          authorization: process.env.BLAND_API_KEY,
          'encrypted_key': process.env.BLAND_ENCRYPTED_KEY,
          'Content-Type': 'application/json'
        }
      }
    )
    console.log('BYOT import response:', JSON.stringify(res.data))
    if (res.data?.inserted?.includes(phoneNumber)) {
      return { success: true }
    } else {
      throw new Error('Number not in inserted array: ' + JSON.stringify(res.data))
    }
  } catch (err) {
    console.error('BYOT import failed:', JSON.stringify(err.response?.data || err.message))
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 BYOT import failed for ${phoneNumber}. Manual intervention needed.`)
    return { success: false, error: err.response?.data || err.message }
  }
}

async function configureInboundNumber(phoneNumber, clientConfig) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping inbound number configuration`)
    return { success: true, testMode: true }
  }

  const {
    businessName,
    businessType = 'allied_health',
    afterHoursMessage
  } = clientConfig

  const webhookUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `${process.env.RAILWAY_PUBLIC_DOMAIN}/webhooks/bland`
    : null

  if (!webhookUrl) {
    console.warn('⚠️  RAILWAY_PUBLIC_DOMAIN not set — Bland webhook will not fire')
  }

  const prompt = `You are a friendly and professional receptionist for ${businessName}, an allied health clinic.

Your job is to:
- Greet callers warmly and professionally
- Ask for their name and reason for calling
- If they want to book an appointment, take their name and what they're coming in for, then say: "I'll send you a booking link via SMS shortly so you can lock in a time that suits you"
- If it's an existing patient following up, take their name and message for the treating practitioner
- Capture any urgency and let them know the clinic will call back as soon as possible
- Keep calls efficient and under 2 minutes where possible

Always introduce yourself as the ${businessName} reception.
Never quote fees or confirm availability — just take a message and advise the SMS booking link is on its way.
${afterHoursMessage
    ? `After hours message to relay: ${afterHoursMessage}`
    : 'If asked about hours, let them know the team will be in touch shortly.'
  }`

  try {
    const res = await axios.post(
      `${BLAND_BASE}/inbound/${encodeURIComponent(phoneNumber)}`,
      {
        prompt,
        voice: 'alley',
        language: 'en-AU',
        webhook: webhookUrl,
        first_sentence: `Thank you for calling ${businessName}, how can I help you today?`,
        wait_for_greeting: true,
        interruption_threshold: 100,
        model: 'enhanced',
        max_duration: 5
      },
      {
        headers: {
          authorization: process.env.BLAND_API_KEY,
          'encrypted_key': process.env.BLAND_ENCRYPTED_KEY,
          'Content-Type': 'application/json'
        }
      }
    )
    console.log('Inbound number configured:', JSON.stringify(res.data))
    return { success: true }
  } catch (err) {
    console.error('Inbound number configuration failed:', JSON.stringify(err.response?.data || err.message))
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 Inbound number configuration failed for ${phoneNumber}. Manual intervention needed.`)
    return { success: false, error: err.response?.data || err.message }
  }
}

async function onboardClient(rawData, twilioNumber) {
  const clientConfig = {
    businessName: rawData.business_name,
    ownerMobile: rawData.owner_mobile,
    businessType: rawData.business_type || 'allied_health',
    afterHoursMessage: rawData.after_hours_message
  }

  console.log(`🚀 Onboarding: ${clientConfig.businessName} | TEST_MODE: ${process.env.TEST_MODE}`)

  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 Using test number: ${process.env.TEST_BLAND_NUMBER}`)
    console.log(`🧪 Using test agent: ${process.env.TEST_AGENT_ID}`)
    return {
      success: true,
      phone_number: process.env.TEST_BLAND_NUMBER,
      agent_id: process.env.TEST_AGENT_ID,
      testMode: true
    }
  }

  // 1. Import Twilio number into Bland via BYOT
  const importResult = await importTwilioNumber(twilioNumber)
  if (!importResult.success) {
    throw new Error('Failed to import number into Bland: ' + JSON.stringify(importResult.error))
  }

  // 2. Configure inbound number with prompt, voice, webhook etc
  const configResult = await configureInboundNumber(twilioNumber, clientConfig)
  if (!configResult.success) {
    throw new Error('Failed to configure inbound number: ' + JSON.stringify(configResult.error))
  }

  return {
    success: true,
    phone_number: twilioNumber,
    agent_id: null
  }
}

async function deleteAgent(agentId) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent deletion`)
    return { success: true }
  }

  if (!agentId) {
    console.log('No agent_id to delete — number configured directly')
    return { success: true }
  }

  try {
    await axios.delete(`${BLAND_BASE}/agents/${agentId}`, { headers: headers() })
    console.log(`Agent ${agentId} deleted`)
    return { success: true }
  } catch (err) {
    console.error('Agent deletion failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

module.exports = {
  importTwilioNumber,
  configureInboundNumber,
  onboardClient,
  deleteAgent
}
