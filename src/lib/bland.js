const axios = require('axios')

const BLAND_BASE = 'https://api.bland.ai/v1'

// 🔒 Toggle this OFF when going live
const DISABLE_PROVISIONING = true

// ✅ FIXED HEADERS (CRITICAL)
const headers = () => ({
  authorization: process.env.BLAND_API_KEY,
  'Content-Type': 'application/json'
})

/* =========================
   PROVISION NUMBER
========================= */
async function provisionNumber() {

  // 🧪 TEST MODE (prevents charges)
  if (DISABLE_PROVISIONING) {
    console.log("🧪 PROVISIONING DISABLED (test mode)")

    return {
      success: true,
      number: "+61400000000",
      testMode: true
    }
  }

  const attempts = [
    { country_code: "US", type: "local" }
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
        throw new Error("No number returned from Bland")
      }

      return {
        success: true,
        number,
        used: attempt
      }

    } catch (error) {
      console.log("Failed attempt:", attempt, error.response?.data || error.message)
    }
  }

  return {
    success: false,
    error: "No numbers available"
  }
}


/* =========================
   CONFIGURE AGENT (PERSONA)
========================= */
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

  if (!businessName) {
    return { success: false, error: 'Missing businessName (persona will break)' }
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

  const cleanNumber = phoneNumber.replace(/\+/g, '').replace(/\s/g, '')

  // ✅ DEBUG LOGS (VERY IMPORTANT)
  const webhookUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhooks/bland`

  console.log("📡 Webhook URL:", webhookUrl)
  console.log("📦 Sending to Bland:", {
    phoneNumber,
    businessName,
    ownerMobile
  })

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
        webhook: webhookUrl,
        summary_prompt: `Summarise this call in 2-3 sentences. Include: caller name, reason for call, any urgency, and preferred callback time if mentioned.`
      },
      { headers: headers() }
    )

    console.log('Bland configure response:', JSON.stringify(response.data))

    // 🚨 HARD CHECK
    if (!response.data || response.data.error) {
      throw new Error("Bland failed to configure agent")
    }

    return { success: true, data: response.data }

  } catch (error) {
    console.error('Bland configure agent failed:', JSON.stringify(error.response?.data || error.message))
    return { success: false, error: JSON.stringify(error.response?.data || error.message) }
  }
}


/* =========================
   FULL ONBOARDING PIPELINE
========================= */
async function onboardClient(rawData) {

  const clientConfig = {
    businessName: rawData.business_name,
    ownerMobile: rawData.owner_mobile,
    businessType: rawData.business_type,
    afterHoursMessage: rawData.after_hours_message
  }

  console.log("🚀 Onboarding client:", clientConfig)

  // 1️⃣ Provision number
  const numberResult = await provisionNumber()

  if (!numberResult.success) {
    throw new Error("Failed to provision phone number")
  }

  // 2️⃣ Configure agent
  const agentResult = await configureInboundAgent(
    numberResult.number,
    clientConfig
  )

  if (!agentResult.success) {
    throw new Error("Failed to configure AI agent")
  }

  return {
    success: true,
    phone_number: numberResult.number,
    agent: agentResult.data
  }
}


/* =========================
   EXPORTS
========================= */
module.exports = {
  provisionNumber,
  configureInboundAgent,
  onboardClient
}