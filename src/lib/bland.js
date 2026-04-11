const axios = require('axios')

const BLAND_BASE = 'https://api.bland.ai/v1'

const headers = () => ({
  Authorization: `Bearer ${process.env.BLAND_API_KEY}`,
  'Content-Type': 'application/json'
})

// Provision a new phone number for a client
async function provisionNumber() {
  const attempts = [
    { country_code: "US", area_code: "415" },
    { country_code: "US", area_code: "212" },
    { country_code: "US", area_code: "310" },
    { country_code: "US", area_code: "305" }
  ]

  for (const attempt of attempts) {
    try {
      console.log("Trying Bland number:", attempt)

      const res = await axios.post(
        `${BLAND_BASE}/inbound/purchase`,
        attempt,
        { headers: headers() }
      )

      console.log("Bland FULL response:", JSON.stringify(res.data))

      const number =
  res.data?.data?.phone_number ||
  res.data?.phone_number ||
  res.data?.number ||
  res.data?.phoneNumber

      if (!number) {
        console.log("⚠️ No number in response:", res.data)
        throw new Error("No number returned from Bland")
      }

      return {
        success: true,
        number,
        used: attempt
      }

    } catch (error) {
      console.log(
        "Failed attempt:",
        attempt,
        JSON.stringify(error.response?.data || error.message)
      )
    }
  }

  return {
    success: false,
    error: "No US numbers available in selected area codes"
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

  if (!phoneNumber) {
    return { success: false, error: 'No phone number provided' }
  }

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

  // Strip + and spaces from phone number for URL
  const cleanNumber = phoneNumber.replace(/\+/g, '').replace(/\s/g, '')

  try {
    const response = await axios.post(
      `${BLAND_BASE}/inbound/${cleanNumber}`,
      {
        prompt,
        voice: 'maya',
        language: 'en-AU',
        max_duration: 4,
        record: true,
        transfer_phone_number: ownerMobile,
        webhook: `${process.env.RAILWAY_PUBLIC_DOMAIN}/webhooks/bland`,
        summary_prompt: `Summarise this call in 2-3 sentences. Include: caller name, reason for call, any urgency, and preferred callback time if mentioned.`
      },
      { headers: headers() }
    )
    console.log('Bland configure response:', JSON.stringify(response.data))
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Bland configure agent failed:', JSON.stringify(error.response?.data || error.message))
    return { success: false, error: JSON.stringify(error.response?.data || error.message) }
  }
}

module.exports = { provisionNumber, configureInboundAgent }
