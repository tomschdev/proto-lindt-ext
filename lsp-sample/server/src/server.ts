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

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

// import { Position, Range } from 'vscode';
import * as util from 'util';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as https from 'https';
import { URL } from 'url';
import { Configuration, OpenAIApi } from 'openai';

const configuration = new Configuration({
//   apiKey: process.env.OPENAI_API_KEY, TODO
  apiKey: "xxx", 
});
const openai = new OpenAIApi(configuration);

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const tmpDir = "/Users/thomasscholtz/go/bin/";
const tmpLinterPath = path.join(tmpDir, 'api-linter');

const agent = new https.Agent({
	rejectUnauthorized: false
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
				resolveProvider: true
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
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
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
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

connection.onDidChangeConfiguration(change => {
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
			section: 'languageServerExample'
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

			return "api-linter installed successfully";
		} catch (error) {
			return "failed to install api-linter: ${error}";
		}
	} else {
		return 'api-linter is already installed';
	}
}

async function applyLinter(document: TextDocument): Promise<string | undefined> {
	const exec = util.promisify(child_process.exec);

	const fileURI = document.uri;
	const urlObject = new URL(fileURI);
	const filePath = path.normalize(urlObject.pathname);

	connection.console.log("filePath: ${ filePath }");
	// const filePath = fileURI.fsPath;
	try {
		const { stdout, stderr } = await exec(`${tmpLinterPath} ${filePath}`);
		return stdout;
	} catch (error) {
		return "error running api-linter:" + error;
	}
}

type Problem = {
	message: string,
	suggestion?: string,
	range: Range,
	rule_id: string,
	rule_doc_uri: string
};

type LinterOutput = {
	file_path: string,
	problems: Problem[]
};

function extractLinterOutput(output: string): LinterOutput[] {


	const fileRegex = /- file_path: (.*)\n\s*problems:/g;
	const problemRegex = /\n\s*- message: ([\s\S]*?)(?=rule_id:)/g;
	const locationRegex = /location:\n\s*start_position:\n\s*line_number: (\d+)\n\s*column_number: (\d+)\n\s*end_position:\n\s*line_number: (\d+)\n\s*column_number: (\d+)/g;
	const ruleIdRegex = /rule_id: (.*)/g;
	const ruleDocUriRegex = /rule_doc_uri: (.*)/g;

	let match;
	const outputData: LinterOutput[] = [];

	while ((match = fileRegex.exec(output)) && true) {
		const filePath = match[1];
		const problems: Problem[] = [];

		while ((match = problemRegex.exec(output)) && true) {
			const fullMessage = match[1].trim();
			const message = fullMessage.replace(locationRegex, '').trim();
			const locationMatch = locationRegex.exec(output);
			const ruleIdMatch = ruleIdRegex.exec(output);
			const ruleDocUriMatch = ruleDocUriRegex.exec(output);

			const p1: Position = Position.create(locationMatch ? parseInt(locationMatch[1]) : 0, locationMatch ? parseInt(locationMatch[2]) : 0);
			const p2: Position = Position.create(locationMatch ? parseInt(locationMatch[3]) : 0, locationMatch ? parseInt(locationMatch[4]) : 0);
			const range: Range = Range.create(p1, p2);

			const problem: Problem = {
				message,
				range,
				rule_id: ruleIdMatch ? ruleIdMatch[1] : '',
				rule_doc_uri: ruleDocUriMatch ? ruleDocUriMatch[1] : '',
			};

			problems.push(problem);
		}

		const linterOutput: LinterOutput = {
			file_path: filePath,
			problems
		};

		outputData.push(linterOutput);
	}

	return outputData;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async change => {
	await validateTextDocument(change.document);
});

async function getSuggestion(problem: Problem, textDocument: TextDocument): Promise<string> {
	
	// Data you want to send in the request
	const text = textDocument.getText(problem.range);
	const file = textDocument.getText();
	const linting: Problem = problem;
	const prompt = `Given the .proto file:\n\n${file}\n\n, and the linting output:\n\n${JSON.stringify(linting, null, 2)}\n\n in reference to the section: \n\n${text}\n\n, suggest a fix to address the linting output.`;
	
	try {
		const response = await openai.createCompletion({
			model: "text-davinci-003",
			prompt: prompt,
			temperature: 0,
			max_tokens: 7,
		});
		return response.data.choices[0].text?.toString() ?? "";
	} catch (error) {
		return "" + error;
	}
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {

	const linting = await applyLinter(textDocument);
	if (!linting) {
		return;
	}
	connection.console.log("Current file linting: " + linting);

	let problems = 0;
	const diagnostics: Diagnostic[] = [];
	const m = extractLinterOutput(linting);
	for (const linterOutput of m) {
		for (const problem of linterOutput.problems) {
			problems++;

			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				range: problem.range,
				message: `${problem.message}`,
				source: `proto-lindtTODO`,
			};
			if (hasDiagnosticRelatedInformationCapability) {
				const suggestion = await getSuggestion(problem, textDocument);
				diagnostic.relatedInformation = [
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, diagnostic.range)
						},
						message: suggestion.toString()
					},
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, diagnostic.range)
						},
						message: problem.rule_id + " : " + problem.rule_doc_uri
					},
				];
			}
			diagnostics.push(diagnostic);
		}
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// 	// Send the computed diagnostics to VSCode.
// 	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
// }
connection.onDidChangeWatchedFiles(_change => {
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
				data: 1
			},
			{
				label: 'JavaScript',
				kind: CompletionItemKind.Text,
				data: 2
			}
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
