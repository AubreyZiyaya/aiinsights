import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';

const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'https://myjournalplus.com,https://www.myjournalplus.com')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!GEMINI_API_KEY) throw new Error('Missing required environment variable GEMINI_API_KEY');
if (!PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  throw new Error('Missing Firebase Admin credentials: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY');
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: PROJECT_ID,
    clientEmail: CLIENT_EMAIL,
    privateKey: PRIVATE_KEY
  })
});
const firestore = admin.firestore();
const app = express();

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    // Allow server-to-server tools without an Origin header. Browser requests
    // must originate from the configured MyJournal+ site(s).
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));
app.use(express.json({ limit: '80kb' }));

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a few minutes and try again.' }
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'myjournalplus-gemini-backend' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'myjournalplus-gemini-backend' }));

async function authenticateAndCheckPremium(req, res, next) {
  try {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Sign in is required.' });

    const decoded = await admin.auth().verifyIdToken(match[1], true);
    const userSnapshot = await firestore.collection('users').doc(decoded.uid).get();
    const userData = userSnapshot.exists ? (userSnapshot.data() || {}) : {};

    // Match the current MyJournal+ premium flag and enforce it server-side.
    if (userData.isPremium !== true) {
      return res.status(403).json({ error: 'AI Insights requires an active Premium account.' });
    }
    req.authUser = decoded;
    next();
  } catch (error) {
    console.warn('AI authentication rejected:', error?.code || error?.message || 'unknown error');
    return res.status(401).json({ error: 'Your session could not be verified. Sign in again and retry.' });
  }
}

app.post('/api/ai-insights', aiLimiter, authenticateAndCheckPremium, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const requestedTokens = Number(req.body?.maxTokens || 800);
  const maxOutputTokens = Number.isFinite(requestedTokens)
    ? Math.min(2048, Math.max(64, Math.floor(requestedTokens)))
    : 800;

  if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });
  if (prompt.length > 30000) return res.status(413).json({ error: 'The prompt is too long.' });

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens,
            temperature: 0.7,
            topP: 0.95
          }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      // Do not return provider details or credentials to the public client.
      console.error('Gemini API returned HTTP', upstream.status, payload?.error?.status || 'provider_error');
      const status = upstream.status === 429 ? 429 : (upstream.status === 400 ? 502 : 502);
      return res.status(status).json({
        error: upstream.status === 429
          ? 'The AI service is busy or its quota was reached. Please try again later.'
          : 'The AI provider rejected the request. Check the Gemini key, model name, and quota in your server settings.'
      });
    }

    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(part => part?.text || '').join('\n').trim();
    if (!text) {
      console.warn('Gemini returned no text; finish reason:', payload?.candidates?.[0]?.finishReason || 'unknown');
      return res.status(502).json({ error: 'The AI service returned an empty response. Please try again.' });
    }

    // Never log prompts, journal entries, generated text, or the API key.
    return res.json({ text, model: GEMINI_MODEL });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return res.status(504).json({ error: 'The AI service took too long to respond. Please try again.' });
    }
    console.error('AI request failed:', error?.message || 'unknown error');
    return res.status(502).json({ error: 'The AI service is temporarily unavailable. Please try again later.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: 'This website is not allowed to use the AI service.' });
  }
  console.error('Unhandled request error:', err?.message || 'unknown error');
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`MyJournal+ Gemini backend listening on port ${PORT}`);
  console.log(`Gemini model configured: ${GEMINI_MODEL}`);
});
