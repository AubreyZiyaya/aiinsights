// MyJournal+ AI Insights. Gemini credentials remain on the backend server.
// Admin Dashboard saves the backend URL in Firestore config/ai.backendUrl.
let BACKEND_AI_INSIGHTS_URL = String(window.BACKEND_AI_INSIGHTS_URL || '').trim();

async function loadAdminAIConfig() {
  try {
    const snap = await db.collection('config').doc('ai').get();
    const config = snap.exists ? (snap.data() || {}) : {};
    if (!window.BACKEND_AI_INSIGHTS_URL && config.backendUrl) {
      BACKEND_AI_INSIGHTS_URL = String(config.backendUrl).trim();
    }
  } catch (err) {
    console.warn('Could not load Admin Dashboard AI config:', err);
  }
}

const firebaseConfig = {
  apiKey: "AIzaSyAtzbIZvFLQM65QhOwph0PFpO9vOYcYUdE",
  authDomain: "myjournal-plus.firebaseapp.com",
  databaseURL: "https://myjournal-plus-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "myjournal-plus",
  storageBucket: "myjournal-plus.firebasestorage.app",
  messagingSenderId: "288260274583",
  appId: "1:288260274583:web:9c40aafed9ab9fa30e6cd2",
  measurementId: "G-MXJ84MJGTR"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const totalEntriesEl = document.getElementById('totalEntries');
const totalMoodsEl = document.getElementById('totalMoods');
const aiContainer = document.querySelector('.ai-container');

let currentUser = null;
let userEntries = [];
let userMoods = [];
let conversationContext = "";
let chatHistory = []; // { role: 'user'|'assistant', text, at }
const MAX_STORED_MESSAGES = 80;

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function formatMessageHtml(text) {
  // Light markdown-ish: bold, newlines
  let t = escapeHtml(text);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\n/g, '<br>');
  return t;
}

function addMessage(text, sender = 'assistant', isHtml = false, skipSave = false) {
  if (!chatMessages) return;
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message ' + sender;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  if (isHtml) contentDiv.innerHTML = text;
  else contentDiv.innerHTML = formatMessageHtml(text);

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!skipSave && (sender === 'user' || sender === 'assistant')) {
    chatHistory.push({ role: sender, text: String(text), at: Date.now() });
    if (chatHistory.length > MAX_STORED_MESSAGES) {
      chatHistory = chatHistory.slice(-MAX_STORED_MESSAGES);
    }
    persistChatDebounced();
  }
}

function addTypingIndicator() {
  if (!chatMessages) return;
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.id = 'typingIndicator';
  const typingDiv = document.createElement('div');
  typingDiv.className = 'typing-indicator';
  typingDiv.setAttribute('role', 'status');
  typingDiv.setAttribute('aria-label', 'AI is thinking');
  typingDiv.innerHTML = '<span class="typing-label">AI is thinking</span><span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>'; 
  messageDiv.appendChild(typingDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

function showError(message) {
  if (!chatMessages) return;
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = '⚠️ ' + message;
  chatMessages.appendChild(errorDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSuccess(message) {
  if (!chatMessages) return;
  const successDiv = document.createElement('div');
  successDiv.className = 'success-message';
  successDiv.textContent = '✓ ' + message;
  chatMessages.appendChild(successDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSimpleDialog(message, opts) {
  opts = opts || {};
  // Minimal fallback when main.js helpers are absent
  if (typeof showDialog === 'function') {
    showDialog(message, opts);
    return;
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1440;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:24px;max-width:400px;color:#fff;font-family:Inter,system-ui,sans-serif';
  box.innerHTML = '<p style="margin:0 0 16px;line-height:1.5">' + escapeHtml(message) + '</p>';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
  (opts.buttons || [{ text: 'OK', onClick: () => {} }]).forEach(b => {
    const btn = document.createElement('button');
    btn.textContent = b.text;
    btn.className = b.class || 'btn';
    btn.style.cssText = 'padding:8px 14px;border-radius:10px;border:none;cursor:pointer;font-weight:600;' +
      (b.class && b.class.includes('primary') ? 'background:linear-gradient(90deg,#7b6cff,#4dd3ff);color:#041025;' : 'background:rgba(255,255,255,.1);color:#fff;');
    btn.onclick = () => { document.body.removeChild(overlay); if (b.onClick) b.onClick(); };
    row.appendChild(btn);
  });
  box.appendChild(row);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

let persistTimer = null;
function persistChatDebounced() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistChat, 600);
}

async function persistChat() {
  if (!currentUser || !chatHistory.length) return;
  try {
    await db.collection('users').doc(currentUser.uid).collection('aiChats').doc('latest').set({
      messages: chatHistory.slice(-MAX_STORED_MESSAGES),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      messageCount: chatHistory.length
    }, { merge: true });
  } catch (e) {
    console.warn('persistChat failed', e);
  }
}

async function loadChatHistory() {
  if (!currentUser || !chatMessages) return;
  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection('aiChats').doc('latest').get();
    if (!snap.exists) return;
    const data = snap.data() || {};
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (!msgs.length) return;
    chatHistory = msgs;
    // Clear default welcome then re-render
    chatMessages.innerHTML = '';
    msgs.forEach(m => {
      if (m && m.text) addMessage(m.text, m.role === 'user' ? 'user' : 'assistant', false, true);
    });
  } catch (e) {
    console.warn('loadChatHistory', e);
  }
}

async function loadUserData() {
  if (!currentUser) return;
  try {
    const entriesSnap = await db.collection('users').doc(currentUser.uid).collection('entries').orderBy('createdAt', 'desc').limit(40).get();
    userEntries = entriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let moodsSnap;
    try {
      moodsSnap = await db.collection('users').doc(currentUser.uid).collection('moods').orderBy('createdAt', 'desc').limit(30).get();
    } catch (e) {
      moodsSnap = await db.collection('users').doc(currentUser.uid).collection('moods').limit(30).get();
    }
    userMoods = moodsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (totalEntriesEl) totalEntriesEl.textContent = userEntries.length;
    if (totalMoodsEl) totalMoodsEl.textContent = userMoods.length;
    buildConversationContext();
  } catch (e) {
    console.error('Error loading user data:', e);
    showError('Failed to load your entries. Please refresh.');
  }
}

function buildConversationContext() {
  let context = "You are MyJournal+'s compassionate AI Assistant. Your role is to:\n";
  context += "1. Analyze journal entries to identify patterns, themes, and emotional trends\n";
  context += "2. Track mood data and provide insights about emotional well-being\n";
  context += "3. Offer supportive, non-judgmental guidance based on the user's personal journal\n";
  context += "4. Suggest actionable steps for mental health improvement\n";
  context += "5. Celebrate progress and provide encouragement\n";
  context += "6. Always prioritize mental health and suggest professional help if needed\n\n";
  context += "IMPORTANT GUIDELINES:\n";
  context += "- Be warm, empathetic, and genuinely supportive\n";
  context += "- Never provide medical advice; suggest professional help when appropriate\n";
  context += "- Use specific examples from their journal when relevant\n";
  context += "- Acknowledge their feelings and validate their experiences\n";
  context += "- Focus on growth, resilience, and positive coping strategies\n";
  context += "- Keep responses concise but meaningful (2-4 short paragraphs max)\n\n";

  if (userEntries.length > 0) {
    context += "USER'S RECENT ENTRIES SUMMARY:\n";
    userEntries.slice(0, 6).forEach((entry, idx) => {
      const title = entry.title || '(Untitled)';
      const raw = (entry.content || entry.body || entry.text || '').replace(/<\/?[^>]+(>|$)/g, '');
      const snippet = raw.substring(0, 160) + (raw.length > 160 ? '...' : '');
      context += `${idx + 1}. "${title}": ${snippet}\n`;
    });
    context += "\n";
  }
  if (userMoods.length > 0) {
    context += "USER'S MOOD HISTORY (Last 10):\n";
    const recentMoods = userMoods.slice(0, 10);
    const moodCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    recentMoods.forEach(mood => {
      const v = Number(mood.value || mood.mood || mood.score);
      if (moodCounts[v] !== undefined) moodCounts[v]++;
    });
    const moodLabels = { 1: 'Terrible', 2: 'Bad', 3: 'Okay', 4: 'Good', 5: 'Excellent' };
    Object.keys(moodCounts).forEach(value => {
      if (moodCounts[value] > 0) context += `${moodLabels[value]} (${value}): ${moodCounts[value]} times\n`;
    });
    context += "\n";
  }
  conversationContext = context;
}

async function ensurePremiumAccessOrRedirect() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        showSimpleDialog('AI Insights is a Premium feature. Please sign in and upgrade to access it.', {
          buttons: [
            { text: 'Sign in', class: 'btn primary', onClick: () => { window.location.href = 'login.html'; } },
            { text: 'Back', class: 'btn', onClick: () => { window.location.href = 'home.html'; } }
          ]
        });
        return resolve(false);
      }
      try {
        const doc = await db.collection('users').doc(user.uid).get().catch(() => null);
        const data = doc && doc.exists ? doc.data() : {};
        if (!data || !data.isPremium) {
          showSimpleDialog('AI Insights is a Premium feature. Upgrade to use it.', {
            buttons: [
              { text: 'Upgrade', class: 'btn primary', onClick: () => { window.location.href = 'payment.html'; } },
              { text: 'Back', class: 'btn', onClick: () => { window.location.href = 'home.html'; } }
            ]
          });
          return resolve(false);
        }
        resolve(true);
      } catch (e) {
        console.error('premium check error', e);
        resolve(false);
      }
    });
  });
}

async function requestAI(prompt, maxTokens = 800) {
  if (!BACKEND_AI_INSIGHTS_URL) {
    throw new Error('AI is not configured. Ask an administrator to set the Backend AI URL in Admin Dashboard → AI Insights config.');
  }
  if (!auth.currentUser) {
    throw new Error('Please sign in again to use AI Insights.');
  }
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(BACKEND_AI_INSIGHTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + idToken
    },
    body: JSON.stringify({ prompt, maxTokens })
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 180);
    throw new Error('AI backend error (' + res.status + ')' + (detail ? ': ' + detail : ''));
  }
  const json = await res.json();
  const result = json.text || json.response || json.output || '';
  if (!result) throw new Error('The AI service returned an empty response. Please try again.');
  return result;
}

function selectedPeriodData() {
  const periodEl = document.getElementById('insightPeriod');
  const selected = periodEl ? periodEl.value : '30';
  if (selected === 'all') return { entries: userEntries, moods: userMoods, label: 'all available history' };
  const days = Math.max(1, Number(selected) || 30);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const getTime = item => {
    const raw = item.createdAt || item.date || item.timestamp || item.updatedAt;
    if (raw && typeof raw.toDate === 'function') return raw.toDate().getTime();
    if (raw && typeof raw.seconds === 'number') return raw.seconds * 1000;
    if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
    const parsed = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const within = item => { const t = getTime(item); return !Number.isFinite(t) || t >= cutoff; };
  return { entries: userEntries.filter(within), moods: userMoods.filter(within), label: 'the last ' + days + ' days' };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null || value === '' ? 'Not enough data yet.' : String(value);
}

function safeJsonFromAI(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch (_) {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (_) {}
    }
  }
  return null;
}

function renderRecommendations(items) {
  const root = document.getElementById('recommendations');
  if (!root) return;
  const recommendations = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!recommendations.length) {
    root.innerHTML = '<div class="recommendation"><div class="recommendation-icon">💡</div><div><h3>Keep reflecting</h3><p>Write one honest sentence about what mattered most today.</p><div class="recommendation-actions"><button type="button" data-action="reflection">Write reflection</button><button type="button" data-action="reminder">Plan a reminder</button></div></div></div>';
    return;
  }
  root.innerHTML = recommendations.map((item, index) => {
    const title = escapeHtml(typeof item === 'string' ? item : (item.title || 'Reflection idea'));
    const description = escapeHtml(typeof item === 'string' ? '' : (item.description || item.action || 'Try this at your own pace.'));
    return '<div class="recommendation"><div class="recommendation-icon">' + (index === 0 ? '💡' : '🌱') + '</div><div><h3>' + title + '</h3><p>' + description + '</p><div class="recommendation-actions"><button type="button" data-action="reflection" data-recommendation="' + title + '">Write reflection</button><button type="button" data-action="reminder" data-recommendation="' + title + '">Plan a reminder</button></div></div></div>';
  }).join('');
}

async function generateInsights() {
  const button = document.getElementById('generateInsightsBtn');
  if (!button || button.disabled) return;
  const original = button.innerHTML;
  const { entries, moods, label } = selectedPeriodData();
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span> Analyzing…';
  setText('aiSummary', 'AI is reviewing your journal and mood data…');
  setText('emotionalInsight', 'Analyzing emotional patterns…');
  setText('themesInsight', 'Finding recurring themes…');
  setText('moodInsight', 'Reviewing mood trends…');
  setText('growthInsight', 'Looking for signs of progress…');
  const chart = document.getElementById('moodChart');
  if (chart) chart.textContent = 'Preparing your mood visualization…';

  // Show the same visible thinking state in the chat while the analysis runs.
  addTypingIndicator();
  try {
    const entryData = entries.slice(0, 35).map(e => ({
      title: String(e.title || 'Untitled').slice(0, 100),
      content: String(e.content || e.body || e.text || '').replace(/<\/?[^>]+(>|$)/g, '').slice(0, 900),
      date: String((e.createdAt && e.createdAt.toDate ? e.createdAt.toDate().toISOString() : e.date || '')).slice(0, 40)
    }));
    const moodData = moods.slice(0, 60).map(m => ({
      value: Number(m.value || m.mood || m.score),
      date: String((m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toISOString() : m.date || '')).slice(0, 40),
      note: String(m.note || m.notes || '').slice(0, 200)
    }));
    const prompt = conversationContext + '\nAnalyze only the user data supplied below for ' + label + '. Return ONLY valid JSON with keys summary, emotionalInsight, themesInsight, moodInsight, growthInsight, moodTrendLabel, recommendations (array of objects with title and description), themes (array of strings), and practicalNextStep. Be compassionate and avoid diagnosing or claiming certainty. If data is limited, state that clearly. Do not invent patterns unsupported by data.\nUSER DATA:\n' + JSON.stringify({ entries: entryData, moods: moodData });
    const raw = await requestAI(prompt, 1200);
    const data = safeJsonFromAI(raw);
    if (!data) {
      // Still make useful output if the model returned prose rather than JSON.
      setText('aiSummary', raw);
      setText('emotionalInsight', 'See the summary above for the generated analysis.');
      setText('themesInsight', 'Ask the assistant to list recurring themes for a more focused breakdown.');
      setText('moodInsight', moods.length ? 'Your available mood logs were included in the analysis.' : 'No mood logs were found in this period.');
      setText('growthInsight', 'Use the summary above as a starting point for reflection.');
      renderRecommendations([{title:'Reflect on the analysis', description:'Write down one observation that feels accurate and one question you want to explore.'}]);
      addMessage('Your journal analysis is ready. I could not format every section automatically, so the main summary is shown in the overview.', 'assistant');
    } else {
      setText('aiSummary', data.summary || 'The AI did not provide a summary.');
      setText('emotionalInsight', data.emotionalInsight || 'Not enough data to identify an emotional pattern.');
      setText('themesInsight', data.themesInsight || 'Not enough data to identify recurring themes.');
      setText('moodInsight', data.moodInsight || 'Not enough mood data to identify a trend.');
      setText('growthInsight', data.growthInsight || 'More reflections over time may help reveal growth patterns.');
      setText('moodTrendLabel', data.moodTrendLabel || 'Based on available data');
      const themesEl = document.getElementById('themeList');
      if (themesEl) {
        const themes = Array.isArray(data.themes) ? data.themes.slice(0, 8) : [];
        themesEl.innerHTML = themes.length ? themes.map((theme, i) => '<div class="theme-row"><span class="theme-name">' + escapeHtml(theme) + '</span><span class="theme-frequency">' + (i + 1) + '</span><span class="theme-trend">Observed</span></div>').join('') : '<div class="theme-row"><span class="theme-name">No clear themes yet</span><span class="theme-frequency">—</span><span class="theme-trend">Keep journaling</span></div>';
      }
      renderRecommendations(data.recommendations);
      addMessage('Your journal insights are ready. I have updated the overview, key insights, themes, and recommendations using the available data.', 'assistant');
    }
    renderMoodSummary(moods);
  } catch (error) {
    console.error('Generate insights failed:', error);
    showError(error.message || 'Unable to generate insights. Please try again.');
    setText('aiSummary', 'We could not generate insights. Check your AI connection and try again.');
  } finally {
    removeTypingIndicator();
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = original;
  }
}

function renderMoodSummary(moods) {
  const valid = moods.map(m => Number(m.value || m.mood || m.score)).filter(v => Number.isFinite(v) && v >= 1 && v <= 5);
  const avg = valid.length ? valid.reduce((a,b) => a+b, 0) / valid.length : null;
  setText('averageMood', avg == null ? '—' : avg.toFixed(1) + ' / 5');
  setText('positiveMood', valid.length ? Math.round(valid.filter(v => v >= 4).length / valid.length * 100) + '%' : '—');
  const variance = valid.length && avg != null ? valid.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / valid.length : null;
  setText('moodVariation', variance == null ? '—' : Math.sqrt(variance).toFixed(2));
  setText('overallMood', avg == null ? '—' : avg >= 4 ? 'Positive' : avg >= 3 ? 'Mixed' : 'Low');
  setText('moodStability', valid.length < 2 ? 'More data needed' : Math.sqrt(variance) < 0.8 ? 'Fairly steady' : 'Variable');
  setText('journalConsistency', userEntries.length ? userEntries.length + ' entries' : 'Start journaling');
  setText('growthScore', userEntries.length >= 10 ? 'Building' : userEntries.length >= 3 ? 'Emerging' : 'Early stage');
  const chart = document.getElementById('moodChart');
  if (!chart) return;
  if (!valid.length) { chart.textContent = 'Add mood logs to see a mood visualization.'; return; }
  const counts = [1,2,3,4,5].map(n => valid.filter(v => v === n).length);
  chart.innerHTML = '<div class="mood-bars" role="img" aria-label="Mood log counts from 1 to 5">' + counts.map((count, i) => '<div class="mood-bar-column"><div class="mood-bar-count">' + count + '</div><div class="mood-bar" style="height:' + Math.max(6, count / Math.max(...counts) * 100) + '%"></div><span>' + (i + 1) + '/5</span></div>').join('') + '</div>';
}

async function sendMessage(presetText) {
  const text = (presetText != null ? String(presetText) : (userInput && userInput.value) || '').trim();
  if (!text) return;
  if (userInput) {
    userInput.value = '';
    userInput.style.height = 'auto';
  }
  addMessage(text, 'user');
  addTypingIndicator();
  if (sendBtn) sendBtn.disabled = true;

  try {
    const recentTurns = chatHistory.slice(-8).map(m =>
      (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.text
    ).join('\n');
    const systemPrompt = conversationContext +
      (recentTurns ? '\nRecent conversation:\n' + recentTurns + '\n' : '') +
      '\nUser question: ' + text + '\n\nProvide a warm, supportive response (concise).';

    const responseText = await requestAI(systemPrompt, 600);

    removeTypingIndicator();
    addMessage(responseText, 'assistant');
  } catch (error) {
    removeTypingIndicator();
    console.error('Error calling AI:', error);
    showError('AI request failed: ' + (error && error.message ? error.message.slice(0, 160) : 'Please try again later.'));
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

sendBtn && sendBtn.addEventListener('click', () => sendMessage());
const generateInsightsBtn = document.getElementById('generateInsightsBtn');
generateInsightsBtn && generateInsightsBtn.addEventListener('click', generateInsights);
document.querySelectorAll('.quick-btn').forEach(button => {
  button.type = 'button';
  button.addEventListener('click', () => {
    const prompt = button.getAttribute('data-prompt') || button.textContent.trim();
    if (prompt) { sendMessage(prompt); if (chatMessages) chatMessages.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });
});
const recommendationsRoot = document.getElementById('recommendations');
recommendationsRoot && recommendationsRoot.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const idea = button.getAttribute('data-recommendation') || 'my personal wellbeing';
  if (button.dataset.action === 'reflection') {
    sendMessage('Help me write a thoughtful journal reflection about this recommendation: ' + idea + '. Give me a few prompts and a short fill-in template.');
  } else if (button.dataset.action === 'reminder') {
    sendMessage('Help me turn this recommendation into a realistic reminder: ' + idea + '. Suggest a reminder title, a suitable time, and a small action. Be clear that you are helping me plan it, not setting a device reminder.');
  }
  if (chatMessages) chatMessages.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
if (userInput) {
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
  });
}

clearChatBtn && clearChatBtn.addEventListener('click', async () => {
  if (!confirm('Clear all chat messages? This removes saved history too.')) return;
  chatHistory = [];
  if (chatMessages) {
    chatMessages.innerHTML = '<div class="message system"><div class="message-content">👋 Welcome to your AI Journal Assistant! I\'m here to help you analyze your entries, understand your moods, and provide personalized insights for your mental wellbeing.</div></div>';
  }
  if (currentUser) {
    try {
      await db.collection('users').doc(currentUser.uid).collection('aiChats').doc('latest').delete();
    } catch (e) { /* ok */ }
  }
  showSuccess('Chat cleared');
});

// FAQ / quick prompts
document.querySelectorAll('.faq-item').forEach(item => {
  item.addEventListener('click', event => {
    if (event.target.closest('a,button')) return;
    const q = item.getAttribute('data-faq') || item.textContent;
    if (q) sendMessage(q);
  });
});

(async function initPage() {
  const allowed = await ensurePremiumAccessOrRedirect();
  if (!allowed) {
    if (aiContainer) {
      aiContainer.innerHTML = `<div class="ai-premium-gate" style="padding:28px;max-width:520px;margin:40px auto;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:12px">✨</div>
        <h2 style="margin:0 0 8px">AI Insights — Premium</h2>
        <p style="color:var(--muted,rgba(255,255,255,.6));line-height:1.6">Unlock journaling analysis, mood summaries, and personalized prompts with Premium.</p>
        <p style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="payment.html" class="btn primary" style="text-decoration:none;padding:10px 18px;border-radius:12px;background:linear-gradient(90deg,#7b6cff,#4dd3ff);color:#041025;font-weight:700">Upgrade</a>
          <a href="home.html" class="btn" style="text-decoration:none;padding:10px 18px;border-radius:12px;background:rgba(255,255,255,.08);color:#fff">Back</a>
        </p>
      </div>`;
    }
    return;
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) return;
    currentUser = user;
    await loadAdminAIConfig();
    await loadUserData();
    renderMoodSummary(userMoods);
    await loadChatHistory();
    if (!chatHistory.length) {
      if (userEntries.length === 0 && userMoods.length === 0) {
        addMessage("Welcome! I notice you don't have any entries yet. Start journaling, and I'll help you gain insights about your thoughts, feelings, and growth. 📝", 'assistant');
      } else {
        addMessage(`Great to see you again! I've reviewed your ${userEntries.length} entries and ${userMoods.length} mood logs. Ask me anything about your journal journey, and I'll provide personalized insights. 🌟`, 'assistant');
      }
    }
  });
})();
