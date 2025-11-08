# X API Credentials Guide (OAuth 2.0)

## Where to Get Your Credentials

### 1. Go to X Developer Portal
https://developer.x.com/en/portal/dashboard

### 2. Navigate to Your App
- Click your **Project** name
- Click your **App** name
- Go to the **"Keys and tokens"** tab

---

## Credentials You Need

### 🔑 **OAuth 2.0 Client ID and Secret**

Look for the section labeled **"OAuth 2.0 Client ID and Client Secret"**:

```
Client ID
├─ This is your X_CLIENT_ID
└─ Example: abc123def456ghi789jkl012mno345pqr

Client Secret
├─ This is your X_CLIENT_SECRET
└─ Example: xyz789uvw456rst123opq012nml345kji678hgf
```

**Important:** 
- If you don't see these, you need to enable OAuth 2.0 for your app
- Go to **"User authentication settings"** → **"Set up"** or **"Edit"**
- Enable **OAuth 2.0** authentication
- The Client ID and Secret will be generated automatically

---

## How to Set Permissions

**Before using OAuth 2.0:**

1. Go to your App settings
2. Find **"User authentication settings"**
3. Click **"Set up"** or **"Edit"**
4. Under **"App permissions"**, select:
   - ✅ **Read and Write** (required for posting tweets and managing bookmarks)
5. Under **"Type of App"**, select:
   - ✅ **Web App, Automated App or Bot**
6. Add your **Callback URL** (e.g., `http://localhost:3000/callback` for local dev)
7. Save settings

---

## Required Scopes

When you authorize the app, it will request these scopes:
- `bookmark.read` - Read your bookmarks
- `bookmark.write` - Add/remove bookmarks
- `tweet.write` - Post tweets
- `offline.access` - Refresh tokens automatically (required for token refresh)

---

## Mapping to .env File

Here's exactly how credentials map to your `.env` file:

| X Developer Portal | Your .env File |
|-------------------|----------------|
| **Client ID** | `X_CLIENT_ID=` |
| **Client Secret** | `X_CLIENT_SECRET=` |
| **Callback URL** | `CALLBACK_URL=` (optional, defaults to http://localhost:3000/callback) |

---

## Complete .env Example

```bash
# Copy these from "OAuth 2.0 Client ID and Client Secret" section
X_CLIENT_ID=abc123def456ghi789jkl012mno345pqr
X_CLIENT_SECRET=xyz789uvw456rst123opq012nml345kji678hgf

# Callback URL (optional for local dev)
CALLBACK_URL=http://localhost:3000/callback

# Server config (leave as-is for local dev)
PORT=3000
NODE_ENV=development
```

---

## Authentication Flow

1. **Set up your credentials** in `.env` file
2. **Start the server**: `npm start`
3. **Visit** `http://localhost:3000/authorize` in your browser
4. **Authorize the app** on X's authorization page
5. **Tokens are saved** automatically to `.tokens.json`
6. **Tokens refresh automatically** before expiration

---

## Token Storage

Tokens are stored locally in `.tokens.json`:
- Access tokens are automatically refreshed before expiration
- Refresh tokens are used to obtain new access tokens
- No need to manually manage tokens

**Security Note:** The `.tokens.json` file contains sensitive credentials. Make sure it's in your `.gitignore` file!

---

## Testing Your Credentials

After adding credentials to `.env`:

```bash
cd x-mcp-server
npm run build
npm start
```

Then visit `http://localhost:3000/authorize` to authenticate.

If you see:
```
✅ Authorization Successful!
```
✅ Success! Your credentials are working.

If you see authentication errors:
❌ Check:
- Client ID and Secret are copied exactly (no extra spaces)
- OAuth 2.0 is enabled in your app settings
- Callback URL matches your app's configured callback URL
- App permissions include "Read and Write"

---

## For Render.com Deployment

Instead of a `.env` file, add these as **Environment Variables** in Render dashboard:

1. Go to your service on Render
2. Click **"Environment"** tab
3. Add each variable:
   - Key: `X_CLIENT_ID` → Value: (paste your Client ID)
   - Key: `X_CLIENT_SECRET` → Value: (paste your Client Secret)
   - Key: `CALLBACK_URL` → Value: `https://your-app-name.onrender.com/callback`
   - Key: `NODE_ENV` → Value: `production`
4. Click **"Save Changes"**
5. Render will automatically redeploy
6. Visit `https://your-app-name.onrender.com/authorize` to authenticate

**Note:** After authentication, tokens are stored in `.tokens.json` on the server's filesystem. On Render's free tier, this file may be lost when the service spins down. Consider using a persistent storage solution for production.

---

## Security Notes

🔒 **Important:**
- Never commit `.env` or `.tokens.json` files to git (they're in `.gitignore`)
- Never share these credentials publicly
- Regenerate credentials if you suspect they're compromised
- Each developer should have their own credentials for local testing
- Client Secret should be kept secure and never exposed in client-side code

---

## Troubleshooting

### "Invalid credentials" error
- Double-check you copied the entire Client ID/Secret (no truncation)
- Verify no extra spaces before/after values
- Ensure OAuth 2.0 is enabled in your app settings

### "403 Forbidden" error
- Your app may not have the correct permissions
- Check that "Read and Write" permissions are set
- Verify the callback URL matches your app's configured callback URL

### "Could not authenticate you" error
- Client ID and Secret don't match
- Make sure all credentials are from the same app
- Verify OAuth 2.0 is enabled for your app

### "Rate limit exceeded" error
- You're making too many requests
- Wait 15 minutes and try again
- Check rate limits: https://developer.x.com/en/docs/twitter-api/rate-limits

### Token refresh fails
- Visit `/authorize` again to re-authenticate
- Check that `offline.access` scope was granted
- Verify refresh token is still valid

---

## Need Help?

- X API Support: https://developer.x.com/en/support
- Check API status: https://api.twitterstat.us/
- Read the docs: https://developer.x.com/en/docs/x-api
- OAuth 2.0 Guide: https://developer.x.com/en/docs/authentication/oauth-2-0
