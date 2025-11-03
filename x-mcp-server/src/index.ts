#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { TwitterApi, ApiResponseError } from 'twitter-api-v2';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

dotenv.config();

// OAuth 2.0 token storage (persisted via environment variables)
interface TokenStore {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  expiresAt?: number; // Timestamp when token expires
}

// Initialize token store from environment variables if available
const tokenStore: TokenStore = {
  accessToken: process.env.OAUTH2_ACCESS_TOKEN,
  refreshToken: process.env.OAUTH2_REFRESH_TOKEN,
  expiresIn: process.env.OAUTH2_EXPIRES_IN ? parseInt(process.env.OAUTH2_EXPIRES_IN) : undefined,
  tokenType: process.env.OAUTH2_TOKEN_TYPE || 'Bearer',
  expiresAt: process.env.OAUTH2_EXPIRES_AT ? parseInt(process.env.OAUTH2_EXPIRES_AT) : undefined,
};

// Check if tokens are loaded from env
if (tokenStore.accessToken && tokenStore.refreshToken) {
  console.error('[AUTH] ✅ OAuth 2.0 tokens loaded from environment variables');
  console.error('[AUTH] Token expires at:', tokenStore.expiresAt ? new Date(tokenStore.expiresAt).toISOString() : 'unknown');
} else {
  console.error('[AUTH] ⚠️  No OAuth 2.0 tokens found. Visit /authorize to authenticate.');
}

// OAuth 2.0 client for authorization flow
const oauth2Client = new TwitterApi({
  clientId: process.env.X_CLIENT_ID || '',
  clientSecret: process.env.X_CLIENT_SECRET || '',
});

// Function to refresh OAuth 2.0 access token if expired
async function refreshAccessTokenIfNeeded(): Promise<void> {
  if (!tokenStore.refreshToken) {
    return;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = Date.now();
  const expiresAt = tokenStore.expiresAt || 0;
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt > now + fiveMinutes) {
    // Token is still valid
    return;
  }

  try {
    console.error('[AUTH] 🔄 Access token expired or expiring soon, refreshing...');

    const {
      client: refreshedClient,
      accessToken,
      refreshToken,
      expiresIn,
    } = await oauth2Client.refreshOAuth2Token(tokenStore.refreshToken);

    // Update token store
    tokenStore.accessToken = accessToken;
    tokenStore.refreshToken = refreshToken || tokenStore.refreshToken;
    tokenStore.expiresIn = expiresIn;
    tokenStore.expiresAt = Date.now() + (expiresIn * 1000);

    console.error('[AUTH] ✅ Token refreshed successfully!');
    console.error('[AUTH] New token expires at:', new Date(tokenStore.expiresAt).toISOString());
    console.error('[AUTH] 📋 Copy these to your Render environment variables:');
    console.error(`OAUTH2_ACCESS_TOKEN=${accessToken}`);
    console.error(`OAUTH2_REFRESH_TOKEN=${tokenStore.refreshToken}`);
    console.error(`OAUTH2_EXPIRES_IN=${expiresIn}`);
    console.error(`OAUTH2_EXPIRES_AT=${tokenStore.expiresAt}`);
  } catch (error: any) {
    console.error('[AUTH] ❌ Failed to refresh token:', error.message);
    console.error('[AUTH] You may need to re-authorize at /authorize');
  }
}

// Function to get Twitter client (will use OAuth 2.0 if available, fallback to OAuth 1.0a)
async function getTwitterClient(): Promise<TwitterApi> {
  // Try to refresh token if needed
  await refreshAccessTokenIfNeeded();

  if (tokenStore.accessToken) {
    console.error('[AUTH] Using OAuth 2.0 token');
    return new TwitterApi(tokenStore.accessToken);
  }

  // Fallback to OAuth 1.0a if no OAuth 2.0 token
  console.error('[AUTH] Falling back to OAuth 1.0a');
  return new TwitterApi({
    appKey: process.env.X_API_KEY || '',
    appSecret: process.env.X_API_SECRET || '',
    accessToken: process.env.X_ACCESS_TOKEN || '',
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
  });
}

// Initialize rwClient (will be set by getTwitterClient() when needed)
let rwClient: any;

// Define available tools
const TOOLS: Tool[] = [
  {
    name: 'post_tweet',
    description: 'Post a new tweet to your X account. Can include text, reply to another tweet, or create a thread.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content of the tweet (max 280 characters)',
        },
        reply_to_tweet_id: {
          type: 'string',
          description: 'Optional: ID of the tweet to reply to',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_bookmarks',
    description: 'Get your saved/bookmarked tweets. Returns up to 100 bookmarks per request with pagination support.',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: {
          type: 'number',
          description: 'Maximum number of bookmarks to return (5-100, default 10)',
          default: 10,
        },
        pagination_token: {
          type: 'string',
          description: 'Optional: Token for pagination to get next set of results',
        },
      },
    },
  },
  {
    name: 'add_bookmark',
    description: 'Add a tweet to your bookmarks/saved list',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to bookmark',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'remove_bookmark',
    description: 'Remove a tweet from your bookmarks',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to remove from bookmarks',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'get_home_timeline',
    description: 'Get tweets from your home timeline (tweets from accounts you follow)',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: {
          type: 'number',
          description: 'Maximum number of tweets to return (5-100, default 10)',
          default: 10,
        },
        pagination_token: {
          type: 'string',
          description: 'Optional: Token for pagination',
        },
      },
    },
  },
  {
    name: 'get_user_tweets',
    description: 'Get tweets from your own timeline or another user',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Optional: User ID to get tweets from (defaults to authenticated user)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of tweets to return (5-100, default 10)',
          default: 10,
        },
        pagination_token: {
          type: 'string',
          description: 'Optional: Token for pagination',
        },
      },
    },
  },
  {
    name: 'like_tweet',
    description: 'Like a tweet',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to like',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'unlike_tweet',
    description: 'Unlike a tweet',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to unlike',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'retweet',
    description: 'Retweet a tweet',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to retweet',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'unretweet',
    description: 'Remove a retweet',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to unretweet',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'get_tweet',
    description: 'Get details about a specific tweet',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to retrieve',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'search_tweets',
    description: 'Search for tweets using a query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports X search operators)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of tweets to return (10-100, default 10)',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: 'x-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    // Refresh client to use latest OAuth 2.0 token if available
    const client = await getTwitterClient();
    rwClient = client.readWrite;

    const { name, arguments: args } = request.params;

    switch (name) {
      case 'post_tweet': {
        const { text, reply_to_tweet_id } = args as {
          text: string;
          reply_to_tweet_id?: string;
        };

        const tweetData: any = { text };
        if (reply_to_tweet_id) {
          tweetData.reply = { in_reply_to_tweet_id: reply_to_tweet_id };
        }

        const tweet = await rwClient.v2.tweet(tweetData);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                tweet_id: tweet.data.id,
                text: tweet.data.text,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_bookmarks': {
        const { max_results = 10, pagination_token } = args as {
          max_results?: number;
          pagination_token?: string;
        };

        const me = await rwClient.v2.me();
        const bookmarks = await rwClient.v2.bookmarks({
          max_results: Math.min(Math.max(max_results, 5), 100),
          pagination_token,
          'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                bookmarks: bookmarks.data.data || [],
                meta: bookmarks.data.meta,
              }, null, 2),
            },
          ],
        };
      }

      case 'add_bookmark': {
        const { tweet_id } = args as { tweet_id: string };
        const result = await rwClient.v2.bookmark(tweet_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                bookmarked: result.data.bookmarked,
              }, null, 2),
            },
          ],
        };
      }

      case 'remove_bookmark': {
        const { tweet_id } = args as { tweet_id: string };
        const result = await rwClient.v2.deleteBookmark(tweet_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                bookmarked: result.data.bookmarked,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_home_timeline': {
        const { max_results = 10, pagination_token } = args as {
          max_results?: number;
          pagination_token?: string;
        };

        const me = await rwClient.v2.me();
        const timeline = await rwClient.v2.userTimeline(me.data.id, {
          max_results: Math.min(Math.max(max_results, 5), 100),
          pagination_token,
          'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tweets: timeline.data.data || [],
                meta: timeline.data.meta,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_user_tweets': {
        const { user_id, max_results = 10, pagination_token } = args as {
          user_id?: string;
          max_results?: number;
          pagination_token?: string;
        };

        const userId = user_id || (await rwClient.v2.me()).data.id;
        const tweets = await rwClient.v2.userTimeline(userId, {
          max_results: Math.min(Math.max(max_results, 5), 100),
          pagination_token,
          'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tweets: tweets.data.data || [],
                meta: tweets.data.meta,
              }, null, 2),
            },
          ],
        };
      }

      case 'like_tweet': {
        const { tweet_id } = args as { tweet_id: string };
        const me = await rwClient.v2.me();
        const result = await rwClient.v2.like(me.data.id, tweet_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                liked: result.data.liked,
              }, null, 2),
            },
          ],
        };
      }

      case 'unlike_tweet': {
        const { tweet_id } = args as { tweet_id: string };
        const me = await rwClient.v2.me();
        const result = await rwClient.v2.unlike(me.data.id, tweet_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                liked: result.data.liked,
              }, null, 2),
            },
          ],
        };
      }

      case 'retweet': {
        const { tweet_id } = args as { tweet_id: string };
        const me = await rwClient.v2.me();
        const result = await rwClient.v2.retweet(me.data.id, tweet_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                retweeted: result.data.retweeted,
              }, null, 2),
            },
          ],
        };
      }

      case 'unretweet': {
        const { tweet_id } = args as { tweet_id: string };
        const me = await rwClient.v2.me();
        const result = await rwClient.v2.unretweet(me.data.id, tweet_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                retweeted: result.data.retweeted,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_tweet': {
        const { tweet_id } = args as { tweet_id: string };
        const tweet = await rwClient.v2.singleTweet(tweet_id, {
          'tweet.fields': ['created_at', 'author_id', 'public_metrics', 'conversation_id'],
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tweet.data, null, 2),
            },
          ],
        };
      }

      case 'search_tweets': {
        const { query, max_results = 10 } = args as {
          query: string;
          max_results?: number;
        };

        const results = await rwClient.v2.search(query, {
          max_results: Math.min(Math.max(max_results, 10), 100),
          'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tweets: results.data.data || [],
                meta: results.data.meta,
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error: any) {
    if (error instanceof ApiResponseError) {
      return {
        content: [
          {
            type: 'text',
            text: `X API Error: ${error.message}\nCode: ${error.code}\nData: ${JSON.stringify(error.data, null, 2)}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message || 'Unknown error occurred'}`,
        },
      ],
      isError: true,
    };
  }
});

// Store transports by session ID
const transports: Map<string, SSEServerTransport> = new Map();

// Start HTTP server with SSE
async function main() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // SSE endpoint for MCP - MUST be before any middleware
  // This is because middleware can set headers, and SSEServerTransport needs raw response
  app.get('/sse', async (req, res) => {
    console.error('='.repeat(60));
    console.error('[SSE] STEP 1: New connection request');
    console.error('[SSE] Client IP:', req.ip);
    console.error('[SSE] User-Agent:', req.headers['user-agent']);
    console.error('[SSE] Accept:', req.headers['accept']);

    try {
      console.error('[SSE] STEP 2: Creating SSEServerTransport...');
      const transport = new SSEServerTransport('/message', res);

      // Store the transport by session ID for message routing
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);
      console.error('[SSE] Session ID:', sessionId);

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        console.error(`[SSE] ⚠️  Transport closed for session ${sessionId}`);
        transports.delete(sessionId);
      };

      console.error('[SSE] STEP 3: Connecting server to transport...');
      await server.connect(transport);

      console.error('[SSE] STEP 4: ✅ Transport connected successfully!');
      console.error('[SSE] Connection is now active and waiting for messages');

      // Handle client disconnect
      req.on('close', () => {
        console.error('[SSE] ⚠️  Connection closed by client');
        transports.delete(sessionId);
      });

      req.on('error', (err) => {
        console.error('[SSE] ❌ Connection error:', err);
      });
    } catch (error: any) {
      console.error('[SSE] ❌ STEP FAILED: Error establishing connection');
      console.error('[SSE] Error name:', error.name);
      console.error('[SSE] Error message:', error.message);
      console.error('[SSE] Error stack:', error.stack);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE connection', details: error.message });
      }
    }
  });

  // Debug middleware - log all requests (except SSE which is already handled)
  app.use((req, res, next) => {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.error(`  Headers:`, JSON.stringify(req.headers, null, 2));
    console.error(`  Query:`, JSON.stringify(req.query, null, 2));
    next();
  });

  // Enable CORS for all origins
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req, res) => {
    const now = Date.now();
    const expiresAt = tokenStore.expiresAt;
    const isExpired = expiresAt ? expiresAt < now : false;
    const timeUntilExpiry = expiresAt ? Math.max(0, expiresAt - now) : 0;

    res.json({
      status: 'ok',
      service: 'x-mcp-server',
      version: '1.0.0',
      authenticated: !!tokenStore.accessToken,
      authType: tokenStore.accessToken ? 'OAuth 2.0' : 'OAuth 1.0a',
      tokenStatus: tokenStore.accessToken ? {
        hasRefreshToken: !!tokenStore.refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        isExpired,
        timeUntilExpirySeconds: Math.floor(timeUntilExpiry / 1000),
      } : null,
      endpoints: {
        health: '/health',
        sse: '/sse',
        message: '/message',
        tools: '/tools',
        authorize: '/authorize',
        callback: '/callback'
      }
    });
  });

  // OAuth 2.0 Authorization endpoint
  app.get('/authorize', async (_req, res) => {
    try {
      console.error('[OAUTH] Starting OAuth 2.0 authorization flow...');

      const callbackURL = process.env.CALLBACK_URL || 'http://localhost:3000/callback';

      // Generate authorization URL with PKCE
      const { url, codeVerifier, state } = oauth2Client.generateOAuth2AuthLink(
        callbackURL,
        {
          scope: [
            'tweet.read',
            'tweet.write',
            'users.read',
            'bookmark.read',
            'bookmark.write',
            'like.read',
            'like.write',
            'offline.access'
          ],
        }
      );

      // Store code verifier and state for callback validation
      // In production, use Redis or database
      (global as any).oauth2State = { codeVerifier, state };

      console.error('[OAUTH] Authorization URL generated');
      console.error('[OAUTH] Redirect to:', url);

      // Redirect user to X authorization page
      res.redirect(url);
    } catch (error: any) {
      console.error('[OAUTH] Error generating auth URL:', error);
      res.status(500).json({
        error: 'Failed to start authorization',
        details: error.message
      });
    }
  });

  // OAuth 2.0 Callback endpoint
  app.get('/callback', async (req, res) => {
    try {
      console.error('[OAUTH] Callback received');
      console.error('[OAUTH] Query params:', req.query);

      const { code, state } = req.query;

      if (!code || typeof code !== 'string') {
        throw new Error('Missing authorization code');
      }

      // Retrieve stored state and code verifier
      const storedData = (global as any).oauth2State;

      if (!storedData) {
        throw new Error('No OAuth state found. Please restart authorization.');
      }

      if (state !== storedData.state) {
        throw new Error('State mismatch - possible CSRF attack');
      }

      console.error('[OAUTH] Exchanging code for token...');

      const callbackURL = process.env.CALLBACK_URL || 'http://localhost:3000/callback';

      // Exchange code for access token
      const {
        client: loggedClient,
        accessToken,
        refreshToken,
        expiresIn
      } = await oauth2Client.loginWithOAuth2({
        code,
        codeVerifier: storedData.codeVerifier,
        redirectUri: callbackURL,
      });

      // Store tokens
      const expiresAt = Date.now() + (expiresIn * 1000);
      tokenStore.accessToken = accessToken;
      tokenStore.refreshToken = refreshToken;
      tokenStore.expiresIn = expiresIn;
      tokenStore.expiresAt = expiresAt;
      tokenStore.tokenType = 'Bearer';

      // Update the global client
      rwClient = loggedClient.readWrite;

      // Clean up stored state
      delete (global as any).oauth2State;

      console.error('[OAUTH] ✅ Successfully authenticated with OAuth 2.0!');
      console.error('[OAUTH] Access token obtained (expires in', expiresIn, 'seconds)');
      console.error('[OAUTH] Token expires at:', new Date(expiresAt).toISOString());
      console.error('');
      console.error('[OAUTH] 📋 IMPORTANT: Copy these environment variables to Render to persist tokens:');
      console.error('='.repeat(80));
      console.error(`OAUTH2_ACCESS_TOKEN=${accessToken}`);
      console.error(`OAUTH2_REFRESH_TOKEN=${refreshToken}`);
      console.error(`OAUTH2_EXPIRES_IN=${expiresIn}`);
      console.error(`OAUTH2_EXPIRES_AT=${expiresAt}`);
      console.error(`OAUTH2_TOKEN_TYPE=Bearer`);
      console.error('='.repeat(80));

      res.send(`
        <html>
          <head>
            <title>Authorization Successful</title>
            <style>
              body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
              h1 { color: #1DA1F2; }
              .success { background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 20px 0; }
              .warning { background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
              .code-block { background: #f5f5f5; padding: 15px; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 12px; }
              .copy-btn { background: #1DA1F2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-top: 10px; }
              .copy-btn:hover { background: #1a8cd8; }
            </style>
          </head>
          <body>
            <h1>✅ Authorization Successful!</h1>

            <div class="success">
              <strong>Your X MCP Server is now authenticated with OAuth 2.0!</strong><br>
              Access granted for: bookmarks, tweets, likes, and more.
            </div>

            <div class="warning">
              <h3>⚠️ Important: Persist Your Tokens</h3>
              <p>To avoid re-authorizing after every deployment, add these environment variables to your Render dashboard:</p>

              <div class="code-block" id="envVars">OAUTH2_ACCESS_TOKEN=${accessToken}
OAUTH2_REFRESH_TOKEN=${refreshToken}
OAUTH2_EXPIRES_IN=${expiresIn}
OAUTH2_EXPIRES_AT=${expiresAt}
OAUTH2_TOKEN_TYPE=Bearer</div>

              <button class="copy-btn" onclick="copyToClipboard()">📋 Copy to Clipboard</button>

              <h4>Steps:</h4>
              <ol>
                <li>Go to your Render dashboard</li>
                <li>Select your x-mcp-server service</li>
                <li>Go to <strong>Environment</strong> tab</li>
                <li>Add each variable above</li>
                <li>Click <strong>Save Changes</strong></li>
              </ol>
            </div>

            <p style="text-align: center; margin-top: 40px; color: #666;">
              You can now close this window and return to Poke.
            </p>

            <script>
              function copyToClipboard() {
                const text = document.getElementById('envVars').innerText;
                navigator.clipboard.writeText(text).then(() => {
                  alert('✅ Copied to clipboard! Paste these into Render environment variables.');
                });
              }
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error('[OAUTH] ❌ Callback error:', error);
      res.status(500).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body style="font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center;">
            <h1 style="color: #e00;">❌ Authorization Failed</h1>
            <p>Error: ${error.message}</p>
            <p><a href="/authorize">Try again</a></p>
          </body>
        </html>
      `);
    }
  });

  // List available tools endpoint (for testing)
  app.get('/tools', async (_req, res) => {
    res.json({
      tools: TOOLS.map(t => ({
        name: t.name,
        description: t.description
      }))
    });
  });

  // Message endpoint for MCP
  app.post('/message', async (req, res) => {
    console.error('='.repeat(60));
    console.error('[MESSAGE] POST request received');
    console.error('[MESSAGE] Content-Type:', req.headers['content-type']);
    console.error('[MESSAGE] Query params:', JSON.stringify(req.query, null, 2));
    console.error('[MESSAGE] Body:', JSON.stringify(req.body, null, 2));

    // Extract session ID from URL query parameter
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      console.error('[MESSAGE] ❌ No session ID provided in request URL');
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    const transport = transports.get(sessionId);

    if (!transport) {
      console.error(`[MESSAGE] ❌ No active transport found for session ID: ${sessionId}`);
      console.error(`[MESSAGE] Active sessions: ${Array.from(transports.keys()).join(', ')}`);
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      console.error(`[MESSAGE] ✅ Routing to transport for session ${sessionId}`);
      // Handle the POST message with the transport
      await transport.handlePostMessage(req, res, req.body);
    } catch (error: any) {
      console.error('[MESSAGE] ❌ Error handling message:', error.message);
      console.error('[MESSAGE] Error stack:', error.stack);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message' });
      }
    }
  });

  app.listen(PORT, () => {
    console.error('='.repeat(60));
    console.error('🚀 X MCP Server Started Successfully!');
    console.error('='.repeat(60));
    console.error(`Server URL: http://localhost:${PORT}`);
    console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
    console.error(`Health check: http://localhost:${PORT}/health`);
    console.error(`Tools list: http://localhost:${PORT}/tools`);
    console.error('='.repeat(60));
    console.error('Waiting for connections...');
    console.error('');
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
