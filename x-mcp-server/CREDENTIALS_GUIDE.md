# X API Credentials Guide

## Where to Get Your Credentials

### 1. Go to X Developer Portal
https://developer.x.com/en/portal/dashboard

### 2. Navigate to Your App
- Click your **Project** name
- Click your **App** name
- Go to the **"Keys and tokens"** tab

---

## Credentials You Need

### 🔑 **Consumer Keys** (OAuth 1.0a)

Look for the section labeled **"Consumer Keys"** or **"API Key and Secret"**:

```
API Key (also called Consumer Key)
├─ This is your X_API_KEY
└─ Example: xvz1evFS4wEEPTGEFPHBog

API Key Secret (also called Consumer Secret)
├─ This is your X_API_SECRET
└─ Example: L8qq9PZyRg6ieKGEKhZolGC0vJWLw8iEJ88DRdyOg
```

**Important:** If you don't see these, click **"Regenerate"** to create new keys.

---

### 🎫 **Authentication Tokens** (OAuth 1.0a)

Look for **"Authentication Tokens"** or **"Access Token and Secret"**:

```
Access Token
├─ This is your X_ACCESS_TOKEN
└─ Example: 123456789-Abc1234567890DefGhijk...

Access Token Secret
├─ This is your X_ACCESS_TOKEN_SECRET
└─ Example: abc123def456ghi789jkl012mno345...
```

**Important Steps:**
1. If you don't see tokens, click **"Generate"**
2. **CRITICAL:** Make sure to set permissions to **"Read and Write"** before generating!
3. Copy both immediately - you can't see the secret again!

---

## How to Set Permissions

**Before generating Access Tokens:**

1. Go to your App settings
2. Find **"User authentication settings"**
3. Click **"Set up"** or **"Edit"**
4. Under **"App permissions"**, select:
   - ✅ **Read and Write** (required for posting tweets)
   - Or ✅ **Read and Write and Direct Messages** (if you want DM access)
5. Save settings
6. **Then** generate your Access Token and Secret

⚠️ **If you already generated tokens with wrong permissions:**
- Delete the old tokens
- Update permissions to "Read and Write"
- Generate new tokens

---

## Mapping to .env File

Here's exactly how credentials map to your `.env` file:

| X Developer Portal | Your .env File |
|-------------------|----------------|
| **API Key** | `X_API_KEY=` |
| **API Key Secret** | `X_API_SECRET=` |
| **Access Token** | `X_ACCESS_TOKEN=` |
| **Access Token Secret** | `X_ACCESS_TOKEN_SECRET=` |

---

## Complete .env Example

```bash
# Copy these from "Consumer Keys" section
X_API_KEY=xvz1evFS4wEEPTGEFPHBog
X_API_SECRET=L8qq9PZyRg6ieKGEKhZolGC0vJWLw8iEJ88DRdyOg

# Copy these from "Authentication Tokens" section
X_ACCESS_TOKEN=123456789-Abc1234567890DefGhijklMnopQrstuVwxyz
X_ACCESS_TOKEN_SECRET=abc123def456ghi789jkl012mno345pqr678stu901

# Server config (leave as-is for local dev)
PORT=3000
NODE_ENV=development
```

---

## Testing Your Credentials

After adding credentials to `.env`:

```bash
cd x-mcp-server
npm run build
npm start
```

If you see:
```
X MCP Server running on stdio
```
✅ Success! Your credentials are working.

If you see authentication errors:
❌ Check:
- Credentials are copied exactly (no extra spaces)
- Access Token has "Read and Write" permissions
- API Key and Secret match the same app

---

## For Render.com Deployment

Instead of a `.env` file, add these as **Environment Variables** in Render dashboard:

1. Go to your service on Render
2. Click **"Environment"** tab
3. Add each variable:
   - Key: `X_API_KEY` → Value: (paste your API Key)
   - Key: `X_API_SECRET` → Value: (paste your API Key Secret)
   - Key: `X_ACCESS_TOKEN` → Value: (paste your Access Token)
   - Key: `X_ACCESS_TOKEN_SECRET` → Value: (paste your Access Token Secret)
   - Key: `NODE_ENV` → Value: `production`
4. Click **"Save Changes"**
5. Render will automatically redeploy

---

## Security Notes

🔒 **Important:**
- Never commit `.env` file to git (it's in `.gitignore`)
- Never share these credentials publicly
- Regenerate credentials if you suspect they're compromised
- Each developer should have their own credentials for local testing

---

## Troubleshooting

### "Invalid credentials" error
- Double-check you copied the entire key/token (no truncation)
- Verify no extra spaces before/after values

### "403 Forbidden" error
- Your Access Token doesn't have "Read and Write" permissions
- Regenerate tokens with correct permissions

### "Could not authenticate you" error
- API Key and Secret don't match the Access Token
- Make sure all 4 credentials are from the same app

### "Rate limit exceeded" error
- You're making too many requests
- Wait 15 minutes and try again
- Check rate limits: https://developer.x.com/en/docs/twitter-api/rate-limits

---

## Need Help?

- X API Support: https://developer.x.com/en/support
- Check API status: https://api.twitterstat.us/
- Read the docs: https://developer.x.com/en/docs/x-api
