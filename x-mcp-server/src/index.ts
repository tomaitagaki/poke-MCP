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
import { promises as fs } from 'fs';
import { join } from 'path';
import { AsyncLocalStorage } from 'async_hooks';

dotenv.config();

// Multi-user mode flag
const MULTI_USER_MODE = process.env.MULTI_USER_MODE === 'true';

// User configuration
interface User {
  userId: string;
  apiKey: string;
  name: string;
  xClientId: string;
  xClientSecret: string;
  callbackUrl: string;
}

// User store loaded from users.json
interface UserStore {
  users: User[];
}

// OAuth 2.0 token storage (persisted to local file)
interface TokenStore {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  expiresAt?: number; // Timestamp when token expires
}

// Bookmark categorization tracking
interface CategorizedBookmarksStore {
  categorizedIds: string[]; // Array of tweet IDs that have been categorized
  lastUpdated?: number; // Timestamp of last update
}

// Load users from users.json file
let userStore: UserStore = { users: [] };

// Categorized bookmarks store - Map of userId to CategorizedBookmarksStore
const categorizedBookmarksStores: Map<string, CategorizedBookmarksStore> = new Map();

async function loadUsers(): Promise<UserStore> {
  if (!MULTI_USER_MODE) {
    console.error('[AUTH] Single-user mode enabled');
    return { users: [] };
  }

  try {
    const usersFilePath = join(process.cwd(), 'users.json');
    const data = await fs.readFile(usersFilePath, 'utf-8');
    const store = JSON.parse(data) as UserStore;
    console.error(`[AUTH] ✅ Loaded ${store.users.length} users from users.json`);
    return store;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('[AUTH] ⚠️  users.json not found. Create it from users.json.example');
    } else {
      console.error('[AUTH] ⚠️  Error loading users.json:', error.message);
    }
    return { users: [] };
  }
}

// Authenticate user by API key
function getUserByApiKey(apiKey: string): User | undefined {
  if (!MULTI_USER_MODE) {
    return undefined;
  }
  return userStore.users.find(u => u.apiKey === apiKey);
}

// Get token file path for a specific user
function getTokenFilePath(userId?: string): string {
  const basePath = process.env.RENDER_DISK_PATH
    ? process.env.RENDER_DISK_PATH
    : process.cwd();

  if (userId) {
    return join(basePath, `.tokens-${userId}.json`);
  }
  // Fallback for single-user mode
  return join(basePath, '.tokens.json');
}

// Load tokens from local file or environment variable (for Render persistence)
async function loadTokens(userId?: string): Promise<TokenStore> {
  const tokenFilePath = getTokenFilePath(userId);

  // First, try loading from environment variable (survives Render restarts)
  // In multi-user mode, use X_OAUTH_TOKENS_{userId}
  const envVarName = userId ? `X_OAUTH_TOKENS_${userId.toUpperCase()}` : 'X_OAUTH_TOKENS';
  const envTokens = process.env[envVarName];
  if (envTokens) {
    try {
      // Trim whitespace and handle quoted strings (common when copying from UI)
      const trimmed = envTokens.trim();
      const cleaned = trimmed.startsWith('"') && trimmed.endsWith('"') 
        ? trimmed.slice(1, -1) 
        : trimmed;
      
      const tokens = JSON.parse(cleaned) as TokenStore;
      
      // Validate token structure
      if (!tokens.accessToken) {
        console.error('[AUTH] ⚠️  Token loaded but missing accessToken field');
        return {};
      }
      
      console.error('[AUTH] ✅ OAuth 2.0 tokens loaded from environment variable');
      console.error('[AUTH] Access token length:', tokens.accessToken.length, 'characters');
      console.error('[AUTH] Has refresh token:', !!tokens.refreshToken);
      
      if (tokens.expiresAt) {
        const expiresAt = new Date(tokens.expiresAt);
        const now = new Date();
        const isExpired = expiresAt < now;
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();
        
        console.error('[AUTH] Token expires at:', expiresAt.toISOString());
        console.error('[AUTH] Token is expired:', isExpired);
        if (!isExpired) {
          console.error('[AUTH] Time until expiry:', Math.floor(timeUntilExpiry / 1000 / 60), 'minutes');
        }
      } else {
        console.error('[AUTH] ⚠️  Token missing expiresAt field - may be expired');
      }
      
      return tokens;
    } catch (error: any) {
      console.error('[AUTH] ⚠️  Error parsing tokens from environment:', error.message);
      console.error('[AUTH] Env var length:', envTokens.length);
      console.error('[AUTH] First 50 chars:', envTokens.substring(0, 50));
      console.error('[AUTH] Make sure X_OAUTH_TOKENS is valid JSON without extra quotes');
    }
  }
  
  // Fallback to file storage
  try {
    const data = await fs.readFile(tokenFilePath, 'utf-8');
    const tokens = JSON.parse(data) as TokenStore;
    const userLabel = userId ? `for user ${userId}` : '';
    console.error(`[AUTH] ✅ OAuth 2.0 tokens loaded from local storage ${userLabel}`);
    if (tokens.expiresAt) {
      console.error('[AUTH] Token expires at:', new Date(tokens.expiresAt).toISOString());
    }
    return tokens;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const userLabel = userId ? `for user ${userId}` : '';
      console.error(`[AUTH] ⚠️  No OAuth 2.0 tokens found ${userLabel}. Visit /authorize to authenticate.`);
      return {};
    }
    console.error('[AUTH] ⚠️  Error loading tokens:', error.message);
    return {};
  }
}

// Save tokens to local file and optionally to environment variable instructions
async function saveTokens(tokens: TokenStore, userId?: string): Promise<void> {
  const tokenFilePath = getTokenFilePath(userId);

  try {
    // Save to file
    await fs.writeFile(tokenFilePath, JSON.stringify(tokens, null, 2), 'utf-8');
    const userLabel = userId ? `for user ${userId}` : '';
    console.error(`[AUTH] ✅ Tokens saved to local storage ${userLabel}`);
    
    // On Render, tokens in files don't persist across restarts
    // Log instructions for manual persistence via environment variable
    if (process.env.RENDER) {
      const tokenJson = JSON.stringify(tokens);
      const envVarName = userId ? `X_OAUTH_TOKENS_${userId.toUpperCase()}` : 'X_OAUTH_TOKENS';
      console.error('[AUTH] ⚠️  Render detected: Tokens will be lost on restart.');
      console.error(`[AUTH] 💡 To persist tokens, set ${envVarName} environment variable in Render dashboard:`);
      console.error(`[AUTH]    Value: ${tokenJson.substring(0, 100)}...`);
      console.error('[AUTH]    Full value length:', tokenJson.length, 'characters');
    }
  } catch (error: any) {
    console.error('[AUTH] ❌ Error saving tokens:', error.message);
    throw error;
  }
}

// Get categorized bookmarks file path for a specific user
function getCategorizedBookmarksFilePath(userId?: string): string {
  const basePath = process.env.RENDER_DISK_PATH
    ? process.env.RENDER_DISK_PATH
    : process.cwd();

  if (userId) {
    return join(basePath, `.categorized-bookmarks-${userId}.json`);
  }
  // Fallback for single-user mode
  return join(basePath, '.categorized-bookmarks.json');
}

// Load categorized bookmarks from local file
async function loadCategorizedBookmarks(userId?: string): Promise<CategorizedBookmarksStore> {
  const filePath = getCategorizedBookmarksFilePath(userId);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const store = JSON.parse(data) as CategorizedBookmarksStore;
    const userLabel = userId ? `for user ${userId}` : '';
    console.error(`[BOOKMARKS] ✅ Loaded ${store.categorizedIds.length} categorized bookmark IDs ${userLabel}`);
    return store;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return empty store
      return { categorizedIds: [] };
    }
    console.error('[BOOKMARKS] ⚠️  Error loading categorized bookmarks:', error.message);
    return { categorizedIds: [] };
  }
}

// Save categorized bookmarks to local file
async function saveCategorizedBookmarks(store: CategorizedBookmarksStore, userId?: string): Promise<void> {
  const filePath = getCategorizedBookmarksFilePath(userId);

  try {
    store.lastUpdated = Date.now();
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
    const userLabel = userId ? `for user ${userId}` : '';
    console.error(`[BOOKMARKS] ✅ Saved ${store.categorizedIds.length} categorized bookmark IDs ${userLabel}`);
  } catch (error: any) {
    console.error('[BOOKMARKS] ❌ Error saving categorized bookmarks:', error.message);
    throw error;
  }
}

// Initialize token stores - Map of userId to TokenStore
const tokenStores: Map<string, TokenStore> = new Map();

// Load users and tokens on startup
loadUsers().then(async (store) => {
  userStore = store;

  // In multi-user mode, pre-load tokens and categorized bookmarks for all users
  if (MULTI_USER_MODE) {
    for (const user of userStore.users) {
      try {
        const tokens = await loadTokens(user.userId);
        tokenStores.set(user.userId, tokens);

        const categorizedBookmarks = await loadCategorizedBookmarks(user.userId);
        categorizedBookmarksStores.set(user.userId, categorizedBookmarks);
      } catch (err) {
        console.error(`[AUTH] Failed to load data for user ${user.userId}:`, err);
      }
    }
  } else {
    // Single-user mode - load tokens and categorized bookmarks without userId
    const tokens = await loadTokens();
    tokenStores.set('default', tokens);

    const categorizedBookmarks = await loadCategorizedBookmarks();
    categorizedBookmarksStores.set('default', categorizedBookmarks);
  }
}).catch(err => {
  console.error('[AUTH] Failed to load users on startup:', err);
});

// Get OAuth 2.0 client for a specific user or default credentials
function getOAuth2Client(user?: User): TwitterApi {
  if (user) {
    return new TwitterApi({
      clientId: user.xClientId,
      clientSecret: user.xClientSecret,
    });
  }
  // Fallback to environment variables for single-user mode
  return new TwitterApi({
    clientId: process.env.X_CLIENT_ID || '',
    clientSecret: process.env.X_CLIENT_SECRET || '',
  });
}

// Function to refresh OAuth 2.0 access token if expired
async function refreshAccessTokenIfNeeded(userId: string, user?: User): Promise<void> {
  const tokenStore = tokenStores.get(userId) || {};

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
    console.error(`[AUTH] 🔄 Access token expired or expiring soon for user ${userId}, refreshing...`);

    const oauth2Client = getOAuth2Client(user);
    const {
      client: refreshedClient,
      accessToken,
      refreshToken,
      expiresIn,
    } = await oauth2Client.refreshOAuth2Token(tokenStore.refreshToken);

    // Update token store
    const updatedTokens: TokenStore = {
      accessToken,
      refreshToken: refreshToken || tokenStore.refreshToken,
      expiresIn,
      expiresAt: Date.now() + (expiresIn * 1000),
      tokenType: 'Bearer',
    };

    tokenStores.set(userId, updatedTokens);

    // Save to local file
    await saveTokens(updatedTokens, userId);

    console.error('[AUTH] ✅ Token refreshed successfully!');
    console.error('[AUTH] New token expires at:', new Date(updatedTokens.expiresAt!).toISOString());
  } catch (error: any) {
    console.error(`[AUTH] ❌ Failed to refresh token for user ${userId}:`, error.message);
    console.error('[AUTH] You may need to re-authorize at /authorize');
    // Clear invalid tokens
    tokenStores.set(userId, {});
    try {
      const tokenFilePath = getTokenFilePath(userId);
      await fs.unlink(tokenFilePath);
    } catch {
      // Ignore errors deleting token file
    }
  }
}

// Function to get Twitter client (OAuth 2.0 only)
async function getTwitterClient(userId: string = 'default', user?: User): Promise<TwitterApi> {
  // Ensure tokens are loaded
  let tokenStore = tokenStores.get(userId);
  if (!tokenStore || !tokenStore.accessToken) {
    tokenStore = await loadTokens(userId !== 'default' ? userId : undefined);
    tokenStores.set(userId, tokenStore);
  }

  // Try to refresh token if needed
  await refreshAccessTokenIfNeeded(userId, user);

  // Re-fetch token store after potential refresh
  tokenStore = tokenStores.get(userId) || {};

  if (!tokenStore.accessToken) {
    const userLabel = userId !== 'default' ? `for user ${userId}` : '';
    throw new Error(`No OAuth 2.0 access token available ${userLabel}. Please visit /authorize to authenticate.`);
  }

  // Validate token format (OAuth 2.0 tokens are typically base64-like strings)
  if (tokenStore.accessToken.length < 20) {
    console.error('[AUTH] ⚠️  Access token seems too short:', tokenStore.accessToken.length);
  }

  const userLabel = userId !== 'default' ? `for user ${userId}` : '';
  console.error(`[AUTH] Using OAuth 2.0 token ${userLabel}`);
  console.error('[AUTH] Token preview:', tokenStore.accessToken.substring(0, 20) + '...');

  return new TwitterApi(tokenStore.accessToken);
}

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
  {
    name: 'get_uncategorized_bookmarks',
    description: 'Get bookmarks that have not yet been categorized. Returns only new bookmarks that need to be processed by the AI agent.',
    inputSchema: {
      type: 'object',
      properties: {
        max_results: {
          type: 'number',
          description: 'Maximum number of bookmarks to return (5-100, default 50)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'mark_bookmarks_categorized',
    description: 'Mark specific bookmarks as categorized after processing them. This prevents them from appearing in future get_uncategorized_bookmarks calls.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_ids: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Array of tweet IDs to mark as categorized',
        },
      },
      required: ['tweet_ids'],
    },
  },
  {
    name: 'reset_categorized_bookmarks',
    description: 'Clear all categorized bookmark tracking. Use this to start fresh or if you want to re-process all bookmarks.',
    inputSchema: {
      type: 'object',
      properties: {},
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
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  console.error(`[TOOL] 🔧 Tool call received: ${name}`);
  console.error(`[TOOL] Arguments:`, JSON.stringify(args, null, 2));

  try {
    // Get user context from AsyncLocalStorage (set during message handling)
    const context = sessionContext.getStore();
    const sessionId = context?.sessionId;
    const userContext = sessionId ? sessionToUser.get(sessionId) : null;

    let userId = 'default';
    let user: User | undefined;

    if (MULTI_USER_MODE) {
      if (!userContext) {
        throw new Error('Authentication required. Please reconnect with valid API key.');
      }
      userId = userContext.userId;
      user = userContext.user;
      console.error(`[TOOL] Authenticated as user: ${userId}`);
    }

    // Refresh client to use latest OAuth 2.0 token if available
    console.error(`[TOOL] 🔄 Getting Twitter client...`);
    const client = await getTwitterClient(userId, user);
    const rwClient = client.readWrite;
    console.error(`[TOOL] ✅ Twitter client ready`);

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

        console.error(`[TOOL] 📚 Getting bookmarks (max_results: ${max_results})...`);
        
        // First verify we can access user info (validates token)
        try {
          const me = await rwClient.v2.me();
          console.error(`[TOOL] ✅ Got user info - User ID: ${me.data.id}, Username: ${me.data.username}`);
        } catch (error: any) {
          console.error(`[TOOL] ❌ Failed to get user info - token may be invalid`);
          console.error(`[TOOL] Error:`, error.message);
          throw new Error(`Token validation failed: ${error.message}. Please re-authenticate at /authorize`);
        }
        
        console.error(`[TOOL] ✅ Got user info, fetching bookmarks...`);
        const bookmarks = await rwClient.v2.bookmarks({
          max_results: Math.min(Math.max(max_results, 5), 100),
          pagination_token,
          'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
        });
        console.error(`[TOOL] ✅ Got ${bookmarks.data.data?.length || 0} bookmarks`);

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

      case 'get_uncategorized_bookmarks': {
        const { max_results = 50 } = args as {
          max_results?: number;
        };

        console.error(`[TOOL] 📚 Getting uncategorized bookmarks (max_results: ${max_results})...`);

        // Load the categorized bookmarks store for this user
        let categorizedStore = categorizedBookmarksStores.get(userId);
        if (!categorizedStore) {
          categorizedStore = await loadCategorizedBookmarks(userId !== 'default' ? userId : undefined);
          categorizedBookmarksStores.set(userId, categorizedStore);
        }

        const categorizedIds = new Set(categorizedStore.categorizedIds);
        console.error(`[TOOL] 📊 Currently have ${categorizedIds.size} categorized bookmark IDs`);

        // Fetch bookmarks from X API
        const bookmarks = await rwClient.v2.bookmarks({
          max_results: Math.min(Math.max(max_results, 5), 100),
          'tweet.fields': ['created_at', 'author_id', 'public_metrics', 'text'],
          expansions: ['author_id'],
          'user.fields': ['username', 'name'],
        });

        // Filter out already categorized bookmarks
        const uncategorizedBookmarks = (bookmarks.data.data || []).filter(
          tweet => !categorizedIds.has(tweet.id)
        );

        console.error(`[TOOL] ✅ Found ${uncategorizedBookmarks.length} uncategorized bookmarks out of ${bookmarks.data.data?.length || 0} total`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                uncategorized_bookmarks: uncategorizedBookmarks,
                total_fetched: bookmarks.data.data?.length || 0,
                uncategorized_count: uncategorizedBookmarks.length,
                already_categorized_count: categorizedIds.size,
                users: bookmarks.includes?.users || [],
                meta: bookmarks.data.meta,
              }, null, 2),
            },
          ],
        };
      }

      case 'mark_bookmarks_categorized': {
        const { tweet_ids } = args as { tweet_ids: string[] };

        console.error(`[TOOL] ✏️  Marking ${tweet_ids.length} bookmarks as categorized...`);

        // Load the categorized bookmarks store for this user
        let categorizedStore = categorizedBookmarksStores.get(userId);
        if (!categorizedStore) {
          categorizedStore = await loadCategorizedBookmarks(userId !== 'default' ? userId : undefined);
          categorizedBookmarksStores.set(userId, categorizedStore);
        }

        // Add new IDs to the set (avoiding duplicates)
        const initialCount = categorizedStore.categorizedIds.length;
        const categorizedSet = new Set(categorizedStore.categorizedIds);

        for (const id of tweet_ids) {
          categorizedSet.add(id);
        }

        categorizedStore.categorizedIds = Array.from(categorizedSet);
        const newlyAdded = categorizedStore.categorizedIds.length - initialCount;

        // Save to file
        await saveCategorizedBookmarks(categorizedStore, userId !== 'default' ? userId : undefined);

        console.error(`[TOOL] ✅ Marked ${newlyAdded} new bookmarks as categorized (${tweet_ids.length - newlyAdded} were already categorized)`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                newly_marked: newlyAdded,
                already_marked: tweet_ids.length - newlyAdded,
                total_categorized: categorizedStore.categorizedIds.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'reset_categorized_bookmarks': {
        console.error(`[TOOL] 🔄 Resetting all categorized bookmarks...`);

        // Reset the store
        const emptyStore: CategorizedBookmarksStore = {
          categorizedIds: [],
          lastUpdated: Date.now(),
        };

        categorizedBookmarksStores.set(userId, emptyStore);
        await saveCategorizedBookmarks(emptyStore, userId !== 'default' ? userId : undefined);

        console.error(`[TOOL] ✅ All categorized bookmarks have been reset`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'All categorized bookmarks tracking has been reset. All bookmarks will now appear as uncategorized.',
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
    console.error(`[TOOL] ❌ Error executing tool ${name}:`, error.message);
    console.error(`[TOOL] Error stack:`, error.stack);
    
    if (error instanceof ApiResponseError) {
      console.error(`[TOOL] X API Error details:`, {
        code: error.code,
        data: error.data,
      });
      
      // Provide helpful error messages for common issues
      let errorMessage = `X API Error: ${error.message}\nCode: ${error.code}`;
      
      if (error.code === 429) {
        // Rate limit error
        const rateLimitInfo: any = (error as any).rateLimit || {};
        const resetAt = rateLimitInfo.reset ? new Date(rateLimitInfo.reset * 1000).toISOString() : 'unknown';
        
        errorMessage += '\n\n⚠️ Rate Limit Exceeded (429 Too Many Requests)';
        errorMessage += '\n\nX API has rate limits to prevent abuse. Common limits:';
        errorMessage += '\n- User timeline: 75 requests per 15 minutes';
        errorMessage += '\n- Tweet lookup: 300 requests per 15 minutes';
        errorMessage += '\n- Search: Varies by access level';
        errorMessage += '\n- Bookmarks: 180 requests per 15 minutes';
        
        if (rateLimitInfo.reset) {
          errorMessage += `\n\nRate limit resets at: ${resetAt}`;
          const now = Date.now();
          const resetTime = rateLimitInfo.reset * 1000;
          const waitSeconds = Math.ceil((resetTime - now) / 1000);
          if (waitSeconds > 0) {
            errorMessage += `\nPlease wait approximately ${Math.ceil(waitSeconds / 60)} minutes before retrying.`;
          }
        } else {
          errorMessage += '\n\nPlease wait a few minutes before retrying.';
        }
        
        errorMessage += '\n\nTo avoid rate limits:';
        errorMessage += '\n- Space out your requests';
        errorMessage += '\n- Cache results when possible';
        errorMessage += '\n- Use pagination tokens instead of making multiple requests';
        
      } else if (error.code === 403) {
        errorMessage += '\n\n403 Forbidden usually means:';
        errorMessage += '\n1. Token is invalid or expired';
        errorMessage += '\n2. Token missing required scopes';
        errorMessage += '\n3. X Developer App permissions not set correctly';
        errorMessage += '\n\nSolution: Visit /authorize to re-authenticate';
      } else if (error.code === 401) {
        errorMessage += '\n\n401 Unauthorized means the token is invalid or expired.';
        errorMessage += '\nSolution: Visit /authorize to re-authenticate';
      }
      
      errorMessage += `\n\nFull error: ${JSON.stringify(error.data, null, 2)}`;
      
      return {
        content: [
          {
            type: 'text',
            text: errorMessage,
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

// Map session IDs to user IDs for authenticated sessions
const sessionToUser: Map<string, { userId: string; user?: User }> = new Map();

// AsyncLocalStorage for tracking current session context
const sessionContext = new AsyncLocalStorage<{ sessionId: string }>();

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
      // STEP 1.5: Authenticate user (multi-user mode only)
      let userId = 'default';
      let user: User | undefined;

      if (MULTI_USER_MODE) {
        // Extract API key from header or query parameter
        const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;

        if (!apiKey) {
          console.error('[SSE] ❌ No API key provided in multi-user mode');
          if (!res.headersSent) {
            res.status(401).json({
              error: 'Authentication required',
              message: 'Please provide API key via X-API-Key header or apiKey query parameter'
            });
          }
          return;
        }

        user = getUserByApiKey(apiKey);
        if (!user) {
          console.error('[SSE] ❌ Invalid API key provided');
          if (!res.headersSent) {
            res.status(401).json({
              error: 'Invalid API key',
              message: 'The provided API key is not valid'
            });
          }
          return;
        }

        userId = user.userId;
        console.error(`[SSE] ✅ Authenticated as user: ${userId} (${user.name})`);
      }

      console.error('[SSE] STEP 2: Creating SSEServerTransport...');
      const transport = new SSEServerTransport('/message', res);

      // Store the transport by session ID for message routing
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);
      console.error('[SSE] Session ID:', sessionId);

      // Store user context for this session
      sessionToUser.set(sessionId, { userId, user });
      console.error(`[SSE] Session ${sessionId} mapped to user ${userId}`);

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        console.error(`[SSE] ⚠️  Transport closed for session ${sessionId}`);
        transports.delete(sessionId);
        sessionToUser.delete(sessionId);
      };

      console.error('[SSE] STEP 3: Connecting server to transport...');
      // Store session ID in transport metadata for request handlers
      (transport as any)._meta = { sessionId };
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
  app.get('/health', async (req, res) => {
    const now = Date.now();

    if (MULTI_USER_MODE) {
      // Multi-user health check
      const userStatuses = [];

      for (const user of userStore.users) {
        const userId = user.userId;
        const tokenStore = tokenStores.get(userId) || {};

        const expiresAt = tokenStore.expiresAt;
        const isExpired = expiresAt ? expiresAt < now : false;
        const timeUntilExpiry = expiresAt ? Math.max(0, expiresAt - now) : 0;

        userStatuses.push({
          userId: userId,
          name: user.name,
          authenticated: !!tokenStore.accessToken,
          hasRefreshToken: !!tokenStore.refreshToken,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          isExpired,
          timeUntilExpirySeconds: Math.floor(timeUntilExpiry / 1000),
        });
      }

      res.json({
        status: 'ok',
        service: 'x-mcp-server',
        version: '1.0.0',
        mode: 'multi-user',
        totalUsers: userStore.users.length,
        activeSessions: transports.size,
        users: userStatuses,
        endpoints: {
          health: '/health',
          sse: '/sse (requires X-API-Key header or apiKey query param)',
          message: '/message',
          tools: '/tools',
          authorize: '/authorize?apiKey=YOUR_API_KEY or /authorize?userId=USER_ID',
          callback: '/callback',
        }
      });
    } else {
      // Single-user health check
      const tokenStore = tokenStores.get('default') || {};

      const expiresAt = tokenStore.expiresAt;
      const isExpired = expiresAt ? expiresAt < now : false;
      const timeUntilExpiry = expiresAt ? Math.max(0, expiresAt - now) : 0;

      // Try to validate token if available
      let tokenValid = false;
      let tokenValidationError = null;
      if (tokenStore.accessToken) {
        try {
          const testClient = new TwitterApi(tokenStore.accessToken);
          await testClient.v2.me();
          tokenValid = true;
        } catch (error: any) {
          tokenValid = false;
          tokenValidationError = error.message;
        }
      }

      res.json({
        status: 'ok',
        service: 'x-mcp-server',
        version: '1.0.0',
        mode: 'single-user',
        authenticated: !!tokenStore.accessToken,
        tokenValid,
        authType: 'OAuth 2.0',
        tokenStatus: tokenStore.accessToken ? {
          hasRefreshToken: !!tokenStore.refreshToken,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          isExpired,
          timeUntilExpirySeconds: Math.floor(timeUntilExpiry / 1000),
          tokenLength: tokenStore.accessToken.length,
          validationError: tokenValidationError,
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
    }
  });

  // OAuth 2.0 Authorization endpoint
  app.get('/authorize', async (req, res) => {
    try {
      console.error('[OAUTH] Starting OAuth 2.0 authorization flow...');

      // In multi-user mode, require userId or apiKey parameter
      let userId = 'default';
      let user: User | undefined;

      if (MULTI_USER_MODE) {
        const apiKey = req.query.apiKey as string || req.headers['x-api-key'] as string;
        const userIdParam = req.query.userId as string;

        if (apiKey) {
          user = getUserByApiKey(apiKey);
          if (!user) {
            return res.status(401).json({
              error: 'Invalid API key',
              message: 'The provided API key is not valid'
            });
          }
          userId = user.userId;
        } else if (userIdParam) {
          user = userStore.users.find(u => u.userId === userIdParam);
          if (!user) {
            return res.status(404).json({
              error: 'User not found',
              message: `No user found with ID: ${userIdParam}`
            });
          }
          userId = user.userId;
        } else {
          return res.status(400).json({
            error: 'Missing authentication',
            message: 'In multi-user mode, provide apiKey or userId query parameter'
          });
        }

        console.error(`[OAUTH] Authorizing for user: ${userId} (${user.name})`);
      }

      const oauth2Client = getOAuth2Client(user);
      const callbackURL = user?.callbackUrl || process.env.CALLBACK_URL || 'http://localhost:3000/callback';

      // Generate authorization URL with PKCE
      // Scopes required for bookmarks: tweet.read, users.read, bookmark.read, bookmark.write
      // See: https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping
      const { url, codeVerifier, state } = oauth2Client.generateOAuth2AuthLink(
        callbackURL,
        {
          scope: [
            'tweet.read',
            'users.read',
            'bookmark.read',
            'bookmark.write',
            'tweet.write',
            'like.read',
            'like.write',
            'offline.access' // Required for token refresh
          ],
        }
      );

      // Store code verifier, state, and userId for callback validation
      // Try to persist to file for Render compatibility (survives restarts)
      // Fallback to in-memory if file write fails
      const stateFileName = userId !== 'default' ? `.oauth-state-${userId}.json` : '.oauth-state.json';
      const stateFilePath = process.env.RENDER_DISK_PATH
        ? join(process.env.RENDER_DISK_PATH, stateFileName)
        : join(process.cwd(), stateFileName);

      try {
        await fs.writeFile(stateFilePath, JSON.stringify({ codeVerifier, state, userId, timestamp: Date.now() }), 'utf-8');
        console.error('[OAUTH] State saved to file for persistence');
      } catch (error: any) {
        console.error('[OAUTH] Could not save state to file, using in-memory:', error.message);
        if (!(global as any).oauth2States) {
          (global as any).oauth2States = new Map();
        }
        (global as any).oauth2States.set(state, { codeVerifier, state, userId, timestamp: Date.now() });
      }

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
      // Try to load from file first (for Render persistence), then fallback to memory
      let storedData: any = null;
      let stateFilePathToDelete: string | null = null;

      // Try multiple state file locations (for multi-user support)
      const possibleStatePaths = [
        process.env.RENDER_DISK_PATH
          ? join(process.env.RENDER_DISK_PATH, '.oauth-state.json')
          : join(process.cwd(), '.oauth-state.json')
      ];

      // Also check for user-specific state files
      if (MULTI_USER_MODE) {
        for (const user of userStore.users) {
          const stateFileName = `.oauth-state-${user.userId}.json`;
          possibleStatePaths.push(
            process.env.RENDER_DISK_PATH
              ? join(process.env.RENDER_DISK_PATH, stateFileName)
              : join(process.cwd(), stateFileName)
          );
        }
      }

      // Try to load state from files
      for (const filePath of possibleStatePaths) {
        try {
          const stateData = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(stateData);
          if (data.state === state) {
            storedData = data;
            stateFilePathToDelete = filePath;
            console.error('[OAUTH] State loaded from file:', filePath);
            break;
          }
        } catch (error: any) {
          // File doesn't exist or can't be read, continue to next
        }
      }

      // Fallback to in-memory state
      if (!storedData && (global as any).oauth2States) {
        storedData = (global as any).oauth2States.get(state);
        if (storedData) {
          console.error('[OAUTH] State loaded from memory');
          (global as any).oauth2States.delete(state);
        }
      }

      if (!storedData) {
        throw new Error('No OAuth state found. Please restart authorization by visiting /authorize again.');
      }

      // Clean up state file after reading
      if (stateFilePathToDelete) {
        await fs.unlink(stateFilePathToDelete).catch(() => {});
      }

      // Check if state is too old (more than 10 minutes)
      if (storedData.timestamp && Date.now() - storedData.timestamp > 10 * 60 * 1000) {
        throw new Error('OAuth state expired. Please restart authorization.');
      }

      if (state !== storedData.state) {
        throw new Error('State mismatch - possible CSRF attack');
      }

      const userId = storedData.userId || 'default';
      const user = userId !== 'default' ? userStore.users.find(u => u.userId === userId) : undefined;

      console.error(`[OAUTH] Exchanging code for token for user: ${userId}...`);

      const oauth2Client = getOAuth2Client(user);
      const callbackURL = user?.callbackUrl || process.env.CALLBACK_URL || 'http://localhost:3000/callback';

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
      const newTokens: TokenStore = {
        accessToken,
        refreshToken,
        expiresIn,
        expiresAt,
        tokenType: 'Bearer',
      };

      // Save tokens to user-specific storage
      tokenStores.set(userId, newTokens);
      await saveTokens(newTokens, userId !== 'default' ? userId : undefined);

      console.error(`[OAUTH] ✅ Successfully authenticated with OAuth 2.0 for user ${userId}!`);
      console.error('[OAUTH] Access token obtained (expires in', expiresIn, 'seconds)');
      console.error('[OAUTH] Token expires at:', new Date(expiresAt).toISOString());
      const tokenFileName = userId !== 'default' ? `.tokens-${userId}.json` : '.tokens.json';
      console.error(`[OAUTH] Tokens saved to local storage (${tokenFileName})`);

      // Prepare token JSON for environment variable (for Render persistence)
      const tokenJson = JSON.stringify(newTokens);
      const envVarName = userId !== 'default' ? `X_OAUTH_TOKENS_${userId.toUpperCase()}` : 'X_OAUTH_TOKENS';
      const isRender = !!process.env.RENDER;

      res.send(`
        <html>
          <head>
            <title>Authorization Successful</title>
            <style>
              body { font-family: system-ui; max-width: 900px; margin: 50px auto; padding: 20px; }
              h1 { color: #1DA1F2; }
              .success { background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 20px 0; }
              .warning { background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
              .code-block { background: #f5f5f5; padding: 15px; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 11px; word-break: break-all; max-height: 200px; overflow-y: auto; }
              .copy-btn { background: #1DA1F2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-top: 10px; }
              .copy-btn:hover { background: #1a8cd8; }
              .step { margin: 15px 0; padding: 10px; background: #f9f9f9; border-radius: 4px; }
            </style>
            <script>
              function copyTokens() {
                const text = document.getElementById('token-json').textContent;
                navigator.clipboard.writeText(text).then(() => {
                  alert('Tokens copied to clipboard! Paste into X_OAUTH_TOKENS environment variable in Render.');
                });
              }
            </script>
          </head>
          <body>
            <h1>✅ Authorization Successful!</h1>

            <div class="success">
              <strong>Your X MCP Server is now authenticated with OAuth 2.0!</strong><br>
              ${userId !== 'default' ? `<p><strong>User:</strong> ${userId}${user ? ` (${user.name})` : ''}</p>` : ''}
              <p>Your OAuth 2.0 tokens have been saved to <code>${tokenFileName}</code> and will be automatically refreshed before expiration.</p>
              <p><strong>Scopes granted:</strong> tweet.read, users.read, bookmark.read, bookmark.write, tweet.write, like.read, like.write, offline.access</p>
              <p><strong>Token expires:</strong> ${new Date(expiresAt).toLocaleString()}</p>
            </div>

            ${isRender ? `
            <div class="warning">
              <strong>⚠️ Render Free Tier Notice:</strong>
              <p>Tokens saved to files will be <strong>lost when the service restarts</strong> on Render free tier.</p>
              <p><strong>To persist tokens across restarts:</strong></p>
              <div class="step">
                <strong>Step 1:</strong> Copy the token JSON below<br>
                <strong>Step 2:</strong> Go to Render Dashboard → Your Service → Environment<br>
                <strong>Step 3:</strong> Add environment variable:<br>
                <code>Key:</code> <strong>${envVarName}</strong><br>
                <code>Value:</code> (paste the JSON below)
              </div>
              <div class="code-block" id="token-json">${tokenJson}</div>
              <button class="copy-btn" onclick="copyTokens()">Copy Token JSON</button>
            </div>
            ` : ''}

            <p style="text-align: center; margin-top: 40px; color: #666;">
              You can now close this window and return to Poke.
            </p>
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

  // Token validation endpoint (for debugging)
  app.get('/validate-token', async (req, res) => {
    // In multi-user mode, require userId or apiKey parameter
    let userId = 'default';
    let user: User | undefined;

    if (MULTI_USER_MODE) {
      const apiKey = req.query.apiKey as string || req.headers['x-api-key'] as string;
      const userIdParam = req.query.userId as string;

      if (apiKey) {
        user = getUserByApiKey(apiKey);
        if (!user) {
          return res.status(401).json({
            valid: false,
            error: 'Invalid API key'
          });
        }
        userId = user.userId;
      } else if (userIdParam) {
        userId = userIdParam;
      } else {
        return res.status(400).json({
          valid: false,
          error: 'In multi-user mode, provide apiKey or userId query parameter'
        });
      }
    }

    const tokenStore = tokenStores.get(userId) || {};

    if (!tokenStore.accessToken) {
      return res.json({
        valid: false,
        userId: userId !== 'default' ? userId : undefined,
        error: 'No token found. Visit /authorize to authenticate.'
      });
    }

    try {
      const client = new TwitterApi(tokenStore.accessToken);

      // Test 1: Get user info
      const me = await client.v2.me();

      // Test 2: Try to get bookmarks (this is what's failing)
      let bookmarksTest: { success: boolean; error: any } = { success: false, error: null };
      try {
        await client.v2.bookmarks({ max_results: 1 });
        bookmarksTest.success = true;
      } catch (error: any) {
        bookmarksTest.error = {
          code: error.code,
          message: error.message,
          data: error.data
        };
      }

      res.json({
        valid: true,
        userId: userId !== 'default' ? userId : undefined,
        user: {
          id: me.data.id,
          username: me.data.username,
          name: me.data.name
        },
        tokenInfo: {
          hasRefreshToken: !!tokenStore.refreshToken,
          expiresAt: tokenStore.expiresAt ? new Date(tokenStore.expiresAt).toISOString() : null,
          tokenLength: tokenStore.accessToken.length
        },
        bookmarksTest,
        message: bookmarksTest.success
          ? 'Token is valid and can access bookmarks'
          : 'Token is valid but cannot access bookmarks. Check app permissions and scopes.'
      });
    } catch (error: any) {
      res.json({
        valid: false,
        userId: userId !== 'default' ? userId : undefined,
        error: {
          code: error.code,
          message: error.message,
          data: error.data
        },
        message: 'Token is invalid or expired. Visit /authorize to re-authenticate.'
      });
    }
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
      console.error(`[MESSAGE] Transport exists:`, !!transport);
      
      // Ensure transport is still valid before processing
      if (!transport) {
        console.error(`[MESSAGE] ❌ Transport became invalid`);
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      
      // Handle the POST message with the transport
      // This will trigger the tool call handler which may take time
      // Wrap in AsyncLocalStorage context to make sessionId available to request handlers
      console.error(`[MESSAGE] Starting message processing...`);
      await sessionContext.run({ sessionId }, async () => {
        await transport.handlePostMessage(req, res, req.body);
      });
      console.error(`[MESSAGE] ✅ Message processing completed`);
    } catch (error: any) {
      console.error('[MESSAGE] ❌ Error handling message:', error.message);
      console.error('[MESSAGE] Error name:', error.name);
      console.error('[MESSAGE] Error stack:', error.stack);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Failed to process message',
          details: error.message 
        });
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
