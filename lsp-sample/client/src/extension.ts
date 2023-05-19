/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import {
	workspace,
	ExtensionContext,
	CancellationToken,
	CodeAction,
	CodeActionContext,
	CodeActionKind,
	CodeActionProvider,
	Diagnostic,
	Range,
	Selection,
	TextDocument,
	Uri,
	commands,
	env,
	languages,
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

const SUGGESTION_COMMAND = 'apply-suggestion.command';
const REDIRECT_COMMAND = 'aip-redirect.command';

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		},
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'proto3' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.proto'),
		},
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'languageServerExample',
		'Language Server Example',
		serverOptions,
		clientOptions
	);

	context.subscriptions.push(
		commands.registerCommand(REDIRECT_COMMAND, (args) =>
			env.openExternal(Uri.parse(args))
		)
	);

	context.subscriptions.push(
		languages.registerCodeActionsProvider('proto', new ProtoRedirect(), {
			providedCodeActionKinds: ProtoRedirect.providedCodeActionKinds,
		})
	);
	// context.subscriptions.push(
	// 	commands.registerCommand(SUGGESTION_COMMAND, () =>
	// 		env.openExternal(
	// 			Uri.parse('https://unicode.org/emoji/charts-12.0/full-emoji-list.html')
	// 		)
	// 	)
	// );

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

export class ProtoRedirect implements CodeActionProvider {
	public static readonly providedCodeActionKinds = [CodeActionKind.QuickFix];

	provideCodeActions(
		document: TextDocument,
		range: Range | Selection,
		context: CodeActionContext,
		token: CancellationToken
	): CodeAction[] {
		// for each diagnostic entry that has the matching `code`, create a code action command
		return context.diagnostics
			.filter(
				(diagnostic) =>
					diagnostic.code.toString() ==
					`AIP-000${context.diagnostics.indexOf(diagnostic)}`
			)
			.map((diagnostic) => this.createRedirectCodeAction(diagnostic));
	}

	private createRedirectCodeAction(diagnostic: Diagnostic): CodeAction {
		const action = new CodeAction('Visit AIP', CodeActionKind.QuickFix);
		action.command = {
			command: REDIRECT_COMMAND,
			title: 'Visit AIP',
			tooltip: 'This will redirect you to the AIP docs',
		};
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		return action;
	}
}

export class ProtoSuggest implements CodeActionProvider {
	public static readonly providedCodeActionKinds = [CodeActionKind.QuickFix];

	provideCodeActions(
		document: TextDocument,
		range: Range | Selection,
		context: CodeActionContext,
		token: CancellationToken
	): CodeAction[] {
		// for each diagnostic entry that has the matching `code`, create a code action command
		return context.diagnostics
			.filter((diagnostic) => diagnostic)
			.map((diagnostic) => this.createSuggestionCodeAction(diagnostic));
	}

	private createSuggestionCodeAction(diagnostic: Diagnostic): CodeAction {
		const action = new CodeAction('Apply suggestion', CodeActionKind.QuickFix);
		action.command = {
			command: SUGGESTION_COMMAND,
			title: 'Apply Suggestion',
			tooltip: 'This will apply the suggestion to the file',
		};
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		return action;
	}
}
