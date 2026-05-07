---
name: web_search
description: Search the web, fetch pages, and extract information from websites
version: 1.0.0
triggers: search, find, google, lookup, web, fetch, scrape
---

# Web Search Skill

Advanced web search and content extraction capabilities.

## When to Use

- Search for information on the web
- Fetch and extract content from specific URLs
- Find current news, documentation, or tutorials
- Research topics before taking action

## Tools

### search
Search the web for information.
```bash
TOOL search {"query": "how to install nodejs", "type": "web", "maxResults": 5}
```

### web_fetch
Fetch a web page and extract content.
```bash
TOOL web.fetch {"url": "https://example.com", "selector": "article"}
```

### api_request
Make HTTP API calls for structured data.
```bash
TOOL api.request {"url": "https://api.github.com/users/username", "method": "GET"}
```

## Best Practices

1. **Be specific**: Use detailed search queries for better results
2. **Verify sources**: Cross-check important information
3. **Respect rate limits**: Don't spam requests
4. **Handle errors**: Check if pages exist before parsing
5. **Extract key info**: Focus on relevant content, not full pages

## Examples

### Research before coding
```
THINK: User wants to use a new library. I should research it first.
TOOL search {"query": "best practices for react hooks 2025"}
TOOL web.fetch {"url": "https://react.dev"}
```

### Find documentation
```
TOOL search {"query": "typescript readonly type documentation"}
```