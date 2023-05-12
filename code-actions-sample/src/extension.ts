/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import * as util from 'util';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const COMMAND = 'code-actions-sample.command';
const EMOJI_MENTION = 'emoji_mention';

export async function activate(context: vscode.ExtensionContext) {
	

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('proto3', new Emojizer(), {
			providedCodeActionKinds: Emojizer.providedCodeActionKinds
		})	
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('proto3', new Emojinfo(), {
			providedCodeActionKinds: Emojinfo.providedCodeActionKinds
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND, () => vscode.env.openExternal(vscode.Uri.parse('https://unicode.org/emoji/charts-12.0/full-emoji-list.html')))
	);
	vscode.window.showInformationMessage('Extension activated!');

}

/**
 * Provides code actions for converting :) to a smiley emoji.
 */
export class Emojizer implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
		const tempDir = os.tmpdir();
		const linterPath = path.join(tempDir, 'api-linter');
		const installApiLinter = async (): Promise<void> => {
			if (!fs.existsSync(linterPath)) {
				console.log('api-linter not found. Installing...');
				const cmd = 'go install github.com/googleapis/api-linter/cmd/api-linter@latest';
				try {
					child_process.execSync(cmd, {
						env: {
						...process.env,
						GOBIN: tempDir, // sets the installation directory to the temp dir
						},
					});

					console.log('api-linter installed successfully');
				} catch (error) {
					console.error(`failed to install api-linter: ${error}`);
				}
			} else {
				console.log('api-linter is already installed');
			}
		};
		installApiLinter();

		const linting = await this.applyLinter(document, linterPath);
		console.log("Current file linting: " + linting);

		const replaceWithSmileyCatFix = this.createFix(document, range, '😺');

		const replaceWithSmileyFix = this.createFix(document, range, '😀');
		// Marking a single fix as `preferred` means that users can apply it with a
		// single keyboard shortcut using the `Auto Fix` command.
		replaceWithSmileyFix.isPreferred = true;

		const replaceWithSmileyHankyFix = this.createFix(document, range, '💩');

		const commandAction = this.createCommand();

		return [
			replaceWithSmileyCatFix,
			replaceWithSmileyFix,
			replaceWithSmileyHankyFix,
			commandAction
		];
	}

	private async applyLinter(document: vscode.TextDocument, linterPath: string): Promise<string | undefined> {
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
			const { stdout, stderr } = await exec(`${linterPath} ${filePath}`);
			return stdout;
		} catch (error) {
			vscode.window.showInformationMessage('Error running api-linter:' + error);
			return;
		}
	}

	private isAtStartOfSmiley(document: vscode.TextDocument, range: vscode.Range) {
		const start = range.start;
		const line = document.lineAt(start.line);
		return line.text[start.character] === ':' && line.text[start.character + 1] === ')';
	}

	private createFix(document: vscode.TextDocument, range: vscode.Range, emoji: string): vscode.CodeAction {
		const fix = new vscode.CodeAction(`Convert to ${emoji}`, vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();
		fix.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), emoji);
		return fix;
	}

	private createCommand(): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
		action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
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