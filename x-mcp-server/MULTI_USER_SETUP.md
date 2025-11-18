# Multi-User Setup Guide

This guide explains how to set up and use the X MCP Server in multi-user mode, allowing multiple users to concurrently access their X bookmarks through the same server instance.

## Overview

Multi-user mode enables:
- **Concurrent sessions**: Multiple users can connect simultaneously
- **Isolated authentication**: Each user has their own X OAuth credentials and tokens
- **API key authentication**: Secure access control using unique API keys
- **Per-user token management**: Tokens are stored separately and refreshed independently

## Architecture

### Authentication Flow
1. Each user is assigned a unique API key
2. Users authenticate MCP connections using their API key (via header or query parameter)
3. The server routes requests to the correct user's X OAuth tokens
4. Each user completes their own OAuth flow to authorize access to their X account

### User Configuration
Users are configured in a `users.json` file with:
- **userId**: Unique identifier for the user
- **apiKey**: Secure random API key for authentication
- **name**: Display name for the user
- **xClientId**: X OAuth 2.0 Client ID (from X Developer Portal)
- **xClientSecret**: X OAuth 2.0 Client Secret
- **callbackUrl**: OAuth callback URL

## Setup Instructions

### 1. Enable Multi-User Mode

Create a `.env` file from the template:

```bash
cp .env.template .env
```

Edit `.env` and set:

```env
MULTI_USER_MODE=true
PORT=3000
```

### 2. Configure Users

Create `users.json` from the example:

```bash
cp users.json.example users.json
```

Edit `users.json` and configure your users:

```json
{
  "users": [
    {
      "userId": "alice",
      "apiKey": "alice-secret-api-key-here",
      "name": "Alice",
      "xClientId": "alice_x_client_id",
      "xClientSecret": "alice_x_client_secret",
      "callbackUrl": "http://localhost:3000/callback"
    },
    {
      "userId": "bob",
      "apiKey": "bob-secret-api-key-here",
      "name": "Bob",
      "xClientId": "bob_x_client_id",
      "xClientSecret": "bob_x_client_secret",
      "callbackUrl": "http://localhost:3000/callback"
    }
  ]
}
```

**Important Security Notes:**
- Generate strong, random API keys for each user (e.g., using `openssl rand -hex 32`)
- Each user should have their own X Developer App with separate OAuth credentials
- Never commit `users.json` to version control (it's in `.gitignore`)

### 3. Set Up X Developer Apps

Each user needs their own X Developer App:

1. Go to https://developer.x.com/en/portal/dashboard
2. Create a new Project and App (or use an existing one)
3. Enable OAuth 2.0 in User authentication settings
4. Set the callback URL to `http://localhost:3000/callback` (or your production URL)
5. Copy the Client ID and Client Secret to `users.json`
6. Ensure the app has these permissions:
   - Read and Write permissions
   - OAuth 2.0 scopes: `tweet.read`, `users.read`, `bookmark.read`, `bookmark.write`, `tweet.write`, `like.read`, `like.write`, `offline.access`

### 4. Build and Start the Server

```bash
npm install
npm run build
npm start
```

The server will:
- Load all users from `users.json`
- Create separate token storage files for each user (`.tokens-{userId}.json`)
- Listen for connections on the configured port

### 5. Authorize Each User

Each user must complete OAuth authorization to connect their X account:

#### Option 1: Using API Key
```
http://localhost:3000/authorize?apiKey=alice-secret-api-key-here
```

#### Option 2: Using User ID
```
http://localhost:3000/authorize?userId=alice
```

This will:
1. Redirect to X for authorization
2. Request necessary scopes for bookmarks and tweets
3. Save OAuth tokens to `.tokens-{userId}.json`
4. Display a success page with token information

## Using the MCP Server

### Connecting from MCP Clients

When connecting to the MCP server, users must provide their API key:

#### Via HTTP Header
```
X-API-Key: alice-secret-api-key-here
```

#### Via Query Parameter
```
http://localhost:3000/sse?apiKey=alice-secret-api-key-here
```

### Claude Desktop Configuration

Example `claude_desktop_config.json` for multi-user setup:

```json
{
  "mcpServers": {
    "x-bookmarks-alice": {
      "url": "http://localhost:3000/sse?apiKey=alice-secret-api-key-here"
    },
    "x-bookmarks-bob": {
      "url": "http://localhost:3000/sse?apiKey=bob-secret-api-key-here"
    }
  }
}
```

## Monitoring and Debugging

### Health Check

Check server status and all users:

```bash
curl http://localhost:3000/health
```

Response includes:
- Server mode (multi-user)
- Total users configured
- Active sessions
- Per-user authentication status and token expiry

### Validate User Token

Check if a specific user's token is valid:

```bash
curl "http://localhost:3000/validate-token?apiKey=alice-secret-api-key-here"
```

Or using userId:

```bash
curl "http://localhost:3000/validate-token?userId=alice"
```

## File Structure

In multi-user mode, the server creates these files:

```
x-mcp-server/
├── users.json                    # User configuration (gitignored)
├── .tokens-alice.json           # Alice's OAuth tokens (gitignored)
├── .tokens-bob.json             # Bob's OAuth tokens (gitignored)
├── .oauth-state-alice.json      # Temporary OAuth state for Alice
├── .oauth-state-bob.json        # Temporary OAuth state for Bob
└── .env                          # Environment configuration (gitignored)
```

All sensitive files are excluded from version control via `.gitignore`.

## Production Deployment

### Render.com Deployment

For production deployment on Render.com with persistent tokens, you have two options:

#### Option 1: Automatic Token Persistence (Recommended)

Enable automatic environment variable updates using the Render API:

1. **Get your Render API credentials:**
   - API Key: Visit https://dashboard.render.com/u/settings#api-keys and create an API key
   - Service ID: Find it in your service URL: `https://dashboard.render.com/web/srv-xxxxx` (the `srv-xxxxx` part)

2. **Configure environment variables in Render:**
   ```
   MULTI_USER_MODE=true
   RENDER_API_KEY=rnd_your_api_key_here
   RENDER_SERVICE_ID=srv_your_service_id_here
   ```

3. **Upload `users.json`** as a secret file or configure via environment variables

4. **Authorize each user** by visiting `/authorize?apiKey=THEIR_API_KEY`
   - The server will automatically create/update the environment variable `X_OAUTH_TOKENS_{USERID}`
   - You'll see a success message: "🎉 Render Environment Variable Updated!"
   - Tokens will persist across service restarts

#### Option 2: Manual Token Configuration

If you prefer not to use the Render API or want to manually configure tokens:

1. Set environment variable `MULTI_USER_MODE=true`
2. Each user authorizes at `/authorize?apiKey=THEIR_API_KEY`
3. Copy the token JSON from the callback page
4. Manually add environment variables in Render Dashboard:
   - `X_OAUTH_TOKENS_ALICE` - Alice's token JSON
   - `X_OAUTH_TOKENS_BOB` - Bob's token JSON

5. Upload `users.json` as a secret file or configure via environment variables

### Security Considerations

1. **API Key Security**
   - Use strong, random API keys (minimum 32 characters)
   - Rotate API keys periodically
   - Never expose API keys in client-side code

2. **X OAuth Credentials**
   - Each user should have their own X Developer App
   - Keep Client IDs and Secrets secure
   - Use environment variables in production

3. **Token Storage**
   - Tokens are stored per-user in separate files
   - On Render free tier, use environment variables for persistence
   - Tokens are automatically refreshed before expiration

4. **Network Security**
   - Use HTTPS in production
   - Consider implementing rate limiting
   - Add IP allowlisting if needed

## Troubleshooting

### User Cannot Connect

**Problem**: MCP client returns authentication error

**Solutions**:
- Verify API key is correct in `users.json`
- Check API key is being sent in header or query parameter
- Ensure server is in multi-user mode (`MULTI_USER_MODE=true`)
- Check server logs for authentication errors

### OAuth Authorization Fails

**Problem**: `/authorize` endpoint returns error

**Solutions**:
- Verify X Client ID and Secret are correct
- Ensure callback URL matches X Developer App settings
- Check X Developer App has correct permissions and scopes
- Verify user has completed OAuth flow at `/authorize?apiKey=...`

### Tokens Expired

**Problem**: Requests fail with token expiration error

**Solutions**:
- Tokens should auto-refresh if refresh token is available
- Re-authorize the user at `/authorize?apiKey=...`
- Check `/health` endpoint to see token expiry status
- Verify user has `offline.access` scope (required for refresh)

### Multiple Users Same X Account

**Problem**: Want multiple users to access the same X account

**Solutions**:
- Each user still needs a unique userId and API key
- Users can share the same X Developer App credentials (xClientId, xClientSecret)
- All users complete OAuth with the same X account
- Each gets their own token file, but tokens access the same X account

## Migration from Single-User Mode

To migrate from single-user to multi-user mode:

1. Backup existing `.tokens.json` file
2. Set `MULTI_USER_MODE=true` in `.env`
3. Create `users.json` with at least one user
4. Copy contents of `.tokens.json` to `.tokens-{userId}.json`
5. Restart the server
6. Update MCP clients to include API key in connections

## API Reference

### Endpoints

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/health` | GET | No | Server health and user status |
| `/sse` | GET | Yes (API key) | MCP Server-Sent Events connection |
| `/message` | POST | Yes (session) | MCP message handling |
| `/authorize` | GET | Yes (API key or userId) | Start OAuth flow for user |
| `/callback` | GET | No | OAuth callback handler |
| `/validate-token` | GET | Yes (API key or userId) | Validate user's token |
| `/tools` | GET | No | List available MCP tools |

### Authentication Methods

**API Key Header**:
```
X-API-Key: your-api-key-here
```

**API Key Query Parameter**:
```
?apiKey=your-api-key-here
```

**User ID Query Parameter** (for authorization):
```
?userId=alice
```

## Support

For issues and questions:
- Check server logs for detailed error messages
- Verify all configuration files are correct
- Ensure X Developer App settings match your configuration
- Test with `/health` and `/validate-token` endpoints

## License

MIT
