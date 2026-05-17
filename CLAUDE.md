# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VS Code extension that integrates with Jira to classify support tickets and generate monitoring links. The classifier uses an LLM (GitHub Copilot) to analyze ticket descriptions and matches them against diagnostic rules. Two classification modes are supported:

- **Legacy Mode**: Keyword-based matching against JSON prompt templates in VS Code settings
- **Markdown + LLM Mode**: Parallel relevance scoring of Markdown diagnostic files, then full analysis with the highest-scoring file

The extension runs as a background polling service, automatically fetching tickets via JQL, classifying them, and posting analysis + monitoring URLs back to Jira as comments.

## Key Architecture Concepts

### Two Classification Modes

The `promptsDirectory` setting determines which mode is active:

- **Empty `promptsDirectory` → Legacy Mode**: Uses `classifierPrompts` JSON array from settings. Keywords in ticket description are matched against classifier keywords; the classifier with most matches is selected.
- **Configured `promptsDirectory` → Markdown Mode**: Loads all `.md` files from the directory. Each file is scored in parallel by the LLM based on relevance to the ticket. The highest-scoring file (if above threshold) provides context for the full analysis.

See `CLASSIFICATION_MODES.md` for a visual comparison.

### Data Flow

```
Jira Ticket (via JQL)
  ↓
ConfigManager (reads VS Code settings)
  ↓
SecretManager (retrieves stored API token)
  ↓
JiraService (fetches tickets)
  ↓
PromptLoader (loads classifiers/markdown files)
  ↓
ClassifierEngine (selects best prompt via keyword match or LLM scoring)
  ↓
LlmService (calls GitHub Copilot via VS Code)
  ↓
CommentBuilder (formats analysis + URLs)
  ↓
UrlBuilder (generates Grafana/Kibana links)
  ↓
JiraService (posts comment to ticket)
```

### Markdown File Format

Diagnostic files (`.md`) contain YAML frontmatter + Markdown body:

```markdown
---
id: auth-failure
label: Authentication Failure
classification: AUTHENTICATION_ERROR
grafanaDashboard: /d/auth-dashboard
kibanaDashboard: /app/discover#/?_a=(query:...)
---

## Diagnostic Content

Text describing symptoms, causes, and debugging steps. This is sent to the LLM for scoring.
```

The LLM scores relevance 0–100 based on the full markdown content. Only files exceeding `scoreThreshold * 100` are used.

## Common Development Commands

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (recommended during development)
npm run watch

# Run linter
npm run lint

# Run tests
npm test

# Package as .vsix for distribution
npx vsce package
```

To test the extension locally, run the watch task and press F5 in VS Code to launch the extension debug session.

## File Structure

```
src/
  config/           ConfigManager — reads & validates VS Code settings
  core/             Classification logic
    ClassifierEngine.ts       Orchestrates both modes (legacy & markdown)
    PromptLoader.ts           Loads .md files or JSON classifiers
    UrlBuilder.ts             Constructs Grafana/Kibana URLs
    CommentBuilder.ts         Formats analysis comments for Jira
  services/         External integrations
    JiraService.ts            Jira API (fetch tickets, post comments)
    LlmService.ts             GitHub Copilot via VS Code LLM API
    SecretManager.ts          Secure token storage via context.secrets
  support/          Polling & coordination
    SupportController.ts      Manages polling interval, ticket processing cycle
  ui/               WebView UI
    TicketPanel.ts            Sidebar panel showing ticket list & status
  extension.ts      Entry point — registers commands, initializes services
  types.ts          Shared interfaces (Ticket, TicketResult, etc.)
```

## Key Implementation Details

### ClassifierEngine (Core Logic)

Detects mode automatically:
1. If `promptsDirectory` is configured → calls `scoreMarkdownPrompts()` (parallel LLM scoring)
2. Else → calls `scoreKeywordPrompts()` (keyword matching)

In Markdown mode, `Promise.all()` sends all `.md` files to the LLM concurrently. The highest score wins if ≥ threshold.

### PromptLoader (Markdown Support)

- `loadMarkdownPrompts()` recursively reads `.md` files, parses YAML frontmatter via `matter`, and builds Prompt objects
- Filters to only `.md` files; skips non-files and nested directories
- Called on each analysis cycle; no caching of file content

### LlmService (Copilot Integration)

Uses VS Code's built-in LLM API (`vscode.lm.selectChatModels()`). Requires GitHub Copilot extension to be installed. Messages are sent as plain text; responses are parsed for JSON analysis and numeric scores.

### SupportController (Polling)

Runs a polling loop at `pollingIntervalMinutes` intervals. Each cycle:
1. Fetches tickets from Jira via JQL
2. Filters to unprocessed tickets (checked via Jira comments)
3. Calls ClassifierEngine for each ticket
4. Builds comment with analysis + URLs
5. Posts comment to Jira
6. Updates UI

Polling can be started/stopped via commands. No persistence of state; restart will reprocess tickets.

### SecretManager (Token Storage)

Wraps `context.secrets` (VS Code's secure key-value store). Stores the Jira API token on first run (prompted via input box). Token is never written to disk in plaintext.

## Configuration

All settings are in `package.json` under `contributes.configuration.properties`. Users configure via VS Code Settings UI or `settings.json`:

| Setting | Type | Purpose |
|---------|------|---------|
| `jiraClassifier.jiraUrl` | string | Jira instance base URL (e.g., `https://myco.atlassian.net`) |
| `jiraClassifier.jiraEmail` | string | Jira user email for API auth |
| `jiraClassifier.jiraProject` | string | Jira project key (e.g., `BANK`) |
| `jiraClassifier.jiraJql` | string | JQL query to fetch tickets |
| `jiraClassifier.promptsDirectory` | string | Path to directory with `.md` diagnostic files (empty = Legacy mode) |
| `jiraClassifier.classifierPrompts` | array | Legacy mode: JSON classifiers with keywords, prompts, required fields |
| `jiraClassifier.scoreThreshold` | number | Min relevance score (0.0–1.0). In Markdown mode, multiplied by 100 for LLM scores |
| `jiraClassifier.grafanaBaseUrl` | string | Grafana base URL for dashboard links |
| `jiraClassifier.kibanaBaseUrl` | string | Kibana base URL for log links |
| `jiraClassifier.pollingIntervalMinutes` | number | Polling frequency |
| `jiraClassifier.promptsDocumentation` | string | Optional: Path to project documentation file to include in LLM context |

ConfigManager validates that required settings are filled. Missing values will trigger warnings on activation.

## Important Patterns

### Async/Await in Extension

All async operations (file I/O, API calls, LLM requests) use `async/await`. No `.then()` chains. Errors are logged to the output channel and, where critical, shown to the user via `showErrorMessage`.

### No External Dependencies in Core

Minimal npm dependencies (only `@types/node`, `@types/vscode`, `@typescript-eslint/*`). No axios, lodash, or npm packages for HTTP — VS Code APIs are used directly.

### Jira API Calls

JiraService uses `vscode.Uri.from()` to build REST URLs and `fetch()` with Authorization header (Base64 of email:token). Responses are parsed as JSON. Error handling checks for `response.ok` before parsing.

### Output Channel Logging

All logging goes to the `Jira Classifier` output channel with timestamps. The extension doesn't use console.log; output is invisible otherwise. Key events (ticket processing, LLM scores, errors) are logged for debugging.

### TypeScript Strict Mode

`tsconfig.json` has `"strict": true`. All types must be explicit; no `any` unless necessary. Interfaces for Jira API responses (`Ticket`) and internal models (`TicketResult`) are in `types.ts`.

## Testing

The `test/` directory contains a sample test runner. Tests can be added as `.test.ts` files. Run via `npm test`, which first compiles and lints.

## Debugging Tips

- Check the `Jira Classifier` output channel for logs with timestamps and function names
- Temporarily increase logging by adding calls to `logger()` in key functions
- Use the "Jira Classifier: Limpiar cache y reanalizar" command to force reprocessing
- In Markdown mode, scores are logged per file; if unexpectedly low, check the `.md` file content and adjust `scoreThreshold`
- If Copilot is not responding, ensure the GitHub Copilot extension is installed in VS Code
