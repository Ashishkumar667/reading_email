import fs from 'fs';
import express from 'express';
import { google } from 'googleapis';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';
import { htmlToText } from 'html-to-text';
import dotenv from 'dotenv';
dotenv.config();


const app = express();
const PORT = 3000;

const SCOPES = process.env.GOOGLE_SCOPES;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

let latestEmails = []; 

app.get('/', async (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  
  await open(url);
  res.send('Redirecting to Google Login...');
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  await readEmails(oauth2Client);
  res.redirect('/emails'); 
});

app.get('/emails', async(req, res) => {
 const { from, subject, after, before, is } = req.query;

  
  let query = '';
  if (from) query += `from:${from} `;
  if (subject) query += `subject:${subject} `;
  if (after) query += `after:${after} `;       
  if (before) query += `before:${before} `;
  if (is) query += `is:${is} `;              

  await readEmails(oauth2Client, query.trim()); 

 
  const html = `
    <h1> Filtered Emails</h1>
    <p> Search Query: <code>${query.trim() || 'None'}</code></p>
    <form method="GET" style="margin-bottom:20px">
      <input name="from" placeholder="From email" value="${from || ''}" />
      <input name="subject" placeholder="Subject" value="${subject || ''}" />
      <input name="after" placeholder="After YYYY/MM/DD" value="${after || ''}" />
      <input name="before" placeholder="Before YYYY/MM/DD" value="${before || ''}" />
      <select name="is">
        <option value="">Read/Unread</option>
        <option value="unread" ${is === 'unread' ? 'selected' : ''}>Unread</option>
        <option value="read" ${is === 'read' ? 'selected' : ''}>Read</option>
      </select>
      <button type="submit">🔍 Filter</button>
    </form>
    ${latestEmails.map(email => `
      <hr />
      <h3>${email.subject}</h3>
      <p><strong>From:</strong> ${email.from}</p>
      <p><strong>Date:</strong> ${email.date}</p>
      <pre style="white-space:pre-wrap;font-family:inherit;">${email.body}</pre>
    `).join('')}
  `;
  res.send(html);
});


async function readEmails(auth,query = '') {
  const gmail = google.gmail({ version: 'v1', auth });

   const res = await gmail.users.messages.list({
  userId: 'me',
  maxResults: 10,
  q: query, 
});
  const messages = res.data.messages;

  latestEmails = [];

  for (let msg of messages) {
    const { data: fullMessage } = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    const headers = fullMessage.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(No From)';
    const date = headers.find(h => h.name === 'Date')?.value || '(No Date)';
    const rawBody = extractMessageBody(fullMessage.payload);

    const readableBody = htmlToText(rawBody, { wordwrap: 130 });

    latestEmails.push({ subject, from, date, body: readableBody });
  }
}


function extractMessageBody(payload) {
  const decode = data => Buffer.from(data, 'base64').toString('utf-8');

  if (payload.body?.data) {
    return decode(payload.body.data);
  }

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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
