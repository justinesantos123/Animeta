/**
 * Outbound email via the Resend HTTP API.
 *
 * The sending domain and the public app URL are Cloudflare *vars*, not
 * constants, so pointing this at a real production domain later is a config
 * change with no code edits.
 *
 * If RESEND_API_KEY is not set the caller gets `sent: false` and is expected to
 * surface the link itself. That keeps the reset flow usable for testing before
 * any email provider is configured, instead of hard-failing.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function mailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

/**
 * @returns {Promise<{sent: boolean, reason?: string, id?: string}>}
 */
export async function sendPasswordResetEmail(env, { to, resetUrl, expiresMinutes }) {
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: 'RESEND_API_KEY is not configured' };
  }
  if (!env.MAIL_FROM) {
    return { sent: false, reason: 'MAIL_FROM is not configured' };
  }

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0D0D0F;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#E8E8EF">
    <div style="max-width:520px;margin:0 auto;background:#16161A;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px">
      <p style="margin:0 0 4px;font-size:20px;font-weight:800;letter-spacing:-0.02em">
        <span style="color:#7B61FF">ANI</span><span>META</span>
      </p>
      <h1 style="margin:24px 0 8px;font-size:22px;font-weight:700">Reset your password</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#8A8A99">
        You asked to reset the password for this Animeta account. This link works once and
        expires in ${expiresMinutes} minutes.
      </p>
      <p style="margin:0 0 24px">
        <a href="${resetUrl}"
           style="display:inline-block;background:#FF3B3B;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:10px">
          Choose a new password
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#8A8A99">
        If the button does not work, paste this into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#7B61FF">${resetUrl}</p>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#8A8A99">
        If you did not request this, you can ignore this email &mdash; your password will not change.
      </p>
    </div>
  </body>
</html>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject: 'Reset your Animeta password',
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { sent: false, reason: `Resend responded ${res.status}: ${detail.slice(0, 200)}` };
    }

    const data = await res.json().catch(() => ({}));
    return { sent: true, id: data?.id };
  } catch (err) {
    return { sent: false, reason: String(err) };
  }
}
