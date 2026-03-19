# Architecture Overview

This document describes the high-level architecture of the **ADO Work Item Generator** VS Code extension, including its component structure, data flow, and key design decisions.

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Component Diagram](#component-diagram)
3. [Data Flow](#data-flow)
4. [Key Design Decisions](#key-design-decisions)
5. [Dependency Graph](#dependency-graph)
6. [State Management](#state-management)
7. [Error Handling Strategy](#error-handling-strategy)

---

## High-Level Overview

ADO Work Item Generator is a **single-file VS Code Chat Participant extension** written in plain JavaScript. It integrates with **GitHub Copilot** through VS Code's built-in Language Model (LM) API and uses **LangChain Core** to orchestrate a two-step AI pipeline.

```
User (GitHub Copilot Chat)
        │
        ▼
  VS Code Chat API
        │
        ▼
  Chat Participant Handler  ──► Input Parser
        │                             │
        ▼                             ▼
  generateWorkItems()         changeRequest object
        │
        ├──── Step 1: complexityChain
        │           │
        │           ▼
        │     LangChain PromptTemplate (complexityAnalysisTemplate)
        │           │
        │           ▼
        │     VSCodeLanguageModel.invoke()
        │           │
        │           ▼
        │     GitHub Copilot (vscode.lm)
        │           │
        │           ▼
        │     numStories (integer 2–8)
        │
        └──── Step 2: workItemChain
                    │
                    ▼
              LangChain PromptTemplate (workItemGenerationTemplate)
                    │
                    ▼
              VSCodeLanguageModel.invoke()
                    │
                    ▼
              GitHub Copilot (vscode.lm)
                    │
                    ▼
              Structured JSON (EPIC + User Stories)
                          │
              ┌───────────┴──────────────┐
              ▼                          ▼
    formatWorkItemsForChat()        lastGeneratedWorkItems
              │                          │
              ▼                          ▼
    Chat stream output            downloadCSV() command
                                         │
                                         ▼
                                   convertToCSV()
                                         │
                                         ▼
                                 CSV file (temp dir)
```

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        extension.js                             │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │    VSCodeLanguageModel       │  Wraps vscode.lm API          │
│  │  ─────────────────────────  │  Lazy-initialises Copilot      │
│  │  constructor(token)          │  model on first call          │
│  │  initialize()                │                               │
│  │  invoke(prompt) → string     │                               │
│  └──────────────────────────────┘                               │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │   Prompt Templates           │  LangChain PromptTemplate     │
│  │  ─────────────────────────  │  objects with input variable  │
│  │  complexityAnalysisTemplate  │  substitution                 │
│  │  workItemGenerationTemplate  │                               │
│  └──────────────────────────────┘                               │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │  createWorkItemGenerationChain(token)                        │
│  │  ─────────────────────────  │                               │
│  │  Returns:                    │  Builds two RunnableLambda    │
│  │    complexityChain           │  chains sharing one LLM       │
│  │    workItemChain             │  instance                     │
│  └──────────────────────────────┘                               │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │  generateWorkItems(req, tok) │  Orchestrates the two-step   │
│  │  ─────────────────────────  │  pipeline; stores result in  │
│  │  → workItems JSON            │  lastGeneratedWorkItems       │
│  └──────────────────────────────┘                               │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │  formatWorkItemsForChat()    │  Converts JSON → Markdown     │
│  │  convertToCSV()              │  Converts JSON → CSV string   │
│  │  downloadCSV()               │  Writes CSV file; opens it    │
│  └──────────────────────────────┘                               │
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │  activate(context)           │  VS Code extension entry      │
│  │  deactivate()                │  point; registers participant │
│  └──────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Input Parsing

Raw text from the chat window is split on newlines and each line is parsed for `Key: Value` pairs. The resulting `changeRequest` object has four fields:

| Field                | Source key patterns                              | Default      |
|----------------------|--------------------------------------------------|--------------|
| `changeRequestType`  | `type`, `changerequest`                          | `''`         |
| `title`              | `title`                                          | `''`         |
| `description`        | `description`                                    | `''`         |
| `additionalComments` | `comment`, `additional`                          | `'None'`     |

### 2. Complexity Analysis (Step 1)

```
changeRequest  →  complexityAnalysisTemplate.format()
              →  VSCodeLanguageModel.invoke(formattedPrompt)
              →  response string (e.g. "4")
              →  parseInt()  →  numStories (2–8)
```

### 3. Work Item Generation (Step 2)

```
{ ...changeRequest, numStories }
              →  workItemGenerationTemplate.format()
              →  VSCodeLanguageModel.invoke(formattedPrompt)
              →  response string (JSON, possibly wrapped in ```json fences)
              →  cleanResponse (markdown fences stripped)
              →  JSON.parse()  →  workItems
              →  stored in lastGeneratedWorkItems
```

### 4. Chat Output

```
workItems  →  formatWorkItemsForChat()  →  Markdown string
           →  stream.markdown()  →  displayed in Copilot Chat
```

### 5. CSV Export

```
lastGeneratedWorkItems  →  convertToCSV()  →  CSV string
                        →  fs.writeFileSync(tempPath)
                        →  vscode.env.openExternal(uri)
```

---

## Key Design Decisions

### Pure JavaScript (no TypeScript build step)
The extension is written as CommonJS JavaScript (`require` / `module.exports`). This means **no compilation is needed** – VS Code loads `extension.js` directly. This lowers the barrier for contributions and removes build toolchain complexity.

### No External Backend
All AI processing is delegated to **GitHub Copilot via `vscode.lm`**, which is already available inside VS Code. No separate server, API key, or network configuration is required beyond an active Copilot subscription.

### LangChain for Prompt Management
[LangChain Core](https://www.npmjs.com/package/@langchain/core) is used for its `PromptTemplate` (variable substitution in prompt strings) and `RunnableLambda` (wrapping async functions as pipeline stages). This keeps prompt definitions declarative and separate from the orchestration logic.

### Two-Step Pipeline
Splitting generation into **(a) complexity analysis → (b) work item generation** produces better results than a single prompt. The first call produces a concrete number (2–8) that constrains the second call, reducing hallucinated story counts.

### Global `lastGeneratedWorkItems`
After successful generation, the work items are stored in a module-level variable so the `downloadCSV` command can access them without needing to regenerate. This is intentionally simple; a production extension might store this in `context.workspaceState`.

---

## Dependency Graph

```
extension.js
├── vscode              (built-in – provided by VS Code runtime)
├── @langchain/core
│   ├── /prompts        → PromptTemplate
│   └── /runnables      → RunnableLambda
├── fs                  (Node.js built-in)
├── path                (Node.js built-in)
└── os                  (Node.js built-in)
```

---

## State Management

The extension is largely stateless between activations. The only runtime state is:

| Variable                 | Scope        | Purpose                                              |
|--------------------------|--------------|------------------------------------------------------|
| `lastGeneratedWorkItems` | Module-level | Caches the most recent work-item result for CSV export |
| `VSCodeLanguageModel.model` | Instance-level | Lazy-loaded Copilot model reference; re-used across calls within one activation |

---

## Error Handling Strategy

| Layer                    | Failure condition                           | Handling                                              |
|--------------------------|---------------------------------------------|-------------------------------------------------------|
| Chat participant handler | Copilot unavailable                         | Streams `❌` message; early return                    |
| Input parser             | Missing required fields                     | Streams `❌` with usage instructions; early return    |
| `generateWorkItems`      | Model returns out-of-range story count      | Throws with descriptive message                       |
| `generateWorkItems`      | Model returns malformed JSON                | Strips markdown fences; throws parse error on failure |
| `VSCodeLanguageModel`    | Any LM API error                            | Logs and re-throws; caught by outer handler           |
| `downloadCSV`            | No work items cached / file-system error    | `showErrorMessage` notification                       |
