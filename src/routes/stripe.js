function buildSetupEmail(businessName) {
  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 20px;">

      <div style="background: #0a0a0a; padding: 32px 40px; border-radius: 4px 4px 0 0;">
        <p style="margin: 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">callm8</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #888888; letter-spacing: 0.5px; text-transform: uppercase;">AI Receptionist</p>
      </div>

      <div style="background: #ffffff; padding: 40px 40px 32px; border: 1px solid #eeeeee;">
        <p style="font-size: 13px; color: #888888; margin: 0 0 24px; letter-spacing: 0.3px; text-transform: uppercase;">Welcome to Callm8</p>

        <h1 style="font-family: Georgia, serif; font-size: 26px; font-weight: normal; color: #0a0a0a; margin: 0 0 20px; line-height: 1.3;">Hi ${businessName} 👋</h1>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 16px;">
          Welcome to Callm8 — I'm setting up your AI receptionist and want to make sure it sounds exactly right for your clinic.
        </p>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 32px;">
          To get your agent configured, I just need a few details from you. Hit reply and answer the questions below — no need to format anything, just write it however feels natural.
        </p>

        <div style="border-top: 1px solid #eeeeee; margin: 0 0 32px;"></div>

        <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; letter-spacing: 0.5px; text-transform: uppercase; margin: 0 0 20px;">Setup questions</p>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">1. Receptionist preference</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">Would you prefer a male or female AI receptionist voice?</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">2. Services &amp; clinic info</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0 0 10px;">What services does your clinic offer? (e.g. physiotherapy, massage, pilates, etc.)</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">Is there anything else about your clinic you'd like the receptionist to know — location, hours, parking, how to book, etc.?</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">3. After-hours message</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">What would you like the receptionist to say when someone calls outside business hours?</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">4. Booking link</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0 0 10px;">Do you have an online booking link (e.g. HotDoc, Calendly, or similar)? If so, paste it here.</p>
          <p style="font-size: 13px; color: #888888; line-height: 1.6; margin: 0; font-style: italic;">The agent can automatically send callers an SMS with the link so they can book straight away.</p>
        </div>

        <div style="margin-bottom: 24px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">5. FAQs (optional but recommended)</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0 0 10px;">If there are common questions your patients ask — about pricing, what to bring, cancellation policy, rebates, etc. — list them here along with the answers.</p>
          <p style="font-size: 13px; color: #888888; line-height: 1.6; margin: 0; font-style: italic;">Please include both the question and the answer — the agent needs both to respond accurately.</p>
        </div>

        <div style="margin-bottom: 40px; padding: 20px; background: #f8f8f8; border-radius: 4px; border-left: 3px solid #0a0a0a;">
          <p style="font-size: 13px; font-weight: 600; color: #0a0a0a; margin: 0 0 8px;">6. Anything else?</p>
          <p style="font-size: 14px; color: #555555; line-height: 1.6; margin: 0;">Is there anything specific you'd like the receptionist to say, avoid saying, or handle in a particular way?</p>
        </div>

        <div style="border-top: 1px solid #eeeeee; margin: 0 0 32px;"></div>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 16px;">
          Once I have your answers I'll get the agent built and send you a test call so you can hear it in action before it goes live.
        </p>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 32px;">
          Any questions in the meantime, just reply here.
        </p>

        <p style="font-size: 15px; color: #333333; line-height: 1.7; margin: 0 0 4px;">Cheers,</p>
        <p style="font-size: 15px; font-weight: 600; color: #0a0a0a; margin: 0;">Dan</p>
        <p style="font-size: 13px; color: #888888; margin: 4px 0 0;">Callm8</p>
      </div>

      <div style="background: #f8f8f8; padding: 24px 40px; border-radius: 0 0 4px 4px; border: 1px solid #eeeeee; border-top: none;">
        <a href="https://callm8.ai" style="font-size: 13px; color: #0a0a0a; text-decoration: none; font-weight: 500;">callm8.ai</a>
        <span style="font-size: 13px; color: #cccccc; margin: 0 8px;">·</span>
        <a href="mailto:hello@callm8.ai" style="font-size: 13px; color: #888888; text-decoration: none;">hello@callm8.ai</a>
      </div>

    </div>
  `
}
