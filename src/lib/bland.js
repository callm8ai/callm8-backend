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
      `${BLAND_BASE}/inbound/purchase`,
      {
        phone_number: phoneNumber,
        encrypted_key: process.env.BLAND_ENCRYPTED_KEY
      },
      { headers: headers() }
    )
    console.log('BYOT import response:', JSON.stringify(res.data))
    return { success: true }
  } catch (err) {
    console.error('BYOT import failed:', JSON.stringify(err.response?.data || err.message))
    return { success: false, error: err.response?.data || err.message }
  }
}

async function createAgent(clientConfig) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent creation, using TEST_AGENT_ID`)
    return {
      success: true,
      agentId: process.env.TEST_AGENT_ID,
      testMode: true
    }
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
- If they want to book an appointment, take their name and what they're coming in for, then let them know a booking link will be sent to them via SMS shortly
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
    const response = await axios.post(
      `${BLAND_BASE}/agents`,
      {
        name: `${businessName} Receptionist`,
        prompt,
        voice: 'alice',
        language: 'en-AU',
        webhook: webhookUrl
      },
      { headers: headers() }
    )

    console.log('Agent created:', JSON.stringify(response.data))

    const agentId =
      response.data?.agent?.agent_id ||
      response.data?.agent_id ||
      response.data?.data?.agent_id ||
      response.data?.id

    if (!agentId) {
      console.error('No agent_id in response:', JSON.stringify(response.data))
      throw new Error('No agent_id returned from Bland')
    }

    return { success: true, agentId }
  } catch (err) {
    console.error('Agent creation failed:', JSON.stringify(err.response?.data || err.message))
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 Bland agent creation failed for ${clientConfig.businessName}. Manual intervention needed.`)
    return { success: false, error: err.response?.data || err.message }
  }
}

async function assignAgentToNumber(phoneNumber, agentId) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent assignment`)
    return { success: true, testMode: true }
  }

  try {
    const res = await axios.post(
      `${BLAND_BASE}/inbound/${encodeURIComponent(phoneNumber)}`,
      { agent_id: agentId },
      { headers: headers() }
    )
    console.log('Agent assigned to number:', JSON.stringify(res.data))
    return { success: true }
  } catch (err) {
    console.error('Agent assignment failed:', JSON.stringify(err.response?.data || err.message))
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 Bland agent assignment failed for ${phoneNumber}. Manual intervention needed.`)
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

  const importResult = await importTwilioNumber(twilioNumber)
  if (!importResult.success) {
    await sendSMS(process.env.ADMIN_MOBILE, `🚨 BYOT import failed for ${clientConfig.businessName} (${twilioNumber}). Manual intervention needed.`)
    throw new Error('Failed to import number into Bland: ' + JSON.stringify(importResult.error))
  }

  const agentResult = await createAgent(clientConfig)
  if (!agentResult.success) {
    throw new Error('Failed to create agent: ' + JSON.stringify(agentResult.error))
  }

  const assignResult = await assignAgentToNumber(twilioNumber, agentResult.agentId)
  if (!assignResult.success) {
    throw new Error('Failed to assign agent to number: ' + JSON.stringify(assignResult.error))
  }

  return {
    success: true,
    phone_number: twilioNumber,
    agent_id: agentResult.agentId
  }
}

async function deleteAgent(agentId) {
  if (process.env.TEST_MODE === 'true') {
    console.log(`🧪 TEST_MODE: skipping agent deletion`)
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
  createAgent,
  assignAgentToNumber,
  onboardClient,
  deleteAgent
}
