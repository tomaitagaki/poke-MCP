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
import { randomBytes } from 'crypto';

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

// Load users from users.json file
let userStore: UserStore = { users: [] };

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

// Generate a cryptographically secure API key
function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

// Save users to users.json file
async function saveUsers(users: User[]): Promise<void> {
  try {
    const usersFilePath = join(process.cwd(), 'users.json');
    await fs.writeFile(usersFilePath, JSON.stringify({ users }, null, 2), 'utf-8');
    console.error('[AUTH] ✅ Users saved to users.json');
  } catch (error: any) {
    console.error('[AUTH] ❌ Error saving users:', error.message);
    throw error;
  }
}

// Add a new user
async function addUser(user: User): Promise<void> {
  // Check if user already exists
  const existingUser = userStore.users.find(u => u.userId === user.userId);
  if (existingUser) {
    throw new Error(`User ${user.userId} already exists`);
  }

  // Add user to store
  userStore.users.push(user);

  // Save to file
  await saveUsers(userStore.users);

  // Initialize empty token store for new user
  tokenStores.set(user.userId, {});
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

// Initialize token stores - Map of userId to TokenStore
const tokenStores: Map<string, TokenStore> = new Map();

// Load users and tokens on startup
loadUsers().then(async (store) => {
  userStore = store;

  // In multi-user mode, pre-load tokens for all users
  if (MULTI_USER_MODE) {
    for (const user of userStore.users) {
      try {
        const tokens = await loadTokens(user.userId);
        tokenStores.set(user.userId, tokens);
      } catch (err) {
        console.error(`[AUTH] Failed to load tokens for user ${user.userId}:`, err);
      }
    }
  } else {
    // Single-user mode - load tokens without userId
    const tokens = await loadTokens();
    tokenStores.set('default', tokens);
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

// Function to automatically update Render environment variable
async function updateRenderEnvVar(envVarName: string, value: string): Promise<boolean> {
  const renderApiKey = process.env.RENDER_API_KEY;
  const renderServiceId = process.env.RENDER_SERVICE_ID;

  if (!renderApiKey || !renderServiceId) {
    console.error('[RENDER] Missing RENDER_API_KEY or RENDER_SERVICE_ID - skipping auto-update');
    return false;
  }

  try {
    console.error(`[RENDER] Attempting to update environment variable: ${envVarName}`);

    // Render API endpoint to update environment variables
    const url = `https://api.render.com/v1/services/${renderServiceId}/env-vars`;

    // First, get existing env vars to check if we need to update or create
    const getResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${renderApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!getResponse.ok) {
      console.error('[RENDER] Failed to get existing env vars:', await getResponse.text());
      return false;
    }

    const existingVars = await getResponse.json() as any[];
    const existingVar = existingVars.find((v: any) => v.key === envVarName);

    let method = 'POST';
    let endpoint = url;

    if (existingVar) {
      // Update existing variable
      method = 'PUT';
      endpoint = `${url}/${existingVar.id}`;
    }

    // Create or update the environment variable
    const response = await fetch(endpoint, {
      method,
      headers: {
        'Authorization': `Bearer ${renderApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: envVarName,
        value: value,
      }),
    });

    if (response.ok) {
      console.error(`[RENDER] ✅ Successfully ${existingVar ? 'updated' : 'created'} environment variable: ${envVarName}`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[RENDER] ❌ Failed to update environment variable: ${errorText}`);
      return false;
    }
  } catch (error: any) {
    console.error('[RENDER] ❌ Error updating environment variable:', error.message);
    return false;
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

  // Registration page (GET)
  app.get('/register', async (req, res) => {
    if (!MULTI_USER_MODE) {
      return res.status(400).send('Registration is only available in multi-user mode');
    }

    res.send(`
      <html>
        <head>
          <title>Register for X MCP Server</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f7fa;
            }
            .container {
              background: white;
              border-radius: 12px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
              padding: 40px;
            }
            h1 {
              color: #1DA1F2;
              margin: 0 0 10px 0;
              font-size: 28px;
            }
            .subtitle {
              color: #657786;
              margin-bottom: 30px;
              font-size: 14px;
            }
            .form-group {
              margin-bottom: 20px;
            }
            label {
              display: block;
              margin-bottom: 6px;
              font-weight: 500;
              color: #14171a;
              font-size: 14px;
            }
            input {
              width: 100%;
              padding: 12px;
              border: 1px solid #e1e8ed;
              border-radius: 6px;
              font-size: 14px;
              box-sizing: border-box;
              transition: border-color 0.2s;
            }
            input:focus {
              outline: none;
              border-color: #1DA1F2;
            }
            .help-text {
              font-size: 12px;
              color: #657786;
              margin-top: 4px;
            }
            button {
              background: #1DA1F2;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
              font-weight: 600;
              width: 100%;
              transition: background 0.2s;
            }
            button:hover {
              background: #1a8cd8;
            }
            .info-box {
              background: #e8f5fd;
              border-left: 4px solid #1DA1F2;
              padding: 16px;
              border-radius: 6px;
              margin-bottom: 20px;
              font-size: 14px;
            }
            .info-box strong {
              color: #1565c0;
            }
            a {
              color: #1DA1F2;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Register New User</h1>
            <p class="subtitle">Connect your X (Twitter) developer account to get started</p>

            <div class="info-box">
              <strong>Before you start:</strong> You'll need an X Developer account with OAuth 2.0 credentials.
              <br><a href="https://developer.x.com/en/portal/dashboard" target="_blank">Get credentials →</a>
            </div>

            <form action="/register" method="POST">
              <div class="form-group">
                <label for="name">Your Name</label>
                <input type="text" id="name" name="name" required placeholder="John Doe">
                <div class="help-text">This is just for display purposes</div>
              </div>

              <div class="form-group">
                <label for="userId">User ID</label>
                <input type="text" id="userId" name="userId" required placeholder="johndoe" pattern="[a-z0-9_-]+" title="Lowercase letters, numbers, hyphens, and underscores only">
                <div class="help-text">Lowercase letters, numbers, hyphens, and underscores only</div>
              </div>

              <div class="form-group">
                <label for="xClientId">X OAuth 2.0 Client ID</label>
                <input type="text" id="xClientId" name="xClientId" required placeholder="Your X App Client ID">
                <div class="help-text">From your X Developer Portal</div>
              </div>

              <div class="form-group">
                <label for="xClientSecret">X OAuth 2.0 Client Secret</label>
                <input type="password" id="xClientSecret" name="xClientSecret" required placeholder="Your X App Client Secret">
                <div class="help-text">Keep this secret! It will be stored securely</div>
              </div>

              <div class="form-group">
                <label for="callbackUrl">Callback URL (Optional)</label>
                <input type="url" id="callbackUrl" name="callbackUrl" placeholder="${process.env.CALLBACK_URL || 'http://localhost:3000/callback'}">
                <div class="help-text">Leave blank to use default. Must match your X App settings.</div>
              </div>

              <button type="submit">Register & Authorize →</button>
            </form>
          </div>
        </body>
      </html>
    `);
  });

  // Registration handler (POST)
  app.post('/register', async (req, res) => {
    if (!MULTI_USER_MODE) {
      return res.status(400).json({ error: 'Registration is only available in multi-user mode' });
    }

    try {
      const { name, userId, xClientId, xClientSecret, callbackUrl } = req.body;

      // Validate required fields
      if (!name || !userId || !xClientId || !xClientSecret) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Validate userId format (lowercase, alphanumeric, hyphens, underscores)
      if (!/^[a-z0-9_-]+$/.test(userId)) {
        return res.status(400).json({
          error: 'Invalid userId format. Use only lowercase letters, numbers, hyphens, and underscores.'
        });
      }

      // Check if user already exists
      const existingUser = userStore.users.find(u => u.userId === userId);
      if (existingUser) {
        return res.status(409).json({ error: `User ${userId} already exists` });
      }

      // Generate API key
      const apiKey = generateApiKey();

      // Create new user
      const newUser: User = {
        userId,
        apiKey,
        name,
        xClientId,
        xClientSecret,
        callbackUrl: callbackUrl || process.env.CALLBACK_URL || 'http://localhost:3000/callback',
      };

      // Add user to store and save
      await addUser(newUser);

      console.error(`[REGISTER] ✅ New user registered: ${userId}`);

      // Store API key in session for callback page
      (global as any).pendingRegistrations = (global as any).pendingRegistrations || new Map();
      (global as any).pendingRegistrations.set(userId, apiKey);

      // Redirect to OAuth authorization with the new API key
      res.redirect(`/authorize?apiKey=${apiKey}&newUser=true`);
    } catch (error: any) {
      console.error('[REGISTER] ❌ Registration error:', error.message);
      res.status(500).json({ error: error.message });
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

      // Check if this is a new user registration
      const pendingRegs = (global as any).pendingRegistrations as Map<string, string> | undefined;
      const newUserApiKey = pendingRegs?.get(userId);
      const isNewUser = !!newUserApiKey;

      // Clean up pending registration after retrieving
      if (isNewUser && pendingRegs) {
        pendingRegs.delete(userId);
      }

      // Prepare token JSON for environment variable (for Render persistence)
      const tokenJson = JSON.stringify(newTokens);
      const envVarName = userId !== 'default' ? `X_OAUTH_TOKENS_${userId.toUpperCase()}` : 'X_OAUTH_TOKENS';
      const isRender = !!process.env.RENDER;

      // Try to automatically update Render environment variable
      let renderAutoUpdated = false;
      if (isRender) {
        renderAutoUpdated = await updateRenderEnvVar(envVarName, tokenJson);
      }

      res.send(`
        <html>
          <head>
            <title>Authorization Successful</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                max-width: 700px;
                margin: 50px auto;
                padding: 20px;
                background: #f5f7fa;
              }
              .container {
                background: white;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                padding: 40px;
              }
              h1 {
                color: #1DA1F2;
                margin: 0 0 30px 0;
                font-size: 28px;
              }
              .success {
                background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
                padding: 24px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #4caf50;
              }
              .success strong {
                color: #2e7d32;
                font-size: 18px;
              }
              .info-box {
                background: #f9fafb;
                padding: 16px;
                border-radius: 6px;
                margin: 16px 0;
                font-size: 14px;
              }
              .info-box strong {
                color: #1976d2;
              }
              .render-success {
                background: linear-gradient(135deg, #e3f2fd 0%, #e1f5fe 100%);
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #2196f3;
              }
              .render-success strong {
                color: #1565c0;
                font-size: 16px;
              }
              .warning {
                background: #fff8e1;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #ffa726;
              }
              .code-block {
                background: #263238;
                color: #aed581;
                padding: 12px;
                border-radius: 6px;
                overflow-x: auto;
                font-family: 'Monaco', 'Menlo', monospace;
                font-size: 12px;
                margin: 12px 0;
              }
              .copy-btn {
                background: #1DA1F2;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: background 0.2s;
              }
              .copy-btn:hover {
                background: #1a8cd8;
              }
              .close-text {
                text-align: center;
                margin-top: 30px;
                color: #78909c;
                font-size: 14px;
              }
              .detail {
                font-size: 14px;
                color: #546e7a;
                margin: 8px 0;
              }
              .check {
                color: #4caf50;
                margin-right: 8px;
              }
              .api-key-box {
                background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
                padding: 24px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #ff9800;
              }
              .api-key-box strong {
                color: #e65100;
                font-size: 18px;
              }
              .api-key-value {
                background: #fff;
                padding: 16px;
                border-radius: 6px;
                margin: 12px 0;
                font-family: 'Monaco', 'Menlo', monospace;
                font-size: 14px;
                word-break: break-all;
                border: 2px solid #ff9800;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Authorization Successful!</h1>

              <div class="success">
                <strong>Your X account is now connected!</strong>
                <p class="detail" style="margin-top: 12px; margin-bottom: 0;">
                  ${userId !== 'default' ? `<span class="check">✓</span>User: <strong>${userId}${user ? ` (${user.name})` : ''}</strong><br>` : ''}
                  <span class="check">✓</span>Tokens saved and ready to use<br>
                  <span class="check">✓</span>Auto-refresh enabled (valid for ${Math.floor(expiresIn / 3600)} hours)
                </p>
              </div>

              ${isNewUser ? `
              <div class="api-key-box">
                <strong>🔑 Your API Key (Save This!)</strong>
                <p class="detail" style="margin-top: 12px;">
                  This is your unique API key for connecting to the MCP server.
                  <strong>Save it now - it won't be shown again!</strong>
                </p>
                <div class="api-key-value" id="api-key">${newUserApiKey}</div>
                <button class="copy-btn" onclick="copyApiKey()">📋 Copy API Key</button>
                <p class="detail" style="margin-top: 12px; margin-bottom: 0;">
                  Use this API key in your MCP client configuration:<br>
                  <code>http://your-server-url/sse?apiKey=${newUserApiKey}</code>
                </p>
              </div>
              <script>
                function copyApiKey() {
                  const text = document.getElementById('api-key').textContent;
                  navigator.clipboard.writeText(text).then(() => {
                    alert('✅ API Key copied to clipboard!');
                  });
                }
              </script>
              ` : ''}

              ${isRender && renderAutoUpdated ? `
              <div class="render-success">
                <strong>🎉 Render Environment Variable Updated!</strong>
                <p class="detail" style="margin-top: 12px; margin-bottom: 0;">
                  Your tokens have been automatically saved to Render's environment variables
                  as <code>${envVarName}</code>. They will persist across service restarts.
                </p>
              </div>
              ` : ''}

              ${isRender && !renderAutoUpdated ? `
              <div class="warning">
                <strong>📋 Manual Setup Required</strong>
                <p class="detail">To persist tokens across restarts, add them to your Render environment variables:</p>
                <div class="info-box">
                  <strong>Variable Name:</strong><br>
                  <code>${envVarName}</code>
                </div>
                <button class="copy-btn" onclick="copyTokens()">📋 Copy Token Value</button>
                <div class="code-block" id="token-json" style="display: none;">${tokenJson}</div>
                <p class="detail" style="margin-top: 12px;">
                  Go to Render Dashboard → Your Service → Environment → Add Variable
                </p>
              </div>
              <script>
                function copyTokens() {
                  const text = document.getElementById('token-json').textContent;
                  navigator.clipboard.writeText(text).then(() => {
                    alert('✅ Token copied! Paste it into Render Dashboard → Environment Variables');
                  });
                }
              </script>
              ` : ''}

              <div class="close-text">
                You can now close this window and start using your X MCP Server
              </div>
            </div>
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
