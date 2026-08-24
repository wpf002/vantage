/**
 * Send a password-reset email via Resend.
 * Uses the same RESEND_API_KEY and EMAIL_FROM env vars as the API package.
 */

import { Resend } from 'resend';

const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Vantage <noreply@vantage.local>';

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Dev without Resend configured — log the link so it's usable locally.
    const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const link = `${base}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    console.warn(`[vantage] RESEND_API_KEY not set. Reset link: ${link}`);
    return;
  }

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const link = `${base}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  const client = new Resend(key);
  await client.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: 'Reset your Vantage password',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="font-size: 24px; font-weight: normal; margin-bottom: 24px;">Reset your password</h2>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
          You requested a password reset for your Vantage account. Click the link below to set a new password.
          The link expires in one hour.
        </p>
        <a href="${link}" style="display: inline-block; font-family: sans-serif; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #c0392b; text-decoration: none; border-bottom: 2px solid #c0392b; padding-bottom: 2px;">
          Reset Password →
        </a>
        <p style="font-size: 12px; color: #888; margin-top: 32px; line-height: 1.5;">
          If you didn't request this, ignore this email — your password won't change.
        </p>
      </div>
    `,
  });
}
