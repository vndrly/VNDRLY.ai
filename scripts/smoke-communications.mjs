import "./load-env-local.mjs";

function required(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function basicAuth(user, pass) {
  return Buffer.from(`${user}:${pass}`).toString("base64");
}

async function checkTwilioNumber() {
  const accountSid = required("TWILIO_ACCOUNT_SID");
  const apiKey = required("TWILIO_API_KEY");
  const apiSecret = required("TWILIO_API_SECRET");
  const from = required("TWILIO_PHONE_NUMBER");
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json` +
    `?PhoneNumber=${encodeURIComponent(from)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${basicAuth(apiKey, apiSecret)}` },
  });
  const body = await res.json().catch(() => ({}));
  const rows = Array.isArray(body.incoming_phone_numbers) ? body.incoming_phone_numbers : [];
  console.log(`twilio.number.http=${res.status}`);
  console.log(`twilio.number.matches=${rows.length}`);
  console.log(`twilio.number.sms=${Boolean(rows[0]?.capabilities?.sms)}`);
  if (!res.ok || rows.length === 0 || !rows[0]?.capabilities?.sms) {
    throw new Error("Twilio sender number is not SMS-ready");
  }
}

async function maybeSendTwilioSmokeSms() {
  const to = process.env.TWILIO_SMOKE_TO?.trim() ?? "";
  if (!to) {
    console.log("twilio.sms.skipped=missing TWILIO_SMOKE_TO");
    return;
  }
  const accountSid = required("TWILIO_ACCOUNT_SID");
  const apiKey = required("TWILIO_API_KEY");
  const apiSecret = required("TWILIO_API_SECRET");
  const from = required("TWILIO_PHONE_NUMBER");
  const params = new URLSearchParams({
    From: from,
    To: to,
    Body: `VNDRLY Twilio smoke test ${new Date().toISOString()}`,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(apiKey, apiSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = await res.json().catch(() => ({}));
  console.log(`twilio.sms.http=${res.status}`);
  console.log(`twilio.sms.sidPrefix=${String(body.sid ?? "").slice(0, 2)}`);
  console.log(`twilio.sms.status=${body.status ?? ""}`);
  if (!res.ok) throw new Error(`Twilio SMS smoke failed: ${body.code ?? res.status}`);
}

async function checkSendGrid() {
  const apiKey = required("SENDGRID_API_KEY");
  const fromEmail = required("SENDGRID_FROM_EMAIL");
  const fromName = "VNDRLY.ai";
  const scopes = await fetch("https://api.sendgrid.com/v3/scopes", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log(`sendgrid.scopes.http=${scopes.status}`);
  if (!scopes.ok) throw new Error("SendGrid scopes check failed");

  const payload = {
    personalizations: [{ to: [{ email: fromEmail }] }],
    from: { email: fromEmail, name: fromName },
    subject: "VNDRLY SendGrid sandbox validation",
    content: [{ type: "text/plain", value: "SendGrid sandbox validation only." }],
    mail_settings: { sandbox_mode: { enable: true } },
  };
  const send = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  console.log(`sendgrid.sandbox.http=${send.status}`);
  console.log(`sendgrid.sandbox.messageId=${Boolean(send.headers.get("x-message-id"))}`);
  if (!send.ok) throw new Error("SendGrid sandbox send failed");
}

async function checkExpoPush() {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "ExpoPushToken[0000000000000000000000]",
      title: "VNDRLY smoke test",
      body: "Push connectivity check",
      data: { type: "smoke_test" },
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`expo.push.http=${res.status}`);
  console.log(`expo.push.kind=${body?.data?.status || body?.errors?.[0]?.code || "unknown"}`);
  if (!res.ok) throw new Error("Expo push endpoint check failed");
}

async function main() {
  await checkTwilioNumber();
  await maybeSendTwilioSmokeSms();
  await checkSendGrid();
  await checkExpoPush();
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
