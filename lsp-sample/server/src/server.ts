/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	CodeAction,
	CodeActionKind,
	Location,
	Range,
	Position,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

// import { Position, Range } from 'vscode';
import * as util from 'util';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as https from 'https';
import { URL } from 'url';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const tmpDir = '/Users/thomasscholtz/go/bin/';
const tmpLinterPath = path.join(tmpDir, 'api-linter');

const agent = new https.Agent({
	rejectUnauthorized: false,
});

// Make a request for a user
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
			},
		},
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true,
			},
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders((_event) => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample',
		});
		documentSettings.set(resource, result);
	}
	return result;
}

function installLinter(): string {
	if (!fs.existsSync(tmpLinterPath)) {
		const cmd = 'go install github.com/googleapis/api-linter/cmd/api-linter@latest';
		try {
			child_process.execSync(cmd, {
				env: {
					...process.env,
					GOBIN: tmpDir, // sets the installation directory to the temp dir
				},
			});

			return 'api-linter installed successfully';
		} catch (error) {
			return 'failed to install api-linter: ${error}';
		}
	} else {
		return 'api-linter is already installed';
	}
}

async function requestLinting(document: TextDocument): Promise<string> {
	const exec = util.promisify(child_process.exec);

	const fileURI = document.uri;
	const urlObject = new URL(fileURI);
	const filePath = path.normalize(urlObject.pathname);

	connection.console.log('filePath: ${ filePath }');
	try {
		const { stdout, stderr } = await exec(`${tmpLinterPath} ${filePath}`);
		return stdout;
	} catch (error) {
		return 'error running api-linter:' + error;
	}
}

class Problem {
	message: string;
	suggestion?: string;
	range: Range;
	rule_id: string;
	rule_doc_uri: string;

	constructor(
		message: string,
		range: Range,
		rule_id: string,
		rule_doc_uri: string,
		suggestion?: string
	) {
		this.message = message;
		this.range = range;
		this.rule_id = rule_id;
		this.rule_doc_uri = rule_doc_uri;
		if (suggestion) {
			this.suggestion = suggestion;
		}
	}

	toString() {
		return `- message: ${this.message}
    ${this.suggestion ? `suggestion: ${this.suggestion}` : ''}
    location:
      start_position:
        line_number: ${this.range.start.line}
        column_number: ${this.range.start.character}
      end_position:
        line_number: ${this.range.end.line}
        column_number: ${this.range.end.character}
    rule_id: ${this.rule_id}
    rule_doc_uri: ${this.rule_doc_uri}`;
	}
}

class LinterObject {
	file_path: string;
	problems: Problem[];
	constructor(file_path: string, problems: Problem[]) {
		this.file_path = file_path;
		this.problems = problems;
	}
	toString() {
		return `- file_path: ${this.file_path}
		  problems:
			${this.problems.map((problem) => problem.toString()).join('\n')}`;
	}
}

function extractLintObjects(lintingText: string): LinterObject[] {
	const fileRegex = /- file_path: (.*)\n\s*problems:/g;
	const problemRegex = /\n\s*- message: ([\s\S]*?)(?=rule_id:)/g;
	const locationRegex =
		/location:\n\s*start_position:\n\s*line_number: (\d+)\n\s*column_number: (\d+)\n\s*end_position:\n\s*line_number: (\d+)\n\s*column_number: (\d+)/g;
	const ruleIdRegex = /rule_id: (.*)/g;
	const ruleDocUriRegex = /rule_doc_uri: (.*)/g;
	const suggestionRegex = /suggestion: (.*)/g;
	const suggestion = 'TODO';
	let match;
	const outputData: LinterObject[] = [];

	while ((match = fileRegex.exec(lintingText)) && true) {
		const filePath = match[1];
		const problems: Problem[] = [];

		while ((match = problemRegex.exec(lintingText)) && true) {
			const fullMessage = match[1].trim();
			const message = fullMessage
				.replace(locationRegex, '')
				.replace(suggestionRegex, '')
				.trim();
			const locationMatch = locationRegex.exec(lintingText);
			const ruleIdMatch = ruleIdRegex.exec(lintingText);
			const ruleDocUriMatch = ruleDocUriRegex.exec(lintingText);

			const p1: Position = Position.create(
				locationMatch ? parseInt(locationMatch[1]) : 0,
				locationMatch ? parseInt(locationMatch[2]) : 0
			);
			const p2: Position = Position.create(
				locationMatch ? parseInt(locationMatch[3]) : 0,
				locationMatch ? parseInt(locationMatch[4]) : 0
			);
			const range: Range = Range.create(p1, p2);

			const rule_id = ruleIdMatch ? ruleIdMatch[1] : '';
			const rule_doc_uri = ruleDocUriMatch ? ruleDocUriMatch[1] : '';
			const problem = new Problem(message, range, rule_id, rule_doc_uri, suggestion);
			problems.push(problem);
		}

		const lintObject = new LinterObject(filePath, problems);

		outputData.push(lintObject);
	}

	return outputData;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
	documentSettings.delete(e.document.uri);
});

documents.onDidSave(async (change) => {
	await validateTextDocument(change.document);
});

async function requestGptSuggestions(
	lintObjects: LinterObject[],
	textDocument: TextDocument
): Promise<LinterObject[]> {
	const lintObjectString = lintObjects[0].toString();
	const prompt = `For each item in linting output:\n\n${lintObjectString}\n\n, refer to the .proto file that it was generated from:\n\n${textDocument.getText()}\n\n and suggest a fix to the code such that the linting item message is addressed. Only return the edited linting output string, with the suggestion fields (marked with TODOs) filled in. Do not return any other content in your response.`;
	const url = 'https://api.openai.com/v1/chat/completions';
	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
		'Organization-ID': 'org-7Yj83jSiXzi17aqcuLZC96ya',
	};

	const data = {
		model: 'gpt-3.5-turbo',
		messages: [{ role: 'user', content: prompt }],
		temperature: 0.7,
	};

	try {
		// const response = await axios.post(url, data, { headers: headers });
		// connection.console.log('response: ' + JSON.stringify(response.data.choices[0]));
		// return ' ' + response.data.choices[0].message.content;
		// const modLintingText = extractLintObjects(response.data.choices[0].message.content);
		const modLintingText = extractLintObjects(lintObjectString);
		return modLintingText;
	} catch (error: any) {
		let errorMsg = '';

		if (error && error.response) {
			errorMsg += `Error status code: ${error.response.status}\n`;
			errorMsg += `Error data: ${JSON.stringify(error.response.data)}\n`;
		} else if (error && error.request) {
			errorMsg += 'No response was received: ' + JSON.stringify(error.request) + '\n';
		} else if (error) {
			errorMsg += 'Request setup error: ' + error.message + '\n';
		}
		errorMsg +=
			error && error.config ? 'Error config: ' + JSON.stringify(error.config) : '';

		return [];
	}
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	const lintingText = await requestLinting(textDocument);
	const lintObjects = extractLintObjects(lintingText);
	const suggestedLintObjects = await requestGptSuggestions(lintObjects, textDocument);

	const diagnostics: Diagnostic[] = [];
	let problems = 0;
	for (const object of suggestedLintObjects) {
		for (const problem of object.problems) {
			problems++;
			const lint = problem.message;
			const suggest = problem.suggestion;
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				range: problem.range,
				message: `${lint}`,
				source: `proto-lindtTODO`,
			};
			if (hasDiagnosticRelatedInformationCapability) {
				diagnostic.relatedInformation = [
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, problem.range),
						},
						message: suggest!,
					},
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, problem.range),
						},
						message: problem.rule_doc_uri,
					},
				];
			}
			diagnostics.push(diagnostic);
		}
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		return [
			{
				label: 'TypeScript',
				kind: CompletionItemKind.Text,
				data: 1,
			},
			{
				label: 'JavaScript',
				kind: CompletionItemKind.Text,
				data: 2,
			},
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = 'TypeScript details';
		item.documentation = 'TypeScript documentation';
	} else if (item.data === 2) {
		item.detail = 'JavaScript details';
		item.documentation = 'JavaScript documentation';
	}
	return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
