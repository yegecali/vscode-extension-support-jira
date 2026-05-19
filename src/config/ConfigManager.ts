import * as vscode from 'vscode';
import { ExtensionConfig } from '../types';

export class ConfigManager {
  private static instance: ConfigManager;

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('jiraClassifier');

    return {
      jiraUrl: config.get('jiraUrl') || '',
      jiraEmail: config.get('jiraEmail') || '',
      jiraProject: config.get('jiraProject') || '',
      jiraJql: config.get('jiraJql') || 'project = BANK AND status != Closed',
      grafanaUrlTemplate: config.get('grafanaUrlTemplate') || '',
      kibanaUrlTemplate: config.get('kibanaUrlTemplate') || '',
      pollingIntervalMinutes: config.get('pollingIntervalMinutes') || 10,
      scoreThreshold: config.get('scoreThreshold') || 0.5,
      promptsDirectory: config.get('promptsDirectory') || '',
      promptsDocumentation: config.get('promptsDocumentation') || '',
    };
  }

  validate(): void {
    const config = this.getConfig();

    if (!config.jiraUrl.trim()) {
      throw new Error(
        'Configuración incompleta: jiraClassifier.jiraUrl no está configurada'
      );
    }

    if (!config.jiraEmail.trim()) {
      throw new Error(
        'Configuración incompleta: jiraClassifier.jiraEmail no está configurada'
      );
    }

    if (!config.jiraProject.trim()) {
      throw new Error(
        'Configuración incompleta: jiraClassifier.jiraProject no está configurada'
      );
    }

    try {
      new URL(config.jiraUrl);
    } catch {
      throw new Error(`URL de Jira inválida: ${config.jiraUrl}`);
    }

    if (!config.jiraUrl.startsWith('https://')) {
      throw new Error('URL de Jira debe ser HTTPS por seguridad');
    }
  }

  onDidChange(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('jiraClassifier')) {
        callback();
      }
    });
  }
}
