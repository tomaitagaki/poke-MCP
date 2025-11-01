# poke-MCP

Toma's personal MCP (Model Context Protocol) server stack - a collection of lightweight MCP servers for various platform integrations, deployable on services like Render.com.

## Available Servers

### 🐦 X (Twitter) MCP Server
Full-featured X API integration with support for:
- Posting tweets and replies
- Managing bookmarks (save, retrieve, delete)
- Timeline access (home, user)
- Engagement (likes, retweets)
- Tweet search and lookup

[→ View X MCP Server Documentation](./x-mcp-server/README.md)

## Architecture

Each MCP server in this stack is:
- **Self-contained** - Independent TypeScript projects
- **Lightweight** - Minimal dependencies, optimized for serverless
- **Secure** - Environment-based credential management
- **Deployable** - Ready for Render.com, Docker, or local usage

## Quick Start

Each server directory contains its own README with detailed setup instructions. General pattern:

```bash
cd <server-name>
npm install
cp .env.example .env
# Edit .env with your credentials
npm run build
npm start
```

## Deployment

All servers include:
- `Dockerfile` - Container deployment
- `.env.example` - Environment template

The repo includes a `render.yaml` at the root for automatic Blueprint deployment.

### Deploy to Render.com (Auto)
1. Push this repo to GitHub
2. Go to Render.com → New + → Blueprint
3. Connect your GitHub repo
4. Render will detect `render.yaml` automatically
5. Add environment variables when prompted
6. Deploy!

### Deploy to Render.com (Manual)
1. Push this repo to GitHub
2. New + → Web Service → Connect repo
3. **Root Directory**: Set to `x-mcp-server` (or whichever server)
4. **Build Command**: `npm install && npm run build`
5. **Start Command**: `npm start`
6. Add environment variables
7. Deploy

## Roadmap

Future MCP servers to add:
- GitHub API integration
- Reddit API integration
- Discord bot integration
- Notion API integration
- Google Calendar/Drive integration

## Contributing

Feel free to add new MCP servers to this stack! Each server should:
1. Be in its own directory
2. Include comprehensive README
3. Have deployment configs (render.yaml, Dockerfile)
4. Use environment variables for credentials
5. Follow TypeScript best practices

## Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Render.com Documentation](https://render.com/docs)
