# API Reference

Complete reference for every exported symbol, class, and function defined in `extension.js`.

---

## Table of Contents

1. [Exported Symbols](#exported-symbols)
2. [Class: VSCodeLanguageModel](#class-vscodelanguagemodel)
3. [Prompt Templates](#prompt-templates)
4. [Function: createWorkItemGenerationChain](#function-createworkitemgenerationchain)
5. [Function: generateWorkItems](#function-generateworkitems)
6. [Function: formatWorkItemsForChat](#function-formatworkitemsforchat)
7. [Function: convertToCSV](#function-converttocsv)
8. [Function: downloadCSV](#function-downloadcsv)
9. [Function: activate](#function-activate)
10. [Function: deactivate](#function-deactivate)
11. [Type Definitions](#type-definitions)

---

## Exported Symbols

`extension.js` uses the CommonJS module pattern and exports only the two symbols required by the VS Code extension host:

```js
module.exports = { activate, deactivate };
```

All other symbols are module-private.

---

## Class: VSCodeLanguageModel

A thin wrapper around the `vscode.lm` Language Model API that provides a simple `invoke(prompt)` interface for sending plain-string prompts to GitHub Copilot.

### Constructor

```js
new VSCodeLanguageModel(token)
```

| Parameter | Type                               | Description                                                                                 |
|-----------|------------------------------------|---------------------------------------------------------------------------------------------|
| `token`   | `vscode.CancellationToken`         | The cancellation token provided by the VS Code Chat API. Passed to every model request so that the user can cancel an in-flight generation. |

**Properties set by constructor:**

| Property | Type   | Initial value | Description                                        |
|----------|--------|---------------|----------------------------------------------------|
| `token`  | `vscode.CancellationToken` | *(parameter)* | Stored for use in subsequent `sendRequest` calls. |
| `model`  | `vscode.LanguageModelChat \| null` | `null` | Populated lazily by `initialize()`.              |

---

### `initialize()`

```js
async initialize(): Promise<void>
```

Lazily selects the first available GitHub Copilot chat model via `vscode.lm.selectChatModels({ vendor: 'copilot' })`. If `this.model` is already set, the method returns immediately (no-op).

**Throws:** `Error('No GitHub Copilot models available')` when `selectChatModels` returns an empty array.

**Side effects:** Sets `this.model` to the first element of the returned model array. Logs model name to the console.

---

### `invoke(prompt)`

```js
async invoke(prompt: string): Promise<string>
```

Sends a single user message to the Copilot model and collects the full streamed response as a string.

| Parameter | Type     | Description                                  |
|-----------|----------|----------------------------------------------|
| `prompt`  | `string` | The complete, pre-formatted prompt text.     |

**Returns:** A `Promise<string>` that resolves to the full response text once the stream is exhausted.

**Throws:** Re-throws any error from the `vscode.lm` API (network errors, model errors, etc.).

**Implementation notes:**
- Calls `initialize()` on every invocation (idempotent due to the guard in `initialize`).
- Constructs a `vscode.LanguageModelChatMessage` with role `User`.
- Iterates over `chatReq.text` using `for await` to accumulate streamed fragments.

---

## Prompt Templates

Both templates are module-level constants created with LangChain's `PromptTemplate`.

### `complexityAnalysisTemplate`

```js
const complexityAnalysisTemplate = new PromptTemplate({ ... });
```

**Purpose:** Asks the model to analyse a change request and return a single integer representing the optimal number of user stories.

**Input variables:**

| Variable              | Type     | Description                                  |
|-----------------------|----------|----------------------------------------------|
| `changeRequestType`   | `string` | Category of the change (e.g. `New Feature`). |
| `title`               | `string` | Brief title of the change request.           |
| `description`         | `string` | Full description of what needs to be built.  |
| `additionalComments`  | `string` | Optional extra context (defaults to `'None'`). |

**Expected model output:** A single integer string in the range `[2, 8]` with no other text.

---

### `workItemGenerationTemplate`

```js
const workItemGenerationTemplate = new PromptTemplate({ ... });
```

**Purpose:** Instructs the model to generate a structured JSON object containing one EPIC and exactly `numStories` User Stories.

**Input variables:**

| Variable              | Type     | Description                                  |
|-----------------------|----------|----------------------------------------------|
| `changeRequestType`   | `string` | Category of the change.                      |
| `title`               | `string` | Brief title of the change request.           |
| `description`         | `string` | Full description.                            |
| `additionalComments`  | `string` | Optional extra context.                      |
| `numStories`          | `number` | Number of user stories to generate (2–8).    |

**Expected model output:** A valid JSON string matching the [`WorkItems`](#type-workitems) shape. The model may wrap it in ` ```json ` fences; `generateWorkItems` strips these before parsing.

---

## Function: createWorkItemGenerationChain

```js
function createWorkItemGenerationChain(token): { complexityChain, workItemChain }
```

Factory that creates one `VSCodeLanguageModel` instance (shared between both chains) and two `RunnableLambda` chains.

| Parameter | Type                       | Description                     |
|-----------|----------------------------|---------------------------------|
| `token`   | `vscode.CancellationToken` | Forwarded to `VSCodeLanguageModel`. |

**Returns:** An object with two properties:

| Property          | Type             | Description                                                                    |
|-------------------|------------------|--------------------------------------------------------------------------------|
| `complexityChain` | `RunnableLambda` | Formats `complexityAnalysisTemplate` with the input and calls the LLM.         |
| `workItemChain`   | `RunnableLambda` | Formats `workItemGenerationTemplate` with the input and calls the LLM.         |

**Chain input shapes:**

`complexityChain.invoke(input)` expects:
```js
{
  changeRequestType: string,
  title: string,
  description: string,
  additionalComments: string
}
```

`workItemChain.invoke(input)` expects everything above **plus**:
```js
{
  numStories: number
}
```

---

## Function: generateWorkItems

```js
async function generateWorkItems(changeRequest, token): Promise<WorkItems>
```

Orchestrates the two-step LangChain pipeline. Stores the result in the module-level `lastGeneratedWorkItems` variable.

| Parameter       | Type                       | Description                          |
|-----------------|----------------------------|--------------------------------------|
| `changeRequest` | [`ChangeRequest`](#type-changerequest) | Parsed user input.        |
| `token`         | `vscode.CancellationToken` | Passed through to the LLM wrapper.   |

**Returns:** A `Promise<WorkItems>` that resolves to the parsed work-item object.

**Throws:**
- `Error('Invalid number of stories: "...". Expected 2-8.')` when the complexity chain returns a non-integer or out-of-range value.
- `Error('Failed to parse work items response: ...')` when the JSON from the work-item chain cannot be parsed.
- Any error from `VSCodeLanguageModel.invoke()`.

**Side effects:** Sets `lastGeneratedWorkItems` to `{ ...workItems, changeRequestType }`.

---

## Function: formatWorkItemsForChat

```js
function formatWorkItemsForChat(workItems): string
```

Converts a `WorkItems` object to a Markdown string suitable for display in the GitHub Copilot Chat pane.

| Parameter   | Type         | Description                   |
|-------------|--------------|-------------------------------|
| `workItems` | [`WorkItems`](#type-workitems) | Parsed work-item object. |

**Returns:** A Markdown `string` containing:
- A level-2 heading `## Generated Work Items`
- A level-3 EPIC section with title, description, priority, estimated effort, and numbered acceptance criteria
- A level-3 User Stories section with one level-4 heading per story, including story points, priority, bulleted acceptance criteria, and bulleted tasks
- A reminder prompt to run the CSV download command

---

## Function: convertToCSV

```js
function convertToCSV(workItems, changeRequestType): string
```

Serialises a `WorkItems` object to an RFC 4180-compliant CSV string.

| Parameter           | Type         | Description                                               |
|---------------------|--------------|-----------------------------------------------------------|
| `workItems`         | [`WorkItems`](#type-workitems) | Must include `epic` and `userStories`.  |
| `changeRequestType` | `string`     | Written into the `Change Request Type` column of every row. |

**Returns:** A `string` where:
- Row 1 is the header row.
- Row 2 is the EPIC row (`Story Points`, `Tasks` columns are empty for epics).
- Rows 3…N are User Story rows (`Effort` column is empty for user stories; `Parent` column contains the EPIC title).

**CSV escaping rules** (applied by the internal `escapeCsvValue` helper):
- `null` / `undefined` → empty string
- Any value containing `,`, `"`, or `\n` is wrapped in double-quotes
- Literal `"` characters inside a quoted value are doubled (`""`)

See [CSV-FORMAT.md](./CSV-FORMAT.md) for the full column schema and an example file.

---

## Function: downloadCSV

```js
async function downloadCSV(): Promise<void>
```

Generates a CSV from `lastGeneratedWorkItems`, writes it to the system temp directory, and opens it with the operating system's default application.

**Returns:** `Promise<void>`

**Precondition:** `lastGeneratedWorkItems` must not be `null` (i.e., `generateWorkItems` must have completed at least once since the extension was activated).

**Behaviour when precondition is not met:** Shows a VS Code error notification `'No work items to export. Generate work items first.'` and returns.

**File naming:** `ado-workitems-<ISO-timestamp>.csv` where the timestamp uses `-` instead of `:` and `.` to avoid issues with file-system reserved characters (e.g. `ado-workitems-2024-06-01T14-30-00-000Z.csv`).

**Throws:** On file-system errors, shows a `showErrorMessage` notification with the error message; does not re-throw.

---

## Function: activate

```js
function activate(context: vscode.ExtensionContext): void
```

The extension entry point called by VS Code when the extension is activated (`onStartupFinished`).

| Parameter | Type                          | Description                                            |
|-----------|-------------------------------|--------------------------------------------------------|
| `context` | `vscode.ExtensionContext`     | Used to register disposables via `context.subscriptions`. |

**Registers:**

| Type                | ID / Name                               | Description                                            |
|---------------------|-----------------------------------------|--------------------------------------------------------|
| Chat Participant    | `ado-workitem`                          | Handles `@ado-workitem` messages in Copilot Chat.      |
| Command             | `ado-workitem-generator.downloadCsv`    | Triggers the `downloadCSV` function.                   |

**Chat participant handler steps:**
1. Verifies at least one Copilot model is available; streams `❌` and returns if not.
2. Parses `request.prompt` into a `ChangeRequest` object.
3. Validates all required fields are present; streams `❌` with usage instructions if not.
4. Calls `generateWorkItems(changeRequest, token)`.
5. Calls `formatWorkItemsForChat(workItems)` and pipes result to `stream.markdown()`.
6. On any error, streams `❌` with the error message.

**Follow-up provider:** Registers two static follow-up prompts:
- `🔄 Regenerate with different breakdown`
- `⚖️ Adjust estimates`

---

## Function: deactivate

```js
function deactivate(): void
```

Called by VS Code when the extension is deactivated. Currently a no-op placeholder; no cleanup is required because all disposables are managed via `context.subscriptions`.

---

## Type Definitions

The following TypeScript-style interfaces describe the runtime shapes used by the extension. (The extension itself is JavaScript; these definitions are provided for documentation purposes only.)

### Type: ChangeRequest

```ts
interface ChangeRequest {
  changeRequestType: string;   // e.g. "New Feature", "Bug Fix"
  title: string;               // Brief title
  description: string;         // Detailed description
  additionalComments: string;  // Extra context; defaults to "None"
}
```

### Type: Epic

```ts
interface Epic {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  estimatedEffort: number;     // Hours
}
```

### Type: UserStory

```ts
interface UserStory {
  title: string;
  description: string;         // "As a... I want... So that..." format
  acceptanceCriteria: string[];
  storyPoints: 1 | 2 | 3 | 5 | 8 | 13;  // Fibonacci sequence
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  tasks: string[];
}
```

### Type: WorkItems

```ts
interface WorkItems {
  epic: Epic;
  userStories: UserStory[];
  changeRequestType?: string;  // Added by generateWorkItems before caching
}
```
