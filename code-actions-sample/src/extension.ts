/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as fs from 'fs';
import { subscribeToDocumentChanges } from './diagnostics';

const COMMAND = 'aip-redirect.command';

export async function activate(context: vscode.ExtensionContext) {
	vscode.window.showInformationMessage('Extension activated!');
	const exec = util.promisify(child_process.exec);

    // Download the api-linter binary
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'api-linter'));
    try {
		console.log(tempDir);
		await exec('go install github.com/googleapis/api-linter/cmd/api-linter@latest', {
		env: { ...process.env, GOBIN: tempDir },
		});
    } catch (error) {
		console.log('Error downloading api-linter binary:', error);
		return;
    }

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('proto', new LindtSuggester(), {
			providedCodeActionKinds: LindtSuggester.providedCodeActionKinds
		})
	);

	subscribeToDocumentChanges(context, vscode.languages.createDiagnosticCollection('api-linter'));

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND, (aip) => vscode.env.openExternal(vscode.Uri.parse('https://google.aip.dev/${ aip }'))) //TODO
	);
	console.log('Extension activated!');

}

/**
 * Provides code actions to address google's api-linter feedback.
 */
export class LindtSuggester implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	private disposables: vscode.Disposable[] = [];
	constructor() {
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument(this.handleDocumentSave, this)
		);
	}

	dispose() {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	// Chain this function to the document save event, to suggest fixes for linter feedback
	public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
		
		const linting = this.applyLinter(document);
		if (linting) {
			vscode.window.showInformationMessage("Current file linting: " + linting);
		} else {
			vscode.window.showInformationMessage("No linting returned.");
		}
		return;
	}

	private async applyLinter(document: vscode.TextDocument): Promise<string | undefined> {
		const exec = util.promisify(child_process.exec);
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'api-linter'));
		const binaryPath = path.join(tempDir, 'api-linter');

		// Apply the linter to the current file
		// Get the active file's URI
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active text editor found.');
			return;
		}
		const fileURI = editor.document.uri;
		const filePath = fileURI.fsPath;
		try {
			const { stdout, stderr } = await exec(`${binaryPath} ${filePath}`);
			return stdout;
		} catch (error) {
			vscode.window.showInformationMessage('Error running api-linter:' + error);
			return;
		}
	}

	// For reference
	// private createFix(document: vscode.TextDocument, range: vscode.Range, emoji: string): vscode.CodeAction {
	// 	const fix = new vscode.CodeAction(`Convert to ${emoji}`, vscode.CodeActionKind.QuickFix);
	// 	fix.edit = new vscode.WorkspaceEdit();
	// 	fix.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), emoji);
	// 	return fix;
	// }

	// private createCommand(): vscode.CodeAction {
	// 	const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
	// 	action.command = { command: COMMAND, title: 'Learn more about AIP', tooltip: 'This will open the AIP that is suggesting the code edit.' };
	// 	return action;
	// }

	private handleDocumentSave(document: vscode.TextDocument) {
		const linting = this.applyLinter(document);
		if (linting) {
			vscode.window.showInformationMessage("Current file linting: " + linting);
		} else {
			vscode.window.showInformationMessage("No linting returned.");
		}
	}
}

/**
 * Provides code actions corresponding to diagnostic problems.
 */
// export class Emojinfo implements vscode.CodeActionProvider {

// 	public static readonly providedCodeActionKinds = [
// 		vscode.CodeActionKind.QuickFix
// 	];

// 	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
// 		// for each diagnostic entry that has the matching `code`, create a code action command
// 		return context.diagnostics
// 			.filter(diagnostic => diagnostic.code === EMOJI_MENTION)
// 			.map(diagnostic => this.createCommandCodeAction(diagnostic));
// 	}

// 	private createCommandCodeAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
// 		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.QuickFix);
// 		action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
// 		action.diagnostics = [diagnostic];
// 		action.isPreferred = true;
// 		return action;
// 	}
// }
