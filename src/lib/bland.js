const axios = require('axios')

const BLAND_BASE = 'https://api.bland.ai/v1'

const headers = () => ({
  authorization: process.env.BLAND_API_KEY,
  'Content-Type': 'application/json'
})

// Provision a new phone number for a client
async function provisionNumber() {
  try {
    const response = await axios.post(
      `${BLAND_BASE}/inbound/purchase`,
      { area_code: '612' }, // Australian Sydney area code
      { headers: headers() }
    )
    return { success: true, number: response.data.phone_number }
  } catch (error) {
    console.error('Bland provision number failed:', error.response?.data || error.message)
    return { success: false, error: error.message }
  }
}

// Configure the AI agent for a client's inbound number
async function configureInboundAgent(phoneNumber, clientConfig) {
  const {
    businessName,
    ownerMobile,
    businessType = 'clinic',
    afterHoursMessage
  } = clientConfig

  const prompt = `You are a professional receptionist for ${businessName}, a ${businessType}. 

Your job is to:
1. Greet callers warmly and professionally
2. Ask for their name and reason for calling
3. Take a message if the owner is unavailable
4. Capture any urgency or callback preferences
5. Be helpful, friendly and concise

Always introduce yourself as the ${businessName} answering service.
If asked about appointments, explain that someone will call them back to confirm.
Keep calls under 3 minutes where possible.
End the call by confirming you've taken their details and someone will be in touch.

Business: ${businessName}
Type: ${businessType}
${afterHoursMessage ? `After hours message: ${afterHoursMessage}` : ''}`

  try {
    const response = await axios.post(
      `${BLAND_BASE}/inbound/${encodeURIComponent(phoneNumber)}`,
      {
        prompt,
        voice: 'maya',
        language: 'en-AU',
        max_duration: 4,
        record: true,
        transfer_phone_number: ownerMobile,
        transfer_list: {
          [ownerMobile]: `Transfer to ${businessName} owner`
        },
        webhook: process.env.BLAND_WEBHOOK_URL || `${process.env.RAILWAY_PUBLIC_DOMAIN}/webhooks/bland`,
        summary_prompt: `Summarise this call in 2-3 sentences. Include: caller name, reason for call, any urgency, and preferred callback time if mentioned.`
      },
      { headers: headers() }
    )
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Bland configure agent failed:', error.response?.data || error.message)
    return { success: false, error: error.message }
  }
}

module.exports = { provisionNumber, configureInboundAgent }
