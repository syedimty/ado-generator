# LangChain Pipeline

This document explains the two-step AI pipeline that powers the **ADO Work Item Generator**, including the role of each component, the prompt strategies used, and guidance on customising or extending the pipeline.

---

## Table of Contents

1. [Why LangChain?](#why-langchain)
2. [Pipeline Overview](#pipeline-overview)
3. [Step 1 – Complexity Analysis](#step-1--complexity-analysis)
4. [Step 2 – Work Item Generation](#step-2--work-item-generation)
5. [How the Chains Are Built](#how-the-chains-are-built)
6. [VSCodeLanguageModel: the LLM Adapter](#vscodelanguagemodel-the-llm-adapter)
7. [Response Cleaning and Parsing](#response-cleaning-and-parsing)
8. [Prompt Engineering Notes](#prompt-engineering-notes)
9. [Extending the Pipeline](#extending-the-pipeline)

---

## Why LangChain?

The extension uses [`@langchain/core`](https://www.npmjs.com/package/@langchain/core) for two specific primitives:

| Primitive         | What it provides in this project |
|-------------------|----------------------------------|
| `PromptTemplate`  | Declarative prompt strings with named `{variable}` placeholders and compile-time validation of input variables. |
| `RunnableLambda`  | A thin wrapper that turns any async function into a chainable, composable pipeline stage. |

No other LangChain packages are used. In particular, this project does **not** use LangChain's built-in LLM adapters (e.g. `@langchain/openai`) because the model is accessed through VS Code's built-in `vscode.lm` API instead of a direct HTTP call.

---

## Pipeline Overview

```
changeRequest object
       │
       ▼
┌─────────────────────────────┐
│  complexityChain (Step 1)   │
│                             │
│  complexityAnalysisTemplate │
│  → format(changeRequest)    │
│  → VSCodeLanguageModel      │
│  → response: "4"            │
└──────────────┬──────────────┘
               │ numStories = parseInt("4") = 4
               ▼
┌─────────────────────────────┐
│  workItemChain (Step 2)     │
│                             │
│  workItemGenerationTemplate │
│  → format({...changeRequest,│
│           numStories: 4})   │
│  → VSCodeLanguageModel      │
│  → response: JSON string    │
└──────────────┬──────────────┘
               │
               ▼
        workItems (parsed JSON)
               │
    stored in lastGeneratedWorkItems
```

Both steps share a **single `VSCodeLanguageModel` instance**, meaning the Copilot model is selected once and reused.

---

## Step 1 – Complexity Analysis

### Purpose

The first step analyses the change request and determines how many User Stories to generate. This produces a concrete integer that constrains Step 2, which leads to more consistent and appropriately-scoped output.

### Prompt Template

```
Analyze the following change request and determine the optimal number of user stories (2-8) based on complexity:

Change Request Type: {changeRequestType}
Title: {title}
Description: {description}
Additional Comments: {additionalComments}

Consider:
- Scope and complexity of the change
- Number of components/systems affected
- Technical complexity
- Dependencies between features

Respond with ONLY a number between 2 and 8 representing the optimal number of user stories.
```

### Input variables

| Variable             | Example value        |
|----------------------|----------------------|
| `changeRequestType`  | `New Feature`        |
| `title`              | `User Authentication`|
| `description`        | `Implement login...` |
| `additionalComments` | `Must support OAuth` |

### Expected output

A single integer string between `2` and `8` with no additional text (e.g. `"4"`).

### Validation

`generateWorkItems` validates the response with:

```js
const numStories = parseInt(numStoriesResponse.trim());
if (isNaN(numStories) || numStories < 2 || numStories > 8) {
    throw new Error(`Invalid number of stories: "${numStoriesResponse}". Expected 2-8.`);
}
```

If the model returns anything other than a plain integer in the valid range, a descriptive error is thrown and surfaced to the user.

---

## Step 2 – Work Item Generation

### Purpose

The second step generates the complete EPIC and the exact number of User Stories determined in Step 1. Providing a concrete `numStories` value reduces hallucinated story counts and encourages the model to distribute scope evenly.

### Prompt Template

```
Generate Azure DevOps work items for the following change request. Create 1 EPIC and exactly {numStories} User Stories.

Change Request Type: {changeRequestType}
Title: {title}
Description: {description}
Additional Comments: {additionalComments}

Requirements:
- Generate 1 EPIC with: title, description, acceptance criteria, priority (Critical/High/Medium/Low), estimated effort (hours)
- Generate {numStories} User Stories with: title, user story format description ("As a... I want... So that..."), 2-5 acceptance criteria, story points (1,2,3,5,8,13), priority, 2-5 tasks
- Each User Story should be a logical breakdown of the EPIC
- Use realistic story points following Fibonacci sequence
- Ensure comprehensive coverage of the change request

Return ONLY valid JSON in this exact format:
{
  "epic": {
    "title": "string",
    "description": "string",
    "acceptanceCriteria": ["string"],
    "priority": "Critical|High|Medium|Low",
    "estimatedEffort": number
  },
  "userStories": [
    {
      "title": "string",
      "description": "As a [user type] I want [functionality] so that [benefit]",
      "acceptanceCriteria": ["string"],
      "storyPoints": number,
      "priority": "Critical|High|Medium|Low",
      "tasks": ["string"]
    }
  ]
}
```

> **Note:** The double curly braces (`{{` / `}}`) in the actual source code are LangChain's escape sequence for literal `{` and `}` characters inside a `PromptTemplate` string. They are rendered as single braces in the final prompt sent to the model.

### Input variables

| Variable             | Example value        |
|----------------------|----------------------|
| `changeRequestType`  | `New Feature`        |
| `title`              | `User Authentication`|
| `description`        | `Implement login...` |
| `additionalComments` | `Must support OAuth` |
| `numStories`         | `4` (from Step 1)    |

### Expected output

A valid JSON string matching the schema shown in the template. The model may optionally wrap the JSON in a ` ```json ` code fence; the extension strips these before parsing.

---

## How the Chains Are Built

`createWorkItemGenerationChain(token)` constructs both chains using `RunnableLambda`:

```js
const complexityChain = RunnableLambda.from(async (input) => {
    const prompt = await complexityAnalysisTemplate.format(input);
    const response = await llm.invoke(prompt);
    return response.trim();
});

const workItemChain = RunnableLambda.from(async (input) => {
    const prompt = await workItemGenerationTemplate.format(input);
    const response = await llm.invoke(prompt);
    return response.trim();
});
```

Each lambda:
1. Calls `PromptTemplate.format(input)` – substitutes `{variables}` into the template string.
2. Passes the formatted string to `VSCodeLanguageModel.invoke(prompt)` – sends it to Copilot and awaits the full streamed response.
3. Returns the trimmed response string.

The chains are invoked sequentially inside `generateWorkItems`:

```js
const numStoriesResponse = await complexityChain.invoke(changeRequest);
// ...validate numStories...
const workItemsResponse = await workItemChain.invoke({ ...changeRequest, numStories });
```

---

## VSCodeLanguageModel: the LLM Adapter

`VSCodeLanguageModel` adapts `vscode.lm` to the simple `invoke(prompt): Promise<string>` interface expected by the chains.

```
complexityChain / workItemChain
         │
         │ llm.invoke(formattedPrompt)
         ▼
  VSCodeLanguageModel
         │
         │ vscode.lm.selectChatModels({ vendor: 'copilot' })  [once]
         │ model.sendRequest([UserMessage(prompt)], ...)
         │
         ▼
  GitHub Copilot (vscode.lm stream)
         │
         │ for await (fragment of chatReq.text)
         ▼
  assembled string  →  returned to chain
```

**Streaming behaviour:** `vscode.lm` delivers the response as a stream of text fragments. The adapter accumulates all fragments into a single string before returning. This means the chains do not see partial responses.

---

## Response Cleaning and Parsing

After Step 2 the raw model response may contain ` ```json ` fences that some models add around code blocks. The parser strips these before calling `JSON.parse`:

```js
let cleanResponse = workItemsResponse.trim();
if (cleanResponse.includes('```json')) {
    cleanResponse = cleanResponse.replace(/```json/g, '').replace(/```/g, '').trim();
}
if (cleanResponse.includes('```')) {
    cleanResponse = cleanResponse.replace(/```/g, '').trim();
}
workItems = JSON.parse(cleanResponse);
```

If `JSON.parse` fails after cleaning, an error is thrown with the parse error message, which is displayed in chat so the user knows to retry.

---

## Prompt Engineering Notes

### Why two steps instead of one?

A single prompt asking for "the right number of user stories AND the work items themselves" tends to produce inconsistent story counts and uneven scope distribution. Separating complexity analysis into its own call:

- Forces explicit reasoning about scope before committing to a specific number.
- Gives the model a clear, constrained task (return one integer) rather than combining two concerns.
- Allows the second prompt to be precise ("generate exactly 4 stories") instead of vague ("generate an appropriate number").

### Fibonacci story points

The work item template explicitly lists the allowed Fibonacci values (`1,2,3,5,8,13`). Without this constraint, models often return arbitrary integers. Listing the values encourages adherence to standard agile estimation conventions.

### JSON schema in the prompt

Embedding the complete expected JSON schema directly in the prompt is the most reliable way to get structured output from a chat model without a function-calling API. The `Return ONLY valid JSON` instruction discourages preamble or explanation text.

### Priority vocabulary

The priority values (`Critical|High|Medium|Low`) are listed explicitly in the prompt using the pipe-separated format. This vocabulary matches Azure DevOps's default priority field values, making imports cleaner.

---

## Extending the Pipeline

### Adding a validation step

To add a third step that validates or enriches the generated work items (e.g. checks for duplicate story titles), add a new chain in `createWorkItemGenerationChain` and call it in `generateWorkItems`:

```js
const validationChain = RunnableLambda.from(async (input) => {
    const prompt = await validationTemplate.format(input);
    const response = await llm.invoke(prompt);
    return response.trim();
});
```

```js
// Inside generateWorkItems, after parsing workItems:
const validationInput = { workItemsJson: JSON.stringify(workItems) };
const validationResponse = await validationChain.invoke(validationInput);
// handle validation result...
```

### Changing the number-of-stories range

The range `2–8` is enforced in two places:
1. The `complexityAnalysisTemplate` prompt text (`"determine the optimal number of user stories (2-8)"`).
2. The validation guard in `generateWorkItems` (`numStories < 2 || numStories > 8`).

Update both if you want a different range.

### Replacing GitHub Copilot with a different model

`VSCodeLanguageModel` selects the first model returned by `vscode.lm.selectChatModels({ vendor: 'copilot' })`. To use a different vendor or a specific model:

```js
const models = await vscode.lm.selectChatModels({
    vendor: 'copilot',
    family: 'gpt-4o'  // or any other model family identifier
});
```

See the [VS Code LM API documentation](https://code.visualstudio.com/api/extension-guides/language-model) for available options.
