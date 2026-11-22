// Sends a rendered email: Resend's HTTP API when RESEND_API_KEY is set
// (production), otherwise SMTP to the local Mailpit (supabase start: host
// supabase_inbucket_<project_id>, port 1025 inside the Docker network).

export const FROM_ADDRESS = Deno.env.get("EMAIL_FROM") ?? "noreply@boolaa.ro";
export const FROM_NAME = "Boolaa";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class MailError extends Error {}

export async function sendMail(mail: Mail): Promise<{ via: "resend" | "smtp"; id?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_ADDRESS}>`,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!res.ok) {
      // Never log the body we sent (it contains codes); Resend's error is enough.
      throw new MailError(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = await res.json().catch(() => ({}));
    return { via: "resend", id: body?.id };
  }

  try {
    const id = await smtpSend(mail);
    return { via: "smtp", id };
  } catch (e) {
    throw new MailError(`smtp: ${(e as Error).message}`);
  }
}

// Minimal SMTP client for the local Mailpit only (no TLS, no auth).
// Production always goes through Resend.
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

async function smtpSend(mail: Mail): Promise<string> {
  const conn = await Deno.connect({
    hostname: Deno.env.get("SMTP_HOST") ?? "supabase_inbucket_boolaa",
    port: Number(Deno.env.get("SMTP_PORT") ?? "1025"),
  });
  const enc = new TextEncoder(), dec = new TextDecoder();
  let buffer = "";
  const readReply = async (): Promise<string> => {
    const chunk = new Uint8Array(4096);
    while (true) {
      const lines = buffer.split("\r\n");
      const done = lines.findIndex((l) => /^\d{3} /.test(l));
      if (done >= 0) {
        const reply = lines.slice(0, done + 1).join("\n");
        buffer = lines.slice(done + 1).join("\r\n");
        if (/^[45]/.test(reply)) throw new Error(reply);
        return reply;
      }
      const n = await conn.read(chunk);
      if (n === null) throw new Error("connection closed");
      buffer += dec.decode(chunk.subarray(0, n));
    }
  };
  const cmd = async (line: string) => {
    await conn.write(enc.encode(line + "\r\n"));
    return readReply();
  };
  const messageId = `<${crypto.randomUUID()}@boolaa.ro>`;
  const boundary = `b_${crypto.randomUUID()}`;
  const message = [
    `From: ${encodeHeader(FROM_NAME)} <${FROM_ADDRESS}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(mail.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(mail.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  try {
    await readReply();
    await cmd("EHLO boolaa.local");
    await cmd(`MAIL FROM:<${FROM_ADDRESS}>`);
    await cmd(`RCPT TO:<${mail.to}>`);
    await cmd("DATA");
    await cmd(message + "\r\n.");
    await cmd("QUIT").catch(() => {});
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
  return messageId;
}
