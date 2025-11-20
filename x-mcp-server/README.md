# X (Twitter) MCP Server

A Model Context Protocol (MCP) server for X (formerly Twitter) API integration with AI-powered bookmark categorization.

## Requirements

Before you start, you'll need:

1. **X Developer Account & App** - https://developer.x.com
2. **Anthropic API Key** (optional, for AI categorization) - https://console.anthropic.com

## Quick Start

### 1. Get X API Credentials

1. Go to [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Create a new Project and App
3. Go to **App Settings** > **User authentication settings**
4. Enable **OAuth 2.0** with these settings:
   - **Type of App**: Web App
   - **Callback URL**: `http://localhost:3000/callback`
   - **Website URL**: Any valid URL
5. Save and copy your **Client ID** and **Client Secret**

**Required OAuth 2.0 Scopes** (enabled by default):
- `tweet.read`, `tweet.write`
- `users.read`
- `bookmark.read`, `bookmark.write`
- `like.read`, `like.write`
- `offline.access` (for token refresh)

### 2. Install & Configure

```bash
# Clone and install
git clone <repo-url>
cd x-mcp-server
npm install

# Create environment file
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required - X OAuth 2.0 credentials
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret
CALLBACK_URL=http://localhost:3000/callback

# Optional - For AI bookmark categorization
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### 3. Build & Run

```bash
npm run build
npm start
```

### 4. Authenticate with X

1. Open http://localhost:3000/authorize in your browser
2. Sign in to X and authorize the app
3. Tokens are saved automatically to `.tokens.json`

You're ready to use the MCP server!

## Available Tools

### Tweets
- `post_tweet` - Post tweets and replies
- `get_tweet` - Get tweet details
- `search_tweets` - Search tweets

### Bookmarks
- `get_bookmarks` - Get saved bookmarks
- `add_bookmark` / `remove_bookmark` - Manage bookmarks
- `get_uncategorized_bookmarks` - Get unprocessed bookmarks
- `categorize_bookmark` - AI categorization with Claude
- `mark_bookmarks_categorized` - Mark as processed
- `reset_categorized_bookmarks` - Reset tracking

### Timeline & Engagement
- `get_home_timeline` - Home feed
- `get_user_tweets` - User timeline
- `like_tweet` / `unlike_tweet`
- `retweet` / `unretweet`

## AI Bookmark Categorization

The `categorize_bookmark` tool uses Claude to analyze bookmarks and extract:

- **Topic tags** - 3-7 relevant categories
- **Actionable todos** - Tasks with priorities
- **Metadata** - Content type, key concepts, entities, urgency

**Example:**
```json
{
  "name": "categorize_bookmark",
  "arguments": {
    "tweet_id": "1234567890",
    "additional_context": "For ML project"
  }
}
```

**Workflow for batch processing:**
1. `get_uncategorized_bookmarks` - Fetch new bookmarks
2. `categorize_bookmark` - Process each one
3. `mark_bookmarks_categorized` - Mark as done

See [BOOKMARK_CATEGORIZATION.md](./BOOKMARK_CATEGORIZATION.md) for detailed documentation.

## Deployment

### Render.com

1. Push to GitHub
2. Create Web Service on Render
3. Set **Root Directory**: `x-mcp-server`
4. **Build Command**: `npm install && npm run build`
5. **Start Command**: `npm start`
6. Add environment variables:
   - `X_CLIENT_ID`
   - `X_CLIENT_SECRET`
   - `CALLBACK_URL` = `https://your-app.onrender.com/callback`
   - `ANTHROPIC_API_KEY` (optional)
7. Deploy, then visit `/authorize` to authenticate

### Docker

```bash
docker build -t x-mcp-server .
docker run -d \
  -e X_CLIENT_ID=your_client_id \
  -e X_CLIENT_SECRET=your_client_secret \
  -e CALLBACK_URL=http://localhost:3000/callback \
  -p 3000:3000 \
  x-mcp-server
```

## Multi-User Mode

For multiple users sharing one server instance, see [MULTI_USER_SETUP.md](./MULTI_USER_SETUP.md).

## API Rate Limits

- **Bookmarks GET**: 180 requests / 15 min
- **Bookmarks POST/DELETE**: 50 requests / 15 min
- **Timeline/Search**: Varies by endpoint and access level

## Troubleshooting

### "No OAuth 2.0 access token available"
Visit `/authorize` to authenticate.

### 403 Forbidden
- Check OAuth 2.0 is enabled in X Developer Portal
- Verify app has Read and Write permissions
- Re-authenticate at `/authorize`

### 429 Rate Limited
Wait 15 minutes or reduce request frequency.

### Callback URL mismatch
Ensure `CALLBACK_URL` exactly matches what's configured in X Developer Portal.

## Endpoints

- `GET /health` - Server status
- `GET /authorize` - Start OAuth flow
- `GET /callback` - OAuth callback
- `GET /sse` - MCP SSE connection
- `POST /message` - MCP messages
- `GET /tools` - List available tools

## License

MIT

## Resources

- [X API Docs](https://developer.x.com/en/docs/x-api)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Anthropic API](https://docs.anthropic.com)
