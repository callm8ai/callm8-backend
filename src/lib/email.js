const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

async function sendEmail(to, subject, html) {
  console.log("🔥 EMAIL FUNCTION ENTERED") // 👈 ADD THIS HERE

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      html
    })

    if (error) {
      console.error(`Resend error sending to ${to}:`, JSON.stringify(error))
      return { success: false, error }
    }

    console.log(`Email sent to ${to}: ${data?.id}`)
    return { success: true, id: data?.id }
  } catch (error) {
    console.error(`Email failed to ${to}:`, error.message)
    return { success: false, error: error.message }
  }
}

function buildCallSummaryEmail(client, call) {
  const duration = call.duration ? `${Math.round(call.duration / 60)} min` : 'Unknown'
  const time = new Date(call.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0D0D2B; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">📞 Callm8</h1>
        <p style="color: #aaa; margin: 5px 0 0 0;">Missed Call Summary</p>
      </div>
      <div style="background: #f9f9f9; padding: 25px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
        <h2 style="color: #333; margin-top: 0;">You missed a call</h2>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 0; color: #666; width: 130px;">📱 Caller</td>
            <td style="padding: 8px 0; color: #333; font-weight: bold;">${call.caller_number || 'Unknown'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">🕐 Time</td>
            <td style="padding: 8px 0; color: #333;">${time}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">⏱ Duration</td>
            <td style="padding: 8px 0; color: #333;">${duration}</td>
          </tr>
        </table>

        <div style="background: #fff; border-left: 4px solid #0D0D2B; padding: 15px; margin-bottom: 20px; border-radius: 0 4px 4px 0;">
          <h3 style="margin: 0 0 10px 0; color: #333;">📋 Call Summary</h3>
          <p style="margin: 0; color: #444; line-height: 1.6;">${call.summary || 'No summary available.'}</p>
        </div>

        ${call.transcript ? `
        <div style="background: #fff; border: 1px solid #eee; padding: 15px; border-radius: 4px;">
          <h3 style="margin: 0 0 10px 0; color: #333;">📝 Full Transcript</h3>
          <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${call.transcript}</p>
        </div>
        ` : ''}

        <p style="margin-top: 25px; color: #999; font-size: 12px; text-align: center;">
          Powered by <strong>Callm8</strong> · callm8.ai
        </p>
      </div>
    </div>
  `
}

module.exports = { sendEmail, buildCallSummaryEmail }