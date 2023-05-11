/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as fs from 'fs';
import { subscribeToDocumentChanges, EMOJI_MENTION } from './diagnostics';
import { UnderlyingByteSource } from 'stream/web';

const COMMAND = 'code-actions-sample.command';

export async function activate(context: vscode.ExtensionContext) {
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
		}));

	// subscribeToDocumentChanges(context, emojiDiagnostics);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND, (aip) => vscode.env.openExternal(vscode.Uri.parse('https://google.aip.dev/${ aip }'))) //TODO
	);
	console.log('Extension activated!');

}

/**
 * Provides code actions for converting :) to a smiley emoji.
 */
export class LindtSuggester implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
		const linting = await this.applyAPILinter(document);
		console.log("Current file linting: " + linting);

		// const replaceWithSmileyCatFix = this.createFix(document, range, '😺');

		// const replaceWithSmileyFix = this.createFix(document, range, '😀');
		// Marking a single fix as `preferred` means that users can apply it with a
		// single keyboard shortcut using the `Auto Fix` command.
		// replaceWithSmileyFix.isPreferred = true;

		// const replaceWithSmileyHankyFix = this.createFix(document, range, '💩');

		// const commandAction = this.createCommand();

		// return [
		// 	replaceWithSmileyCatFix,
		// 	replaceWithSmileyFix,
		// 	replaceWithSmileyHankyFix,
		// 	commandAction
		// ];
		return;
	}

	private async applyAPILinter(document: vscode.TextDocument): Promise<string | undefined> {
		const exec = util.promisify(child_process.exec);
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'api-linter'));
		const binaryPath = path.join(tempDir, 'api-linter');

		// Apply the linter to the current file
		// Get the active file's URI
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			console.log('No active text editor found.');
			return;
		}
		const fileURI = editor.document.uri;
		const filePath = fileURI.fsPath;
		try {
			const { stdout, stderr } = await exec(`${binaryPath} ${filePath}`);
			return stdout;
		} catch (error) {
			console.log('Error running api-linter:', error);
			return;
		}
	}

	private createFix(document: vscode.TextDocument, range: vscode.Range, emoji: string): vscode.CodeAction {
		const fix = new vscode.CodeAction(`Convert to ${emoji}`, vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();
		fix.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), emoji);
		return fix;
	}

	private createCommand(): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
		action.command = { command: COMMAND, title: 'Learn more about AIP', tooltip: 'This will open the AIP that is suggesting the code edit.' };
		return action;
	}
}

/**
 * Provides code actions corresponding to diagnostic problems.
 */
export class Emojinfo implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
		// for each diagnostic entry that has the matching `code`, create a code action command
		return context.diagnostics
			.filter(diagnostic => diagnostic.code === EMOJI_MENTION)
			.map(diagnostic => this.createCommandCodeAction(diagnostic));
	}

	private createCommandCodeAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.QuickFix);
		action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		return action;
	}
}