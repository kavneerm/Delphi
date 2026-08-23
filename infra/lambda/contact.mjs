/**
 * Contact form handler.
 *
 * Receives a native HTML form POST — `application/x-www-form-urlencoded`, no JavaScript on
 * the page — validates it, and sends one email through SES.
 *
 * Because the submission is a real form navigation rather than a fetch(), the browser
 * *displays* whatever this returns. So every path ends in a 303 redirect back to a page on
 * the site; the visitor never sees an API response. 303 specifically, so the browser
 * re-issues as GET and a refresh cannot resubmit the form.
 *
 * The AWS SDK v3 is part of the Node 20+ Lambda runtime, so there is nothing to bundle and
 * no dependency to install.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});

const SITE = process.env.SITE_URL;
const TO = process.env.CONTACT_TO;
const FROM = process.env.CONTACT_FROM;

const MAX = { name: 200, email: 320, note: 5000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function redirect(path) {
  return { statusCode: 303, headers: { Location: `${SITE}${path}` }, body: '' };
}

/**
 * Strip CR/LF before any value reaches an email header.
 *
 * `Reply-To` is built from user input, and a newline inside it would let a submitter append
 * headers of their own — a Bcc, a forged From. SES's structured API blocks most of this,
 * but the value is sanitised here rather than relying on that.
 */
function headerSafe(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export const handler = async (event) => {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  const form = new URLSearchParams(raw);
  const name = (form.get('name') ?? '').trim().slice(0, MAX.name);
  const email = (form.get('email') ?? '').trim().slice(0, MAX.email);
  const note = (form.get('note') ?? '').trim().slice(0, MAX.note);
  const trap = (form.get('_gotcha') ?? '').trim();

  // The honeypot is hidden off-screen, so only a bot fills it. Report success anyway:
  // telling a spammer it was rejected only teaches it to try again without that field.
  if (trap) return redirect('/thanks/');

  if (!name || !email || !EMAIL.test(email)) return redirect('/thanks/?e=1');

  await ses.send(
    new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [TO] },
      // So a reply from the inbox goes to the person who wrote in, not to the site's
      // own send address.
      ReplyToAddresses: [headerSafe(email)],
      Message: {
        Subject: { Data: `Inevitable Frontier — ${headerSafe(name)}`, Charset: 'UTF-8' },
        Body: {
          Text: {
            Data: [
              `Name:  ${name}`,
              `Email: ${email}`,
              '',
              note || '(no message)',
            ].join('\n'),
            Charset: 'UTF-8',
          },
        },
      },
    }),
  );

  return redirect('/thanks/');
};
