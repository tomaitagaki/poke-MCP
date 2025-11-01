# X MCP Server - Tools Reference

Quick reference for all available tools and their usage.

---

## 📝 Post Management

### `post_tweet`
Post a new tweet to your X account.

**Parameters:**
- `text` (required, string): Tweet content (max 280 characters)
- `reply_to_tweet_id` (optional, string): ID of tweet to reply to

**Examples:**
```json
// Simple tweet
{
  "text": "Hello World! 🌍"
}

// Reply to a tweet
{
  "text": "Great point!",
  "reply_to_tweet_id": "1234567890123456789"
}

// Thread continuation
{
  "text": "This is part 2 of my thread...",
  "reply_to_tweet_id": "your_previous_tweet_id"
}
```

**Response:**
```json
{
  "success": true,
  "tweet_id": "1234567890123456789",
  "text": "Hello World! 🌍"
}
```

---

## 🔖 Bookmarks

### `get_bookmarks`
Retrieve your saved/bookmarked tweets.

**Parameters:**
- `max_results` (optional, number): Results per page (5-100, default: 10)
- `pagination_token` (optional, string): Token for next page

**Example:**
```json
{
  "max_results": 20
}
```

**Response:**
```json
{
  "bookmarks": [
    {
      "id": "1234567890",
      "text": "Interesting tweet...",
      "created_at": "2025-01-15T10:30:00.000Z",
      "author_id": "987654321",
      "public_metrics": {
        "retweet_count": 42,
        "like_count": 156
      }
    }
  ],
  "meta": {
    "result_count": 20,
    "next_token": "abc123..."
  }
}
```

### `add_bookmark`
Save a tweet to your bookmarks.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to bookmark

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "success": true,
  "bookmarked": true
}
```

### `remove_bookmark`
Remove a tweet from your bookmarks.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to remove

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "success": true,
  "bookmarked": false
}
```

---

## 📱 Timeline

### `get_home_timeline`
Get tweets from your home timeline (from accounts you follow).

**Parameters:**
- `max_results` (optional, number): Results per page (5-100, default: 10)
- `pagination_token` (optional, string): Token for next page

**Example:**
```json
{
  "max_results": 10
}
```

**Response:**
```json
{
  "tweets": [
    {
      "id": "1234567890",
      "text": "Tweet content...",
      "created_at": "2025-01-15T10:30:00.000Z",
      "author_id": "987654321"
    }
  ],
  "meta": {
    "result_count": 10,
    "next_token": "xyz789..."
  }
}
```

### `get_user_tweets`
Get tweets from your timeline or another user's timeline.

**Parameters:**
- `user_id` (optional, string): User ID (defaults to authenticated user)
- `max_results` (optional, number): Results per page (5-100, default: 10)
- `pagination_token` (optional, string): Token for next page

**Examples:**
```json
// Your own tweets
{
  "max_results": 20
}

// Another user's tweets
{
  "user_id": "123456789",
  "max_results": 10
}
```

---

## ❤️ Engagement - Likes

### `like_tweet`
Like a tweet.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to like

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "success": true,
  "liked": true
}
```

### `unlike_tweet`
Unlike a tweet.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to unlike

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "success": true,
  "liked": false
}
```

---

## 🔄 Engagement - Retweets

### `retweet`
Retweet a tweet.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to retweet

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "success": true,
  "retweeted": true
}
```

### `unretweet`
Remove a retweet.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to unretweet

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "success": true,
  "retweeted": false
}
```

---

## 🔍 Search & Lookup

### `get_tweet`
Get details about a specific tweet.

**Parameters:**
- `tweet_id` (required, string): ID of tweet to retrieve

**Example:**
```json
{
  "tweet_id": "1234567890123456789"
}
```

**Response:**
```json
{
  "data": {
    "id": "1234567890123456789",
    "text": "Tweet content here...",
    "created_at": "2025-01-15T10:30:00.000Z",
    "author_id": "987654321",
    "conversation_id": "1234567890123456789",
    "public_metrics": {
      "retweet_count": 10,
      "reply_count": 5,
      "like_count": 50,
      "quote_count": 2
    }
  }
}
```

### `search_tweets`
Search for tweets using X search operators.

**Parameters:**
- `query` (required, string): Search query
- `max_results` (optional, number): Results per page (10-100, default: 10)

**Examples:**
```json
// Simple keyword search
{
  "query": "MCP protocol",
  "max_results": 20
}

// Advanced search with operators
{
  "query": "from:elonmusk has:media",
  "max_results": 10
}

// Search with filters
{
  "query": "#AI lang:en -is:retweet",
  "max_results": 50
}
```

**Search Operators:**
- `from:username` - Tweets from specific user
- `to:username` - Replies to specific user
- `@username` - Mentions of user
- `#hashtag` - Tweets with hashtag
- `has:media` - Tweets with images/videos
- `has:links` - Tweets with URLs
- `is:retweet` - Only retweets
- `-is:retweet` - Exclude retweets
- `lang:en` - Language filter
- `"exact phrase"` - Exact phrase match

**Response:**
```json
{
  "tweets": [
    {
      "id": "1234567890",
      "text": "Matching tweet...",
      "created_at": "2025-01-15T10:30:00.000Z",
      "author_id": "987654321",
      "public_metrics": {
        "retweet_count": 5,
        "like_count": 20
      }
    }
  ],
  "meta": {
    "result_count": 10,
    "newest_id": "1234567890",
    "oldest_id": "1234567880"
  }
}
```

---

## 📊 Rate Limits

Be aware of X API rate limits:

| Endpoint | Rate Limit |
|----------|-----------|
| `get_bookmarks` | 180 requests / 15 min |
| `add_bookmark` / `remove_bookmark` | 50 requests / 15 min |
| `post_tweet` | Varies by access level |
| `search_tweets` | Varies by access level |
| Timelines | Varies by endpoint |
| Likes/Retweets | 50 requests / 15 min |

---

## 💡 Common Workflows

### 1. Post a Thread
```javascript
// Post initial tweet
const tweet1 = await post_tweet({ text: "Thread 1/3: ..." });

// Reply to create thread
const tweet2 = await post_tweet({
  text: "2/3: ...",
  reply_to_tweet_id: tweet1.tweet_id
});

const tweet3 = await post_tweet({
  text: "3/3: ...",
  reply_to_tweet_id: tweet2.tweet_id
});
```

### 2. Save Interesting Tweets from Search
```javascript
// Search for relevant tweets
const results = await search_tweets({
  query: "#AI lang:en has:media",
  max_results: 20
});

// Bookmark interesting ones
for (const tweet of results.tweets) {
  await add_bookmark({ tweet_id: tweet.id });
}
```

### 3. Engage with Home Timeline
```javascript
// Get latest tweets
const timeline = await get_home_timeline({ max_results: 10 });

// Like and retweet
for (const tweet of timeline.tweets) {
  await like_tweet({ tweet_id: tweet.id });
  await retweet({ tweet_id: tweet.id });
}
```

### 4. Review and Clean Bookmarks
```javascript
// Get all bookmarks
const bookmarks = await get_bookmarks({ max_results: 100 });

// Review and remove unwanted ones
for (const tweet of bookmarks.bookmarks) {
  if (shouldRemove(tweet)) {
    await remove_bookmark({ tweet_id: tweet.id });
  }
}
```

---

## 🚨 Error Handling

Common errors and solutions:

**429 - Rate Limit Exceeded**
```json
{
  "error": "X API Error: Rate limit exceeded",
  "code": 429
}
```
→ Wait 15 minutes before retrying

**401 - Unauthorized**
```json
{
  "error": "X API Error: Invalid credentials",
  "code": 401
}
```
→ Check API credentials in `.env`

**403 - Forbidden**
```json
{
  "error": "X API Error: Forbidden",
  "code": 403
}
```
→ Check app permissions and token scopes

**404 - Not Found**
```json
{
  "error": "Tweet not found",
  "code": 404
}
```
→ Verify tweet ID is correct

---

## 📚 Additional Resources

- [X API Documentation](https://developer.x.com/en/docs/x-api)
- [Search Operators Guide](https://developer.x.com/en/docs/twitter-api/tweets/search/integrate/build-a-query)
- [Rate Limits](https://developer.x.com/en/docs/twitter-api/rate-limits)
- [MCP Protocol](https://modelcontextprotocol.io)
