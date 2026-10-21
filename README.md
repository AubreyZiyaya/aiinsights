# MyJournal+ secure Gemini backend

This service keeps the Gemini API key on the server and exposes the exact endpoint expected by the AI Insights frontend:

`POST https://YOUR-RENDER-SERVICE.onrender.com/api/ai-insights`

It verifies Firebase Authentication ID tokens, checks `users/{uid}.isPremium === true` in Firestore, rate-limits AI requests, limits prompt size/output tokens, and does not log journal prompts or responses.

## 1. Deploy to Render

1. Put the contents of this folder in a new GitHub repository, or deploy this folder as a Render Web Service from a repository.
2. In Render, create a **Web Service**. Build command: `npm install`. Start command: `npm start`. Health check path: `/health`.
3. Add the environment variables below in Render → your service → **Environment**.
4. Deploy. Visit `https://YOUR-SERVICE.onrender.com/health`; it should return `{"ok":true,"service":"myjournalplus-gemini-backend"}`.

### Required Render environment variables

- `GEMINI_API_KEY`: the Gemini key from Google AI Studio. This is the only place the Gemini key should live.
- `GEMINI_MODEL`: model identifier enabled for your key/project. Default in this package is `gemini-2.5-flash`; change this variable if Google no longer offers it to your project.
- `FIREBASE_PROJECT_ID`: `myjournal-plus`.
- `FIREBASE_CLIENT_EMAIL`: `client_email` from a Firebase service-account JSON key.
- `FIREBASE_PRIVATE_KEY`: `private_key` from that JSON. In Render, paste the full private key; if storing it with literal `\n`, the server converts those to newlines.
- `FRONTEND_ORIGINS`: `https://myjournalplus.com,https://www.myjournalplus.com` (add any other exact production origin you use, comma-separated).

To get Firebase Admin credentials, open Firebase Console → Project settings → Service accounts and generate a private key. Copy only the `project_id`, `client_email`, and `private_key` values into the corresponding Render variables. Never commit the JSON file or these values to GitHub. Use a dedicated service account with only the access needed for Firebase Auth token verification and reading user premium flags.

## 2. Put the backend URL in the existing Admin Dashboard

After Render deploys, copy the service's base URL, then add `/api/ai-insights` to it. Example:

`https://myjournalplus-gemini-backend.onrender.com/api/ai-insights`

Open `https://myjournalplus.com/icons/admin.html`, sign in as an admin, open **AI Insights config**, paste the full HTTPS URL into **Backend AI URL**, then click **Save AI config**. Do not put the Gemini API key in that page.

The updated `frontend-patch/ai-insights.js` reads `config/ai.backendUrl` from Firestore and sends the signed-in user's Firebase ID token to that endpoint. Replace the live `ai-insights.js` with this file. The admin page patches remove the old local-browser API key controls and make the URL field clear:

- `frontend-patch/ai-insights.js` → replace website root `ai-insights.js`.
- `frontend-patch/icons-admin.html` → replace website `icons/admin.html`.
- `frontend-patch/icons-admin.js` → replace website `icons/admin.js`.

Keep the original `icons/` folder structure. Commit and deploy these frontend files to GitHub Pages.

## 3. Firestore read permission for the backend URL

The AI Insights page needs to read `config/ai.backendUrl`; ordinary signed-in users should not be allowed to write that configuration. Merge a rule equivalent to this into your existing Firestore rules (do not replace unrelated rules):

```text
match /config/ai {
  allow read: if request.auth != null;
  allow write: if request.auth != null && (
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('roles', []).hasAny(['admin']) ||
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('isAdmin', false) == true
  );
}
```

If your current admin role is stored differently, adapt the write condition to match the existing admin authorization logic. Never allow all users to write `config/ai`.

## 4. Test

1. `GET https://YOUR-SERVICE.onrender.com/health` should return `ok: true`.
2. Paste `https://YOUR-SERVICE.onrender.com/api/ai-insights` in the Admin Dashboard and save.
3. Sign in with a Premium MyJournal+ account and send a message / generate insights.
4. If it fails, check Render logs for the HTTP status. Common causes are a wrong Gemini key, an unavailable model name, missing Firebase Admin variables, missing Firestore read permission for `config/ai`, or a user record without `isPremium: true`.

## Notes

- The service deliberately returns 401 for missing/invalid Firebase ID tokens and 403 for accounts without `isPremium: true`.
- Do not set `GEMINI_API_KEY` in GitHub Pages, HTML, `ai-insights.js`, browser localStorage, or Firestore.
- Google API availability and model access depend on the Google AI project associated with your key.
