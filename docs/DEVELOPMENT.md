# Development Guide

This guide explains how to set up a local development environment, run and debug the extension, understand the project layout, and extend the codebase.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Getting Started](#getting-started)
4. [Running and Debugging](#running-and-debugging)
5. [How to Test Changes Manually](#how-to-test-changes-manually)
6. [Modifying the LangChain Pipeline](#modifying-the-langchain-pipeline)
7. [Adding a New Command](#adding-a-new-command)
8. [Updating Dependencies](#updating-dependencies)
9. [Code Style Conventions](#code-style-conventions)
10. [Common Development Issues](#common-development-issues)

---

## Prerequisites

| Requirement | Minimum version | Notes |
|-------------|-----------------|-------|
| [Node.js](https://nodejs.org/) | 18 LTS | Used to install npm packages |
| [VS Code](https://code.visualstudio.com/) | 1.102.0 | Defined in `package.json → engines.vscode` |
| [GitHub Copilot extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) | Latest | Required at runtime; not a dev dependency |
| Active GitHub Copilot subscription | — | The LM API will return zero models without it |

---

## Project Structure

```
ado-generator/
├── docs/
│   ├── ARCHITECTURE.md       # Component diagram and data flow
│   ├── API.md                # Complete function/class reference
│   ├── CSV-FORMAT.md         # CSV schema, escaping rules, example
│   ├── DEVELOPMENT.md        # This file
│   └── LANGCHAIN-PIPELINE.md # Deep dive into the two-step pipeline
├── extension.js              # All production logic (single file)
├── package.json              # Extension manifest and npm metadata
├── package-lock.json         # Locked dependency tree
├── .gitignore
└── README.md                 # Quick-start overview
```

The extension intentionally lives in a **single file** (`extension.js`). This removes the need for a build step and keeps the project easy to understand and modify.

---

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/syedimty/ado-generator.git
cd ado-generator

# 2. Install npm dependencies
npm install

# 3. Open the folder in VS Code
code .
```

---

## Running and Debugging

### Launch the Extension Development Host

Press **F5** inside VS Code (or choose **Run → Start Debugging** from the menu). This opens a second VS Code window — the **Extension Development Host** — which has your local `extension.js` loaded.

The extension activates automatically on startup (`"activationEvents": ["onStartupFinished"]`), so you do not need to run any command to initialise it.

### Use the Chat Participant

In the Extension Development Host window:

1. Open **GitHub Copilot Chat** with `Ctrl+Alt+I` (Windows/Linux) or `Cmd+Ctrl+I` (macOS).
2. Type `@ado-workitem` and provide your change request:

```
@ado-workitem
ChangeRequestType: New Feature
Title: User Authentication System
Description: Implement login, registration, and password reset
Additional Comments: Must support OAuth providers
```

3. Wait for the two-step pipeline to complete. Progress indicators appear while each step runs.

### View Debug Output

All `console.log` and `console.error` calls in `extension.js` are visible in the **Debug Console** of the host VS Code window (the one you launched with F5), not the Extension Development Host window.

Key log messages to look out for:

| Message | What it means |
|---------|---------------|
| `Initializing VS Code Language Model...` | First call to `VSCodeLanguageModel.initialize()` |
| `Model initialized: <name>` | Copilot model selected successfully |
| `Complexity analysis response: <n>` | Step 1 complete; shows the story count |
| `Work items response received, parsing...` | Step 2 complete; JSON being parsed |
| `LangChain work item generation completed successfully` | Full pipeline succeeded |

### Reload After Code Changes

After editing `extension.js`, use **Ctrl+R** (or `Cmd+R`) in the Extension Development Host window to reload the extension. Alternatively, stop (F5) and restart the debug session.

---

## How to Test Changes Manually

There are no automated tests in this repository. Manual verification is the primary testing method.

### Checklist for Testing a Code Change

1. **Happy path** – provide a complete, valid change request and confirm a properly formatted EPIC + User Stories is displayed in chat.
2. **Missing fields** – omit `Title` and confirm the `❌ Missing required fields` error message is shown.
3. **Empty prompt** – send `@ado-workitem` with no text and confirm the usage instructions are displayed.
4. **CSV export** – after a successful generation, run `ADO Work Item Generator: Download Work Items CSV` from the command palette and confirm the file opens with correct content.
5. **CSV before generation** – run the CSV command before generating any work items and confirm the `'No work items to export'` notification appears.

---

## Modifying the LangChain Pipeline

### Changing the Complexity Analysis Prompt

Edit `complexityAnalysisTemplate` in `extension.js`. The template uses `{variableName}` placeholders. The list of allowed variables is declared in the `inputVariables` array:

```js
const complexityAnalysisTemplate = new PromptTemplate({
    template: `... {changeRequestType} ... {title} ...`,
    inputVariables: ['changeRequestType', 'title', 'description', 'additionalComments']
});
```

> **Important:** If you add a new `{variable}` to the template string, you must also add its name to `inputVariables`, otherwise LangChain will throw a validation error at runtime.

### Changing the Work Item Generation Prompt

Edit `workItemGenerationTemplate` similarly. The JSON schema embedded in this prompt defines the shape of the data returned by `generateWorkItems`. If you change the schema (e.g. add a new field to user stories), you must also update:

- `formatWorkItemsForChat` – to render the new field in chat output
- `convertToCSV` + `csvHeaders` – to include the new field in the CSV export
- [API.md](./API.md) and [CSV-FORMAT.md](./CSV-FORMAT.md) – to document the change

### Adding a New Pipeline Step

To insert a third step (e.g. a validation or enrichment step):

1. Create a new `PromptTemplate` constant.
2. Add a new `RunnableLambda` in `createWorkItemGenerationChain`.
3. Call `.invoke()` on the new chain inside `generateWorkItems`, passing the output of the previous step as input.

---

## Adding a New Command

1. **Register the command in `package.json`:**

```json
"commands": [
  {
    "command": "ado-workitem-generator.myNewCommand",
    "title": "My New Command"
  }
]
```

2. **Implement the handler function** in `extension.js`:

```js
async function myNewCommand() {
    // implementation
}
```

3. **Register the handler** inside `activate()`:

```js
const myCmd = vscode.commands.registerCommand('ado-workitem-generator.myNewCommand', myNewCommand);
context.subscriptions.push(myCmd);
```

4. **Reload the Extension Development Host** (`Ctrl+R` in the host window) and run the command via the command palette.

---

## Updating Dependencies

The project has one production dependency and one dev dependency:

| Package             | Current version | Purpose                                  |
|---------------------|-----------------|------------------------------------------|
| `@langchain/core`   | `^0.1.0`        | `PromptTemplate`, `RunnableLambda`       |
| `@types/vscode`     | `^1.85.0`       | VS Code type definitions (dev only)      |

To update:

```bash
npm update @langchain/core
npm update @types/vscode --save-dev
```

After updating, restart the debug session (F5) and run through the manual test checklist to confirm nothing is broken.

---

## Code Style Conventions

- **No build step**: keep the project as CommonJS JavaScript. Do not introduce TypeScript or a bundler.
- **No semicolons controversy**: the existing code uses semicolons consistently — continue this pattern.
- **`async/await`** for all asynchronous code; no raw Promise chains.
- **`console.log`** for progress tracing; **`console.error`** for error details. These are visible in the Debug Console.
- **Single responsibility**: each exported/module-level function has one clear job. Avoid mixing prompt formatting with CSV serialisation, for example.
- **Error messages** shown to the user (via `stream.markdown` or `vscode.window.showErrorMessage`) should start with `❌` and provide actionable guidance.

---

## Common Development Issues

### GitHub Copilot not available in the Extension Development Host

**Symptom:** The chat participant responds with `❌ GitHub Copilot not available`.

**Cause:** The Extension Development Host inherits your GitHub Copilot authentication from the parent VS Code window. If you are not signed in, or Copilot is not installed in the parent window, it will not be available.

**Fix:** In the **parent** VS Code window, confirm:
- GitHub Copilot extension is installed and enabled.
- You are signed in to GitHub (`Accounts` icon in the activity bar).
- Your Copilot subscription is active.

Then press **F5** again.

---

### `No module named '@langchain/core'`

**Symptom:** The extension fails to activate with a `Cannot find module` error.

**Fix:** Run `npm install` in the repository root and restart the debug session.

---

### Changes to `extension.js` are not reflected

**Symptom:** Your edits do not appear to take effect in the Extension Development Host.

**Fix:** VS Code does not hot-reload extension code. Press **Ctrl+R** (or `Cmd+R`) in the Extension Development Host window, or stop and restart the debug session with **F5**.

---

### JSON parse error in chat

**Symptom:** The chat participant responds with `❌ Error generating work items: Failed to parse work items response`.

**Cause:** The Copilot model returned text that is not valid JSON (e.g. it included an explanation before the JSON block).

**Fix:** The parser already handles ` ```json ` fences. For persistent failures, try rephrasing the change request with more concrete, specific language, which tends to produce cleaner model output.
