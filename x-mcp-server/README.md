# X (Twitter) MCP Server

A Model Context Protocol (MCP) server for X (formerly Twitter) API integration. This server provides tools for posting tweets, managing bookmarks, interacting with timelines, and more.

## Features

- 🐦 **Post tweets** - Create new posts, replies, and threads
- 📚 **Bookmarks** - Save, retrieve, and manage your bookmarked tweets
- 📱 **Timeline** - Access your home timeline and user tweets
- ❤️ **Likes & Retweets** - Like, unlike, retweet, and unretweet posts
- 🔍 **Search** - Search for tweets using X search operators
- 📊 **Tweet Details** - Get detailed information about specific tweets
- 👥 **Multi-User Support** - Concurrent access for multiple users with API key authentication

## Multi-User Mode

This server supports **multi-user mode**, allowing multiple users to concurrently access their X bookmarks through the same server instance. Each user:
- Has their own API key for secure authentication
- Uses their own X OAuth credentials
- Gets isolated token storage and management
- Can connect simultaneously without conflicts

**📖 See [MULTI_USER_SETUP.md](./MULTI_USER_SETUP.md) for detailed setup instructions.**

Quick multi-user setup:
1. Set `MULTI_USER_MODE=true` in `.env`
2. Create `users.json` from `users.json.example`
3. Configure each user with unique API keys and X OAuth credentials
4. Each user authorizes at `/authorize?apiKey=THEIR_API_KEY`
5. Connect with API key via header or query parameter

## Available Tools

### Post Management
- `post_tweet` - Post a new tweet to your account
- `get_tweet` - Get details about a specific tweet
- `search_tweets` - Search for tweets using a query

### Bookmarks
- `get_bookmarks` - Get your saved/bookmarked tweets (up to 800 most recent)
- `add_bookmark` - Add a tweet to your bookmarks
- `remove_bookmark` - Remove a tweet from your bookmarks
- `get_uncategorized_bookmarks` - Get only bookmarks that haven't been categorized yet (for AI processing workflows)
- `mark_bookmarks_categorized` - Mark bookmarks as categorized after processing
- `reset_categorized_bookmarks` - Clear all categorization tracking to start fresh

### Timeline
- `get_home_timeline` - Get tweets from accounts you follow
- `get_user_tweets` - Get tweets from your own timeline or another user

### Engagement
- `like_tweet` - Like a tweet
- `unlike_tweet` - Unlike a tweet
- `retweet` - Retweet a tweet
- `unretweet` - Remove a retweet

## Setup

### Prerequisites

1. **X Developer Account** - Sign up at https://developer.x.com
2. **Create an X App** in the Developer Portal
3. **Enable OAuth 2.0** and generate credentials:
   - Client ID
   - Client Secret

### Getting X API Credentials

1. Go to https://developer.x.com/en/portal/dashboard
2. Create a new Project and App (or use an existing one)
3. Navigate to your App settings → Keys and Tokens
4. Enable OAuth 2.0 in User authentication settings
5. Copy:
   - Client ID (X_CLIENT_ID)
   - Client Secret (X_CLIENT_SECRET)
6. Set callback URL: `http://localhost:3000/callback` (for local dev)

### Installation

1. Clone this repository:
```bash
git clone <your-repo-url>
cd x-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file from the example:
```bash
cp .env.example .env
```

4. Edit `.env` and add your X OAuth 2.0 credentials:
```env
X_CLIENT_ID=your_client_id_here
X_CLIENT_SECRET=your_client_secret_here
CALLBACK_URL=http://localhost:3000/callback
```

5. Build the TypeScript code:
```bash
npm run build
```

6. Run the server:
```bash
npm start
```

7. **Authenticate**: Visit `http://localhost:3000/authorize` in your browser to authorize the app. Tokens will be saved automatically to `.tokens.json`.

## Deployment on Render.com

### Quick Deploy

1. **Fork/Push this repository to GitHub**

2. **Create a new Web Service on Render**:
   - Go to https://render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the `x-mcp-server` directory

3. **Configure the service**:
   - **Name**: `x-mcp-server` (or your preferred name)
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free or Starter

4. **Add Environment Variables**:
   Go to Environment tab and add:
   - `X_CLIENT_ID` - Your X OAuth 2.0 Client ID
   - `X_CLIENT_SECRET` - Your X OAuth 2.0 Client Secret
   - `CALLBACK_URL` - Your callback URL (e.g., `https://your-app.onrender.com/callback`)
   - `NODE_ENV` - Set to `production`

5. **Deploy**: Click "Create Web Service"

6. **Authenticate**: After deployment, visit `https://your-app.onrender.com/authorize` to authorize the app

### Using render.yaml (Infrastructure as Code)

This repo includes a `render.yaml` at the root for automated deployment:

```bash
# From the repo root, deploy using Render
# Render will auto-detect render.yaml and use rootDir: x-mcp-server
```

The `render.yaml` is located at `/render.yaml` (repo root) and points to this subdirectory using `rootDir: x-mcp-server`.

### Docker Deployment

You can also deploy using Docker:

```bash
# Build the image
docker build -t x-mcp-server .

# Run the container
docker run -d \
  -e X_CLIENT_ID=your_client_id \
  -e X_CLIENT_SECRET=your_client_secret \
  -e CALLBACK_URL=http://localhost:3000/callback \
  -p 3000:3000 \
  x-mcp-server
```

## Bookmark Categorization Workflow

The server includes a bookmark categorization system designed for AI agents to periodically process new bookmarks:

1. **Poll for uncategorized bookmarks**: Your AI agent calls `get_uncategorized_bookmarks` to fetch only new bookmarks that haven't been processed
2. **Process bookmarks**: The AI categorizes/organizes/processes the bookmarks (e.g., extract key points, tag topics, save to database)
3. **Mark as processed**: Call `mark_bookmarks_categorized` with the tweet IDs to mark them as categorized
4. **Repeat**: On the next poll, those bookmarks won't appear again

**Example workflow:**
```json
// Step 1: Get uncategorized bookmarks
{
  "name": "get_uncategorized_bookmarks",
  "arguments": { "max_results": 50 }
}
// Returns: { uncategorized_bookmarks: [...], uncategorized_count: 12 }

// Step 2: Process them (your AI logic here)

// Step 3: Mark them as categorized
{
  "name": "mark_bookmarks_categorized",
  "arguments": {
    "tweet_ids": ["1234567890", "0987654321"]
  }
}
// Returns: { success: true, newly_marked: 2, total_categorized: 142 }
```

**Storage**: Categorization tracking is stored in `.categorized-bookmarks.json` (or per-user files in multi-user mode) and persists across server restarts.

## Usage Examples

### Connecting to Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "x-api": {
      "command": "node",
      "args": ["/path/to/x-mcp-server/dist/index.js"],
      "env": {
        "X_CLIENT_ID": "your_client_id",
        "X_CLIENT_SECRET": "your_client_secret",
        "CALLBACK_URL": "http://localhost:3000/callback"
      }
    }
  }
}
```

### Example Tool Calls

**Post a tweet:**
```json
{
  "name": "post_tweet",
  "arguments": {
    "text": "Hello from my MCP server! 🚀"
  }
}
```

**Get your bookmarks:**
```json
{
  "name": "get_bookmarks",
  "arguments": {
    "max_results": 20
  }
}
```

**Search tweets:**
```json
{
  "name": "search_tweets",
  "arguments": {
    "query": "MCP server",
    "max_results": 10
  }
}
```

**Reply to a tweet:**
```json
{
  "name": "post_tweet",
  "arguments": {
    "text": "Great point!",
    "reply_to_tweet_id": "1234567890"
  }
}
```

## API Rate Limits

Be aware of X API rate limits:
- **Bookmarks GET**: 180 requests per 15 minutes
- **Bookmarks POST/DELETE**: 50 requests per 15 minutes
- **Timeline**: Varies by endpoint
- **Search**: Varies by access level

## Development

### Build
```bash
npm run build
```

### Watch mode
```bash
npm run watch
```

### Run locally
```bash
npm run dev
```

## Architecture

This MCP server uses:
- **@modelcontextprotocol/sdk** - MCP protocol implementation
- **twitter-api-v2** - X API v2 client library
- **TypeScript** - Type-safe development
- **Stdio Transport** - Communication with MCP clients

## Troubleshooting

### Authentication Errors
- Verify your OAuth 2.0 Client ID and Secret are correct
- Ensure your X App has OAuth 2.0 enabled
- Check that your app has Read and Write permissions
- Visit `/authorize` endpoint to authenticate if tokens are missing
- Verify callback URL matches your app's configured callback URL

### Rate Limit Errors
- Implement exponential backoff in your client
- Monitor your usage in the X Developer Portal
- Consider upgrading your API access level

### Connection Issues
- Verify the server is running: `npm start`
- Check environment variables are set correctly
- Review logs for detailed error messages

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT

## Resources

- [X API Documentation](https://developer.x.com/en/docs/x-api)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [twitter-api-v2 Library](https://github.com/PLhery/node-twitter-api-v2)
