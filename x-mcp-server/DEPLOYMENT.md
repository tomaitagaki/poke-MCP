# Deployment Guide - X MCP Server

## Table of Contents
1. [Render.com Deployment](#rendercom-deployment)
2. [Docker Deployment](#docker-deployment)
3. [Local Development](#local-development)
4. [Testing with Claude Desktop](#testing-with-claude-desktop)
5. [Troubleshooting](#troubleshooting)

---

## Render.com Deployment

### Method 1: Using render.yaml (Recommended)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Add X MCP Server"
   git push origin main
   ```

2. **Connect to Render**
   - Go to https://dashboard.render.com
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml`

3. **Configure Environment Variables**
   The following environment variables will be requested:
   - `X_API_KEY`
   - `X_API_SECRET`
   - `X_ACCESS_TOKEN`
   - `X_ACCESS_TOKEN_SECRET`

4. **Deploy**
   - Click "Apply"
   - Render will build and deploy automatically

### Method 2: Manual Web Service

1. **Create Web Service**
   - Dashboard → "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Build Settings**
   - **Name**: `x-mcp-server`
   - **Environment**: Node
   - **Region**: Choose closest to you (e.g., Oregon)
   - **Branch**: `main`
   - **Root Directory**: `x-mcp-server` ⚠️ **Important for monorepo!**
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

3. **Add Environment Variables**
   Go to "Environment" tab:
   ```
   NODE_ENV=production
   X_API_KEY=<your_key>
   X_API_SECRET=<your_secret>
   X_ACCESS_TOKEN=<your_token>
   X_ACCESS_TOKEN_SECRET=<your_token_secret>
   ```

4. **Deploy**
   - Click "Create Web Service"
   - Monitor build logs for any issues

### Render.com Plans

- **Free Tier**: Available but spins down after inactivity
- **Starter ($7/mo)**: Keeps server running 24/7
- **Standard ($25/mo)**: Better performance + autoscaling

**Recommendation**: Start with Starter plan for production use.

---

## Docker Deployment

### Build and Run Locally

```bash
# Build the image
docker build -t x-mcp-server .

# Run with environment variables
docker run -d \
  --name x-mcp-server \
  -e X_API_KEY=your_key \
  -e X_API_SECRET=your_secret \
  -e X_ACCESS_TOKEN=your_token \
  -e X_ACCESS_TOKEN_SECRET=your_token_secret \
  -p 3000:3000 \
  x-mcp-server

# Check logs
docker logs x-mcp-server

# Stop container
docker stop x-mcp-server
```

### Using Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  x-mcp-server:
    build: .
    environment:
      - NODE_ENV=production
      - X_API_KEY=${X_API_KEY}
      - X_API_SECRET=${X_API_SECRET}
      - X_ACCESS_TOKEN=${X_ACCESS_TOKEN}
      - X_ACCESS_TOKEN_SECRET=${X_ACCESS_TOKEN_SECRET}
    ports:
      - "3000:3000"
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d
```

### Deploy to Docker Hub

```bash
# Tag your image
docker tag x-mcp-server yourusername/x-mcp-server:latest

# Push to Docker Hub
docker push yourusername/x-mcp-server:latest

# Pull and run on any server
docker pull yourusername/x-mcp-server:latest
docker run -d --env-file .env yourusername/x-mcp-server:latest
```

---

## Local Development

### Initial Setup

```bash
cd x-mcp-server
npm install
cp .env.example .env
# Edit .env with your credentials
```

### Development Workflow

```bash
# Build TypeScript
npm run build

# Run the server
npm start

# Development with auto-rebuild
npm run watch
# In another terminal:
npm start
```

### Environment Configuration

Edit `.env`:
```env
X_API_KEY=your_api_key_here
X_API_SECRET=your_api_secret_here
X_ACCESS_TOKEN=your_access_token_here
X_ACCESS_TOKEN_SECRET=your_access_token_secret_here
NODE_ENV=development
```

---

## Testing with Claude Desktop

### Configure Claude Desktop

1. **Locate config file**:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. **Add MCP server configuration**:

```json
{
  "mcpServers": {
    "x-api": {
      "command": "node",
      "args": ["/absolute/path/to/x-mcp-server/dist/index.js"],
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

3. **Restart Claude Desktop**

4. **Test the connection**:
   - Open Claude Desktop
   - In chat, ask: "Can you post a test tweet?"
   - Claude should show available MCP tools including your X server

### Test Commands

Try these prompts in Claude Desktop:

```
"Post a tweet saying 'Testing my MCP server!'"
"Show me my latest 5 bookmarks"
"Search for tweets about 'MCP protocol'"
"Like the tweet with ID 1234567890"
```

---

## Troubleshooting

### Build Errors

**Problem**: TypeScript compilation fails
```bash
# Clear and rebuild
rm -rf dist node_modules
npm install
npm run build
```

**Problem**: Missing dependencies
```bash
npm install --save @modelcontextprotocol/sdk twitter-api-v2 dotenv
```

### Authentication Errors

**Problem**: "Invalid credentials"
- Verify credentials in X Developer Portal
- Ensure Access Token has Read + Write permissions
- Check for extra spaces in environment variables
- Regenerate tokens if necessary

**Problem**: "403 Forbidden"
- App permissions may be incorrect
- Regenerate access token with proper scopes
- Check App's authentication settings

### Runtime Errors

**Problem**: "Connection refused" / Server won't start
```bash
# Check if port is in use
lsof -i :3000

# Check logs
npm start 2>&1 | tee server.log
```

**Problem**: "Rate limit exceeded"
- Wait 15 minutes for rate limit reset
- Check X API rate limits in developer portal
- Implement exponential backoff in client

### Deployment Issues

**Problem**: Render deployment fails
- Check build logs in Render dashboard
- Verify all environment variables are set
- Ensure `package.json` scripts are correct

**Problem**: Docker container exits immediately
```bash
# Check logs
docker logs x-mcp-server

# Run interactively for debugging
docker run -it --entrypoint /bin/sh x-mcp-server
```

### Claude Desktop Integration

**Problem**: MCP server not showing up
- Check JSON syntax in config file
- Verify absolute path to `dist/index.js`
- Restart Claude Desktop completely
- Check Claude Desktop logs

**Problem**: "Tool execution failed"
- Verify environment variables in config
- Check X API credentials are valid
- Test server independently first

### Getting Help

1. **Check logs**: Always check error messages first
2. **X API Status**: https://api.twitterstat.us/
3. **MCP Documentation**: https://modelcontextprotocol.io
4. **File an issue**: Include error logs and steps to reproduce

---

## Performance Tips

1. **Enable caching**: Consider adding Redis for API response caching
2. **Rate limit handling**: Implement exponential backoff
3. **Monitor usage**: Track API calls in X Developer Portal
4. **Upgrade plan**: If hitting rate limits frequently
5. **Health checks**: Add endpoint for monitoring

---

## Security Best Practices

1. **Never commit `.env`**: Always in `.gitignore`
2. **Rotate credentials**: Regularly regenerate API keys
3. **Use env variables**: Never hardcode credentials
4. **Restrict permissions**: Only grant necessary scopes
5. **Monitor access**: Check X Developer Portal for unusual activity
6. **HTTPS only**: Always use secure connections
7. **Validate inputs**: Sanitize user-provided data

---

## Next Steps

After successful deployment:
- [ ] Test all available tools
- [ ] Set up monitoring/alerting
- [ ] Document custom workflows
- [ ] Consider adding more endpoints
- [ ] Share your MCP server URL with Poke!
