# X (Twitter) MCP Server

A Model Context Protocol (MCP) server for X (formerly Twitter) API integration. This server provides tools for posting tweets, managing bookmarks, interacting with timelines, and more.

## Features

- 🐦 **Post tweets** - Create new posts, replies, and threads
- 📚 **Bookmarks** - Save, retrieve, and manage your bookmarked tweets
- 📱 **Timeline** - Access your home timeline and user tweets
- ❤️ **Likes & Retweets** - Like, unlike, retweet, and unretweet posts
- 🔍 **Search** - Search for tweets using X search operators
- 📊 **Tweet Details** - Get detailed information about specific tweets

## Available Tools

### Post Management
- `post_tweet` - Post a new tweet to your account
- `get_tweet` - Get details about a specific tweet
- `search_tweets` - Search for tweets using a query

### Bookmarks
- `get_bookmarks` - Get your saved/bookmarked tweets (up to 800 most recent)
- `add_bookmark` - Add a tweet to your bookmarks
- `remove_bookmark` - Remove a tweet from your bookmarks

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
3. **Generate API credentials**:
   - API Key (Consumer Key)
   - API Secret (Consumer Secret)
   - Access Token
   - Access Token Secret

### Getting X API Credentials

1. Go to https://developer.x.com/en/portal/dashboard
2. Create a new Project and App (or use an existing one)
3. Navigate to your App settings → Keys and Tokens
4. Generate/copy:
   - API Key and Secret
   - Access Token and Secret (with Read and Write permissions)

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

4. Edit `.env` and add your X API credentials:
```env
X_API_KEY=your_api_key_here
X_API_SECRET=your_api_secret_here
X_ACCESS_TOKEN=your_access_token_here
X_ACCESS_TOKEN_SECRET=your_access_token_secret_here
```

5. Build the TypeScript code:
```bash
npm run build
```

6. Run the server:
```bash
npm start
```

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
   - `X_API_KEY` - Your X API Key
   - `X_API_SECRET` - Your X API Secret
   - `X_ACCESS_TOKEN` - Your X Access Token
   - `X_ACCESS_TOKEN_SECRET` - Your X Access Token Secret
   - `NODE_ENV` - Set to `production`

5. **Deploy**: Click "Create Web Service"

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
  -e X_API_KEY=your_key \
  -e X_API_SECRET=your_secret \
  -e X_ACCESS_TOKEN=your_token \
  -e X_ACCESS_TOKEN_SECRET=your_token_secret \
  x-mcp-server
```

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
        "X_API_KEY": "your_api_key",
        "X_API_SECRET": "your_api_secret",
        "X_ACCESS_TOKEN": "your_access_token",
        "X_ACCESS_TOKEN_SECRET": "your_access_token_secret"
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
- Verify your API credentials are correct
- Ensure your X App has Read and Write permissions
- Check that your Access Token hasn't expired

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
