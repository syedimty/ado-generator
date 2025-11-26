# ADO Work Item Generator

A VS Code GitHub Copilot Chat Participant extension that generates Azure DevOps EPICs and User Stories from change requests using LangChain to chain LLM calls.

## Features

- **Chat Participant**: Use `@ado-workitem` in GitHub Copilot Chat
- **Intelligent Analysis**: 2-step LangChain pipeline that analyzes complexity and generates optimal work items
- **Structured Output**: Generates 1 EPIC + 2-8 User Stories with complete details
- **CSV Export**: Download generated work items as CSV for easy import into Azure DevOps

## Prerequisites

- VS Code with GitHub Copilot extension enabled
- Active GitHub Copilot subscription

## Installation

1. Clone or download this repository
2. Open the folder in VS Code
3. Install dependencies: `npm install`
4. Press `F5` to launch extension development host
5. In the new VS Code window, open GitHub Copilot Chat

## Usage

### Basic Usage

1. Open GitHub Copilot Chat (`Ctrl+Alt+I`)
2. Type `@ado-workitem` followed by your change request details:

```
@ado-workitem
ChangeRequestType: New Feature
Title: User Authentication System
Description: Implement a complete user authentication system with login, registration, password reset, and user profile management
Additional Comments: Must integrate with existing database and support OAuth
```

### Input Format

Provide change request details in this format:
- **ChangeRequestType**: New Change/Tech Improvement/Production Issue/Bug Fix/etc
- **Title**: Brief title of the change request
- **Description**: Detailed description of what needs to be implemented
- **Additional Comments**: Any additional context or requirements (optional)

### Output

The extension generates:
- **1 EPIC** with title, description, acceptance criteria, priority, and estimated effort
- **2-8 User Stories** with titles, user story format descriptions, acceptance criteria, story points, priorities, and tasks

### CSV Export

After generating work items:
1. Use the command palette (`Ctrl+Shift+P`)
2. Run: `ADO Work Item Generator: Download Work Items CSV`
3. The CSV file will be saved to your system's temp folder and opened

## CSV Format

The exported CSV includes columns:
- Work Item Type
- Title
- Description
- Acceptance Criteria
- Priority
- Story Points
- Effort
- Tasks
- Parent
- Change Request Type

## Architecture

- **Pure JavaScript**: No TypeScript compilation required
- **VS Code LM API**: Uses only built-in GitHub Copilot models via `vscode.lm`
- **LangChain Core**: Minimal dependency for prompt templates and chains
- **No External APIs**: All processing done locally with Copilot

## Technical Details

### LangChain Pipeline

1. **Complexity Analysis**: Determines optimal number of user stories (2-8) based on change request complexity
2. **Work Item Generation**: Creates structured EPIC and User Stories with detailed information

### Key Components

- `VSCodeLanguageModel`: Wrapper class for `vscode.lm` API
- `complexityAnalysisTemplate`: Prompt for analyzing change complexity
- `workItemGenerationTemplate`: Prompt for generating structured work items
- CSV export functionality with proper escaping

## Development

### Project Structure
```
├── extension.js          # Main extension logic
├── package.json          # Extension manifest
├── README.md            # Documentation
└── .gitignore           # Git ignore rules
```

### Key Functions
- `activate()`: Extension activation and chat participant registration
- `generateWorkItems()`: Main LangChain pipeline execution
- `formatWorkItemsForChat()`: Format output for chat display
- `convertToCSV()`: Convert work items to CSV format
- `downloadCSV()`: Export and download CSV file

## Troubleshooting

### GitHub Copilot Not Available
- Ensure GitHub Copilot extension is installed and enabled
- Verify active GitHub Copilot subscription
- Check that you're signed in to GitHub in VS Code

### Invalid JSON Response
- Try rephrasing your change request with more specific details
- Ensure all required fields are provided
- The extension will retry with better prompts if needed

### CSV Export Issues
- Check that you have write permissions to the system temp folder
- Ensure the work items were generated successfully first

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details"# ado-generator" 
