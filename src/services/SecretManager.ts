import * as vscode from 'vscode';

const JIRA_API_TOKEN_KEY = 'jira-api-token';

export class SecretManager {
  constructor(private secrets: vscode.SecretStorage) {}

  async saveApiToken(token: string): Promise<void> {
    await this.secrets.store(JIRA_API_TOKEN_KEY, token);
  }

  async getApiToken(): Promise<string | undefined> {
    return await this.secrets.get(JIRA_API_TOKEN_KEY);
  }

  async clearApiToken(): Promise<void> {
    await this.secrets.delete(JIRA_API_TOKEN_KEY);
  }
}
