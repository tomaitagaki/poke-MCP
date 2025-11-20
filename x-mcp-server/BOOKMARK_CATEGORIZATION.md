# Bookmark Categorization Tool

## Overview

The `categorize_bookmark` tool uses advanced LLM analysis (Claude 3.5 Sonnet) to automatically categorize and extract structured metadata from bookmarked tweets. This enables better knowledge management by organizing bookmarks with topic tags, actionable todos, and rich metadata suitable for knowledge graph integration.

## Purpose

When you bookmark tweets, you're often saving them for different reasons:
- Learning new concepts or technologies
- Action items to follow up on
- Reference materials for projects
- Interesting opinions or perspectives
- Tools or resources to explore

This tool helps you automatically organize and understand **why** you bookmarked something and **what you should do** with it.

## How It Works

### 1. Input Processing

The tool accepts:
- **tweet_id** (required): The ID of the tweet to categorize
- **tweet_text** (optional): The tweet content if already available
- **additional_context** (optional): Your personal notes on why you bookmarked this

If tweet text isn't provided, the tool automatically fetches it from the X API along with metadata like author, creation date, and engagement metrics.

### 2. LLM Analysis

The bookmark content is analyzed by Claude 3.5 Sonnet using a specialized prompt that evaluates:

#### Topic Tags
- **What**: 3-7 descriptive tags categorizing the main topics
- **How**: Analyzed based on keywords, context, and semantic meaning
- **Examples**: "machine-learning", "productivity-tips", "typescript", "devops"
- **Use Case**: Quick filtering and grouping of similar bookmarks

#### Actionable Todos
- **What**: Specific action items implied or explicitly mentioned in the content
- **How**: Identifies tasks like "read this article", "try this tool", "watch this video", "implement this technique"
- **Structure**: Each todo includes:
  - `task`: Clear description of what to do
  - `priority`: high, medium, or low (based on urgency signals)
  - `due_context`: When it should be done (e.g., "before next sprint", "when learning X")
- **Use Case**: Convert passive bookmarks into actionable task lists

#### Knowledge Graph Metadata

Structured data for integrating bookmarks into a larger knowledge management system:

##### Content Type
- **What**: Classification of the content format
- **Values**: article, tutorial, opinion, news, resource, tool, announcement, thread, question, etc.
- **How Determined**: Based on tweet structure, language patterns, and presence of links
- **Use Case**: Filter bookmarks by type (e.g., show only tutorials)

##### Key Concepts
- **What**: 3-5 main ideas or themes in the content
- **How Determined**: Extracted through semantic analysis of the core message
- **Examples**: "neural networks", "performance optimization", "team collaboration"
- **Use Case**: Concept-based search and relationship mapping

##### Related Domains
- **What**: Broader knowledge domains this content relates to
- **How Determined**: Maps specific topics to general fields
- **Examples**: "computer-science", "business-strategy", "design", "psychology"
- **Use Case**: Cross-domain discovery and learning path creation

##### Urgency
- **What**: Time-sensitivity of the content
- **Values**: high, medium, low, none
- **How Determined**: Based on:
  - Time-sensitive language ("breaking", "urgent", "deadline")
  - Temporal context ("this week", "Q4 2024")
  - Content nature (news vs. timeless concepts)
- **Use Case**: Prioritize which bookmarks to review first

##### Learning Value
- **What**: Educational benefit of the content
- **Values**: high, medium, low
- **How Determined**: Evaluated based on:
  - Depth of explanation
  - Presence of examples or tutorials
  - Novel vs. common knowledge
  - Actionability for skill development
- **Use Case**: Build curated learning paths

##### Entities
- **What**: Specific named entities mentioned in the content
- **Categories**:
  - `people`: Authors, experts, influencers mentioned
  - `companies`: Organizations, startups, projects
  - `technologies`: Programming languages, frameworks, protocols
  - `tools`: Software, services, platforms, libraries
- **How Determined**: Named entity recognition focusing on technology and professional contexts
- **Use Case**: Track mentions of specific tools/people, build entity relationship graphs

### 3. Output Structure

The tool returns a comprehensive JSON object:

```json
{
  "tweet_id": "1234567890",
  "tweet_text": "Just discovered this amazing...",
  "categorization": {
    "topic_tags": [
      "machine-learning",
      "python",
      "data-science",
      "tutorial"
    ],
    "actionable_todos": [
      {
        "task": "Read the linked tutorial on neural networks",
        "priority": "high",
        "due_context": "This weekend for current ML project"
      },
      {
        "task": "Star the GitHub repository mentioned",
        "priority": "low"
      }
    ],
    "metadata": {
      "content_type": "tutorial",
      "key_concepts": [
        "convolutional neural networks",
        "image classification",
        "transfer learning"
      ],
      "related_domains": [
        "artificial-intelligence",
        "computer-vision",
        "data-science"
      ],
      "urgency": "medium",
      "learning_value": "high",
      "entities": {
        "people": ["Andrew Ng", "Jeremy Howard"],
        "companies": ["OpenAI", "FastAI"],
        "technologies": ["PyTorch", "Python"],
        "tools": ["Jupyter", "Google Colab"]
      }
    }
  },
  "analyzed_at": "2025-11-18T20:30:00.000Z",
  "tweet_metadata": {
    "author_id": "123456",
    "created_at": "2025-11-18T10:00:00.000Z",
    "public_metrics": {
      "like_count": 150,
      "retweet_count": 45,
      "reply_count": 12
    }
  }
}
```

## Use Cases

### 1. Building a Personal Knowledge Graph

Integrate categorized bookmarks into graph databases (Neo4j, etc.):
- Nodes: Bookmarks, concepts, entities, domains
- Edges: Related topics, entity mentions, concept dependencies
- Queries: "Show me all ML tutorials mentioning PyTorch" or "What are my high-priority learning tasks?"

### 2. Smart Bookmark Management

- **Automatic tagging**: No manual categorization needed
- **Search enhancement**: Find bookmarks by concept, not just keywords
- **Deduplication**: Identify similar bookmarks via topic overlap

### 3. Task Management Integration

- Export actionable todos to task managers (Todoist, Notion, etc.)
- Prioritize learning based on urgency and value
- Track progress on bookmark-derived tasks

### 4. Learning Path Creation

- Group bookmarks by domain and difficulty
- Identify prerequisite relationships between concepts
- Build curriculum from saved resources

### 5. Research Organization

- Track literature and references by topic
- Map research landscapes (people, companies, technologies)
- Discover connections between different research areas

## Configuration

### Required Environment Variable

```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

Get your API key from [Anthropic Console](https://console.anthropic.com/).

### Model Used

Currently uses **Claude 3.5 Sonnet** (`claude-3-5-sonnet-20241022`) for optimal balance of:
- Analytical depth
- Structured output quality
- Speed and cost-efficiency
- Entity recognition accuracy

## Usage Example

### Basic Usage

```javascript
// Using the MCP tool
{
  "name": "categorize_bookmark",
  "arguments": {
    "tweet_id": "1234567890"
  }
}
```

### With Additional Context

```javascript
{
  "name": "categorize_bookmark",
  "arguments": {
    "tweet_id": "1234567890",
    "additional_context": "Saved this for the upcoming machine learning project at work"
  }
}
```

### Batch Processing Bookmarks

```javascript
// 1. Get all bookmarks
const bookmarks = await get_bookmarks({ max_results: 100 });

// 2. Categorize each bookmark
for (const bookmark of bookmarks.bookmarks) {
  const categorized = await categorize_bookmark({
    tweet_id: bookmark.id,
    tweet_text: bookmark.text  // Pass text to avoid re-fetching
  });

  // Store in your knowledge graph database
  await saveToKnowledgeGraph(categorized);
}
```

## Best Practices

### 1. Provide Additional Context

When you know why you bookmarked something, add context:
```javascript
{
  "tweet_id": "123",
  "additional_context": "Need this for Q1 performance optimization initiative"
}
```

This helps the LLM provide more relevant todos and urgency ratings.

### 2. Batch Processing

For large bookmark collections:
- Process in batches of 10-20 to manage API costs
- Cache results to avoid re-processing
- Use tweet_text when available to save X API calls

### 3. Regular Categorization

- Set up automated workflows to categorize new bookmarks daily
- Review and refine your knowledge graph weekly
- Archive or delete outdated bookmarks based on metadata

### 4. Integration Workflows

Example workflow with Notion/Airtable:
1. Fetch new bookmarks from X
2. Categorize with this tool
3. Create Notion pages with:
   - Title: Tweet author + snippet
   - Tags: Topic tags from categorization
   - Todo list: Actionable todos
   - Properties: All metadata fields
4. Link related concepts in your knowledge base

## Limitations

### Content Length
- Tweets are limited to 280 characters (or longer for threads)
- Analysis quality depends on content depth
- For threads, consider analyzing the full thread context

### Language Support
- Optimized for English content
- May work with other languages but with reduced accuracy
- Entity recognition best for English names/companies

### API Costs
- Each categorization uses ~500-1000 tokens
- Claude API costs apply per request
- Consider costs when batch-processing large collections

### Categorization Accuracy
- LLM analysis is probabilistic, not deterministic
- Same tweet may get slightly different tags on repeated analysis
- Review critical categorizations manually

## Future Enhancements

Potential improvements for v2:
- Thread-aware analysis (analyze full conversation context)
- Multi-language support with language detection
- Custom categorization schemes (user-defined taxonomies)
- Embedding generation for semantic similarity search
- Automatic bookmark clustering
- Trend detection across bookmark history
- Integration with specific knowledge graph databases

## Troubleshooting

### "No Anthropic API key" Error
Ensure `ANTHROPIC_API_KEY` is set in your `.env` file.

### Empty or Invalid Categorization
- Check that tweet_id is valid and accessible
- Verify the tweet has actual content (not just media)
- Review server logs for LLM response details

### Rate Limiting
- Anthropic has rate limits on API requests
- Implement exponential backoff for batch processing
- Consider upgrading API tier for higher throughput

## Support & Contributing

For questions, issues, or contributions related to bookmark categorization:
1. Check existing issues in the repository
2. Review the implementation in `src/index.ts` (search for `categorize_bookmark`)
3. Open an issue with example bookmarks and expected vs. actual output

---

**Note**: This tool is designed to augment human knowledge management, not replace it. Always review critical categorizations and adjust your knowledge graph as needed.
