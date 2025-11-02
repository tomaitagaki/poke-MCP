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

// Initialize Twitter client
const client = new TwitterApi({
  appKey: process.env.X_API_KEY || '',
  appSecret: process.env.X_API_SECRET || '',
  accessToken: process.env.X_ACCESS_TOKEN || '',
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
});

const rwClient = client.readWrite;

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
    res.json({
      status: 'ok',
      service: 'x-mcp-server',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        sse: '/sse',
        message: '/message',
        tools: '/tools'
      }
    });
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
