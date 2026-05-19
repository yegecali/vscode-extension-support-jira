import * as vscode from 'vscode';
import { ConfigManager } from './config/ConfigManager';
import { SecretManager } from './services/SecretManager';
import { JiraService } from './services/JiraService';
import { LlmService } from './services/LlmService';
import { NewmanService } from './services/NewmanService';
import { ClassifierEngine } from './core/ClassifierEngine';
import { UrlBuilder } from './core/UrlBuilder';
import { CommentBuilder } from './core/CommentBuilder';
import { PromptLoader } from './core/PromptLoader';
import { SupportController } from './support/SupportController';
import { TicketPanel } from './ui/TicketPanel';
import { TicketResult } from './types';

let statusBarItem: vscode.StatusBarItem;
let supportController: SupportController;
let ticketPanel: TicketPanel;
let jiraService: JiraService;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    outputChannel = vscode.window.createOutputChannel('Jira Classifier');
    const logger = (message: string): void => {
      const timestamp = new Date().toISOString();
      outputChannel.appendLine(`[${timestamp}] ${message}`);
    };

    const configManager = ConfigManager.getInstance();
    const config = configManager.getConfig();

    configManager.validate();

    const secretManager = new SecretManager(context.secrets);
    let apiToken = await secretManager.getApiToken();

    if (!apiToken) {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Jira API token',
        password: true,
        ignoreFocusOut: true,
      });

      if (!token) {
        vscode.window.showErrorMessage(
          'Jira API token is required. Please configure it in settings.'
        );
        return;
      }

      await secretManager.saveApiToken(token);
      apiToken = token;
    }

    jiraService = new JiraService(config, apiToken, logger);
    const llmService = new LlmService(logger);
    const newmanService = new NewmanService(config, logger);
    const classifier = new ClassifierEngine();
    const urlBuilder = new UrlBuilder();
    const commentBuilder = new CommentBuilder();

    const handleResultsUpdated = (results: TicketResult[]): void => {
      if (ticketPanel) {
        ticketPanel.updateResults(results);
      }
    };

    const promptLoader = new PromptLoader();

    supportController = new SupportController(
      context,
      jiraService,
      llmService,
      newmanService,
      classifier,
      urlBuilder,
      commentBuilder,
      promptLoader,
      config,
      handleResultsUpdated,
      outputChannel
    );

    const registerCommand = (command: string, callback: (...args: any[]) => any): void => {
      context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    };

    registerCommand('jiraClassifier.startSupport', () => {
      supportController.start();
      updateStatusBar();
      vscode.window.showInformationMessage('Jira Classifier iniciado');
    });

    registerCommand('jiraClassifier.stopSupport', () => {
      supportController.stop();
      updateStatusBar();
      vscode.window.showInformationMessage('Jira Classifier detenido');
    });

    registerCommand('jiraClassifier.refresh', async () => {
      try {
        await supportController.runCycle();
        updateStatusBar();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Error al ejecutar ciclo: ${message}`);
      }
    });

    registerCommand('jiraClassifier.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'jiraClassifier');
    });

    registerCommand('jiraClassifier.showPanel', () => {
      ticketPanel = TicketPanel.createOrShow(supportController, jiraService);
    });

    registerCommand('jiraClassifier.clearCache', async () => {
      await supportController.clearCache();
      updateStatusBar();
    });

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'jiraClassifier.showPanel';
    context.subscriptions.push(statusBarItem);

    updateStatusBar();

    ticketPanel = TicketPanel.createOrShow(supportController, jiraService);

    configManager.onDidChange(() => {
      vscode.window.showInformationMessage('Configuration changed. Please restart the extension.');
    });

    supportController.start();

    vscode.window.showInformationMessage('Jira Classifier activado');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Error al activar Jira Classifier: ${message}`);
  }
}

export function deactivate(): void {
  if (supportController) {
    supportController.stop();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  if (supportController.running) {
    statusBarItem.text = '$(debug-start) Jira Classifier: EN EJECUCIÓN';
    statusBarItem.tooltip = 'Click para ver tickets • Ciclo en ejecución';
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
  } else {
    statusBarItem.text = '$(debug-stop) Jira Classifier: DETENIDO';
    statusBarItem.tooltip = 'Click para ver tickets • Ciclo detenido';
    statusBarItem.backgroundColor = undefined;
  }

  statusBarItem.show();
}
