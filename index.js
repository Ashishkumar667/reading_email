import express from 'express';
import { google } from 'googleapis';
import { htmlToText } from 'html-to-text';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT_N || 3000;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];


const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

app.get('/', async (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.json({ auth_url: url });
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  res.json({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expiry_date,
  });
});

app.get('/emails', async (req, res) => {
  const { access_token, from, subject, after, before, is } = req.query;

  if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
  oauth2Client.setCredentials({ access_token });

  let query = '';
  if (from) query += `from:${from} `;
  if (subject) query += `subject:${subject} `;
  if (after) query += `after:${after} `;
  if (before) query += `before:${before} `;
  if (is) query += `is:${is} `;

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const resp = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10,
      q: query.trim(),
    });

    const messages = await Promise.all(
      (resp.data.messages || []).map(async (msg) => {
        const { data } = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const headers = data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
        const from = headers.find(h => h.name === 'From')?.value || '(No From)';
        const date = headers.find(h => h.name === 'Date')?.value || '(No Date)';
        const messageId = headers.find(h => h.name === 'Message-ID')?.value || '';
        const body = htmlToText(extractMessageBody(data.payload));

        return { subject, from, date, body, threadId: data.threadId, messageId };
      })
    );

    res.json({ query: query.trim(), messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

app.post('/reply', async (req, res) => {
  const { accesss_token, threadId, to, subject, inReplyTo, message } = req.body;

  if (!access_token || !threadId || !to || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  oauth2Client.setCredentials({ accesss_token });

  try {
    await sendReply(oauth2Client, threadId, to, subject, inReplyTo, message);
    res.json({ success: true, message: 'Reply sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

function extractMessageBody(payload) {
  const decode = data => Buffer.from(data, 'base64').toString('utf-8');

  if (payload.body?.data) return decode(payload.body.data);

  if (payload.parts && payload.parts.length) {
    for (let part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decode(part.body.data);
      }
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decode(part.body.data);
      }
    }
  }

  return '(No content)';
}

async function sendReply(auth, threadId, to, subject, inReplyTo, replyText) {
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = Buffer.from(
    `To: ${to}
Subject: Re: ${subject}
In-Reply-To: ${inReplyTo}
References: ${inReplyTo}
Content-Type: text/plain; charset="UTF-8"

${replyText}`
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: raw,
      threadId: threadId,
    },
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
