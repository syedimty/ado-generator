const vscode = require('vscode');
const { PromptTemplate } = require('@langchain/core/prompts');
const { RunnableLambda } = require('@langchain/core/runnables');
const fs = require('fs');
const path = require('path');
const os = require('os');

class VSCodeLanguageModel {
    constructor(token) {
        this.token = token;
        this.model = null;
    }

    async initialize() {
        if (!this.model) {
            console.log('Initializing VS Code Language Model...');
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot'
            });
            
            if (models.length === 0) {
                throw new Error('No GitHub Copilot models available');
            }
            
            this.model = models[0];
            console.log('Model initialized:', this.model.name);
        }
    }

    async invoke(prompt) {
        try {
            await this.initialize();
            
            const messages = [new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, prompt)];
            
            console.log('Sending request to model...');
            const chatReq = this.model.sendRequest(messages, undefined, this.token);
            
            console.log('Awaiting response and iterating text...');
            let result = '';
            for await (const fragment of (await chatReq).text) {
                result += fragment;
            }
            
            console.log('Response complete. Length:', result.length);
            return result;
        } catch (error) {
            console.error('Language model error:', error);
            throw error;
        }
    }
}

const complexityAnalysisTemplate = new PromptTemplate({
    template: `Analyze the following change request and determine the optimal number of user stories (2-8) based on complexity:

Change Request Type: {changeRequestType}
Title: {title}
Description: {description}
Additional Comments: {additionalComments}

Consider:
- Scope and complexity of the change
- Number of components/systems affected
- Technical complexity
- Dependencies between features

Respond with ONLY a number between 2 and 8 representing the optimal number of user stories.`,
    inputVariables: ['changeRequestType', 'title', 'description', 'additionalComments']
});

const workItemGenerationTemplate = new PromptTemplate({
    template: `Generate Azure DevOps work items for the following change request. Create 1 EPIC and exactly {numStories} User Stories.

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
{{
  "epic": {{
    "title": "string",
    "description": "string", 
    "acceptanceCriteria": ["string"],
    "priority": "Critical|High|Medium|Low",
    "estimatedEffort": number
  }},
  "userStories": [
    {{
      "title": "string",
      "description": "As a [user type] I want [functionality] so that [benefit]",
      "acceptanceCriteria": ["string"],
      "storyPoints": number,
      "priority": "Critical|High|Medium|Low", 
      "tasks": ["string"]
    }}
  ]
}}`,
    inputVariables: ['changeRequestType', 'title', 'description', 'additionalComments', 'numStories']
});

function createWorkItemGenerationChain(token) {
    console.log('Creating LangChain work item generation chain...');
    
    const llm = new VSCodeLanguageModel(token);
    
    // Create complexity analysis chain using RunnableLambda
    const complexityChain = RunnableLambda.from(async (input) => {
        console.log('Complexity chain: formatting prompt...');
        const prompt = await complexityAnalysisTemplate.format(input);
        console.log('Complexity chain: calling model...');
        const response = await llm.invoke(prompt);
        return response.trim();
    });

    // Create work item generation chain using RunnableLambda  
    const workItemChain = RunnableLambda.from(async (input) => {
        console.log('Work item chain: formatting prompt...');
        const prompt = await workItemGenerationTemplate.format(input);
        console.log('Work item chain: calling model...');
        const response = await llm.invoke(prompt);
        return response.trim();
    });

    console.log('LangChain chains created successfully');
    return { complexityChain, workItemChain };
}

let lastGeneratedWorkItems = null;

async function generateWorkItems(changeRequest, token) {
    try {
        console.log('Starting LangChain work item generation with:', changeRequest);
        
        // Create LangChain chains
        const { complexityChain, workItemChain } = createWorkItemGenerationChain(token);
        
        // Step 1: Analyze complexity using LangChain
        console.log('Running complexity analysis chain...');
        const numStoriesResponse = await complexityChain.invoke(changeRequest);
        console.log('Complexity analysis response:', numStoriesResponse);
        
        const numStories = parseInt(numStoriesResponse.trim());
        
        if (isNaN(numStories) || numStories < 2 || numStories > 8) {
            throw new Error(`Invalid number of stories: "${numStoriesResponse}". Expected 2-8.`);
        }

        // Step 2: Generate work items using LangChain
        console.log('Running work item generation chain for', numStories, 'stories...');
        const workItemsInput = {
            ...changeRequest,
            numStories: numStories
        };
        
        const workItemsResponse = await workItemChain.invoke(workItemsInput);
        console.log('Work items response received, parsing...');

        let workItems;
        try {
            // Clean up response to extract JSON
            let cleanResponse = workItemsResponse.trim();
            if (cleanResponse.includes('```json')) {
                cleanResponse = cleanResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            }
            if (cleanResponse.includes('```')) {
                cleanResponse = cleanResponse.replace(/```/g, '').trim();
            }
            
            workItems = JSON.parse(cleanResponse);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            console.error('Raw response:', workItemsResponse);
            throw new Error(`Failed to parse work items response: ${parseError.message}`);
        }

        lastGeneratedWorkItems = { ...workItems, changeRequestType: changeRequest.changeRequestType };
        
        console.log('LangChain work item generation completed successfully');
        return workItems;
    } catch (error) {
        console.error('Error in LangChain work item generation:', error);
        throw error;
    }
}

function formatWorkItemsForChat(workItems) {
    let output = `## Generated Work Items\n\n`;
    
    output += `### EPIC: ${workItems.epic.title}\n`;
    output += `**Description:** ${workItems.epic.description}\n`;
    output += `**Priority:** ${workItems.epic.priority}\n`;
    output += `**Estimated Effort:** ${workItems.epic.estimatedEffort} hours\n`;
    output += `**Acceptance Criteria:**\n`;
    workItems.epic.acceptanceCriteria.forEach((criteria, i) => {
        output += `${i + 1}. ${criteria}\n`;
    });
    output += `\n`;

    output += `### User Stories (${workItems.userStories.length})\n\n`;
    
    workItems.userStories.forEach((story, i) => {
        output += `#### ${i + 1}. ${story.title}\n`;
        output += `**Story:** ${story.description}\n`;
        output += `**Story Points:** ${story.storyPoints}\n`;
        output += `**Priority:** ${story.priority}\n`;
        output += `**Acceptance Criteria:**\n`;
        story.acceptanceCriteria.forEach((criteria, j) => {
            output += `- ${criteria}\n`;
        });
        output += `**Tasks:**\n`;
        story.tasks.forEach((task, j) => {
            output += `- ${task}\n`;
        });
        output += `\n`;
    });

    output += `\n💾 Use the command \`ADO Work Item Generator: Download Work Items CSV\` to export these work items.\n`;
    
    return output;
}

function convertToCSV(workItems, changeRequestType) {
    const csvHeaders = [
        'Work Item Type',
        'Title',
        'Description',
        'Acceptance Criteria',
        'Priority',
        'Story Points',
        'Effort',
        'Tasks',
        'Parent',
        'Change Request Type'
    ];

    let csvContent = csvHeaders.join(',') + '\n';
    
    const escapeCsvValue = (value) => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    };

    const epic = workItems.epic;
    const epicRow = [
        'Epic',
        escapeCsvValue(epic.title),
        escapeCsvValue(epic.description),
        escapeCsvValue(epic.acceptanceCriteria.join('; ')),
        escapeCsvValue(epic.priority),
        '',
        escapeCsvValue(epic.estimatedEffort),
        '',
        '',
        escapeCsvValue(changeRequestType)
    ];
    csvContent += epicRow.join(',') + '\n';

    workItems.userStories.forEach(story => {
        const storyRow = [
            'User Story',
            escapeCsvValue(story.title),
            escapeCsvValue(story.description),
            escapeCsvValue(story.acceptanceCriteria.join('; ')),
            escapeCsvValue(story.priority),
            escapeCsvValue(story.storyPoints),
            '',
            escapeCsvValue(story.tasks.join('; ')),
            escapeCsvValue(epic.title),
            escapeCsvValue(changeRequestType)
        ];
        csvContent += storyRow.join(',') + '\n';
    });

    return csvContent;
}

async function downloadCSV() {
    if (!lastGeneratedWorkItems) {
        vscode.window.showErrorMessage('No work items to export. Generate work items first.');
        return;
    }

    try {
        const csvContent = convertToCSV(lastGeneratedWorkItems, lastGeneratedWorkItems.changeRequestType);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `ado-workitems-${timestamp}.csv`;
        const tempFilePath = path.join(os.tmpdir(), fileName);
        
        fs.writeFileSync(tempFilePath, csvContent, 'utf8');
        
        const uri = vscode.Uri.file(tempFilePath);
        await vscode.env.openExternal(uri);
        
        vscode.window.showInformationMessage(`Work items exported to: ${fileName}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Error exporting CSV: ${error.message}`);
    }
}

function activate(context) {
    const participant = vscode.chat.createChatParticipant('ado-workitem', async (request, context, stream, token) => {
        try {
            // Check if GitHub Copilot is available and test basic functionality
            try {
                const testModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
                if (testModels.length === 0) {
                    stream.markdown('❌ **GitHub Copilot not available**\n\nPlease ensure:\n- GitHub Copilot extension is installed and enabled\n- You are signed in to GitHub in VS Code\n- You have an active GitHub Copilot subscription');
                    return;
                }
                
                console.log('GitHub Copilot is available and ready');
            } catch (error) {
                stream.markdown('❌ **Error accessing GitHub Copilot**\n\n' + error.message + '\n\nPlease check your GitHub Copilot setup.');
                return;
            }

            stream.progress('Analyzing change request...');

            const userInput = request.prompt.trim();
            
            if (!userInput) {
                stream.markdown('Please provide change request details in this format:\n\n```\nChangeRequestType: [New Change/Tech Improvement/Production Issue/Bug Fix/etc]\nTitle: [Your title]\nDescription: [Your description]\nAdditional Comments: [Any additional comments]\n```');
                return;
            }

            const lines = userInput.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            const changeRequest = {
                changeRequestType: '',
                title: '',
                description: '',
                additionalComments: 'None'
            };
            
            for (const line of lines) {
                if (line.includes(':')) {
                    const colonIndex = line.indexOf(':');
                    const key = line.substring(0, colonIndex).trim();
                    const value = line.substring(colonIndex + 1).trim();
                    const cleanKey = key.toLowerCase().replace(/\s+/g, '');
                    
                    if (cleanKey.includes('type') || cleanKey.includes('changerequest')) {
                        changeRequest.changeRequestType = value;
                    } else if (cleanKey.includes('title')) {
                        changeRequest.title = value;
                    } else if (cleanKey.includes('description')) {
                        changeRequest.description = value;
                    } else if (cleanKey.includes('comment') || cleanKey.includes('additional')) {
                        changeRequest.additionalComments = value;
                    }
                }
            }

            if (!changeRequest.changeRequestType || !changeRequest.title || !changeRequest.description) {
                stream.markdown('❌ Missing required fields. Please provide:\n- **ChangeRequestType**: [New Change/Tech Improvement/Production Issue/Bug Fix/etc]\n- **Title**: [Your title]\n- **Description**: [Your description]\n- **Additional Comments**: [Optional additional comments]\n\nExample:\n```\nChangeRequestType: New Feature\nTitle: User Dashboard\nDescription: Create a responsive user dashboard with analytics\nAdditional Comments: Must load within 2 seconds\n```');
                return;
            }

            stream.markdown(`**Parsed Input:**\n- Type: ${changeRequest.changeRequestType}\n- Title: ${changeRequest.title}\n- Description: ${changeRequest.description}\n- Comments: ${changeRequest.additionalComments}\n`);

            stream.progress('Determining optimal number of user stories...');
            
            const workItems = await generateWorkItems(changeRequest, token);
            
            stream.progress('Formatting work items...');
            
            const formattedOutput = formatWorkItemsForChat(workItems);
            stream.markdown(formattedOutput);
            
        } catch (error) {
            console.error('Chat participant error:', error);
            stream.markdown(`❌ Error generating work items: ${error.message}\n\nPlease ensure GitHub Copilot is enabled and try again.`);
        }
    });

    participant.iconPath = vscode.ThemeIcon.File;
    participant.followupProvider = {
        provideFollowups(result, context, token) {
            return [{
                prompt: 'Generate different work item breakdown',
                label: '🔄 Regenerate with different breakdown'
            }, {
                prompt: 'Adjust story points and priorities',
                label: '⚖️ Adjust estimates'
            }];
        }
    };

    const downloadCommand = vscode.commands.registerCommand('ado-workitem-generator.downloadCsv', downloadCSV);
    
    context.subscriptions.push(participant, downloadCommand);
}

function deactivate() {}

module.exports = { activate, deactivate };