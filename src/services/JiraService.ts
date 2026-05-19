import { JiraTicket, ExtensionConfig } from '../types';

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: string | null;
    status: { name: string };
    priority: { name: string };
    issuetype: { name: string };
    reporter: { displayName: string };
    created: string;
    updated: string;
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  isLast: boolean;
  nextPageToken?: string;
}

interface JiraTransition {
  id: string;
  name: string;
}

interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

export class JiraService {
  constructor(
    private config: ExtensionConfig,
    private apiToken: string,
    private logger?: (message: string) => void
  ) {}

  private log(message: string): void {
    if (this.logger) {
      this.logger(message);
    }
  }

  async searchTickets(): Promise<JiraTicket[]> {
    const tickets: JiraTicket[] = [];
    let nextPageToken: string | undefined;
    const maxResults = 50;
    let isLast = false;

    this.log('[JIRA] Iniciando búsqueda de tickets');
    this.log(`[JIRA] JQL Query: ${this.config.jiraJql}`);

    while (!isLast) {
      try {
        this.log(`[JIRA] Buscando tickets con ${maxResults} resultados máximos${nextPageToken ? ' y nextPageToken' : ''}`);
        const response = await this.makeRequest<JiraSearchResponse>('/rest/api/3/search/jql', {
          method: 'POST',
          body: JSON.stringify({
            jql: this.config.jiraJql,
            fields: [
              'summary',
              'description',
              'status',
              'priority',
              'issuetype',
              'reporter',
              'created',
              'updated',
            ],
            maxResults,
            ...(nextPageToken ? { nextPageToken } : {}),
          }),
        });

        isLast = response.isLast;
        nextPageToken = response.nextPageToken;

        this.log(`[JIRA] Respuesta recibida: ${response.issues.length} tickets en esta página`);
        const mapped = response.issues.map(issue => this.mapToTicket(issue));
        tickets.push(...mapped);

        this.log(`[JIRA] Tickets acumulados: ${tickets.length}`);

        if (!isLast && !nextPageToken) {
          throw new Error('Respuesta de Jira incompleta: falta nextPageToken para continuar la paginación');
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('429')) {
          this.log('[JIRA] Rate limit alcanzado (429), esperando 30 segundos...');
          await new Promise(resolve => setTimeout(resolve, 30000));
          continue;
        }
        this.log(`[JIRA] Error en búsqueda: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }
    }

    this.log(`[JIRA] Búsqueda completada. Total de tickets encontrados: ${tickets.length}`);
    return tickets;
  }

  async getTransitions(key: string): Promise<{ id: string; name: string }[]> {
    const url = `/rest/api/3/issue/${key}/transitions`;
    const response = await this.makeRequest<JiraTransitionsResponse>(url);
    return response.transitions;
  }

  async applyTransition(key: string, transitionId: string): Promise<void> {
    const url = `/rest/api/3/issue/${key}/transitions`;
    const body = {
      transition: {
        id: transitionId,
      },
    };

    await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async postComment(key: string, markdownText: string): Promise<void> {
    const url = `/rest/api/3/issue/${key}/comment`;
    const body = {
      body: this.markdownToAdf(markdownText),
    };

    await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private mapToTicket(issue: JiraIssue): JiraTicket {
    return {
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description,
      status: issue.fields.status.name,
      priority: issue.fields.priority.name,
      issueType: issue.fields.issuetype.name,
      reporter: issue.fields.reporter.displayName,
      created: issue.fields.created,
      updated: issue.fields.updated,
      url: `${this.config.jiraUrl}/browse/${issue.key}`,
    };
  }

  private markdownToAdf(text: string): object {
    const lines = text.split('\n');
    const content: object[] = [];

    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }

      if (line.startsWith('# ')) {
        content.push({
          type: 'heading',
          attrs: { level: 1 },
          content: this.parseInlineContent(line.substring(2)),
        });
      } else if (line.startsWith('## ')) {
        content.push({
          type: 'heading',
          attrs: { level: 2 },
          content: this.parseInlineContent(line.substring(3)),
        });
      } else if (line.startsWith('- ')) {
        content.push({
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: this.parseInlineContent(line.substring(2)),
                },
              ],
            },
          ],
        });
      } else {
        content.push({
          type: 'paragraph',
          content: this.parseInlineContent(line),
        });
      }
    }

    return {
      type: 'doc',
      version: 1,
      content,
    };
  }

  private parseInlineContent(text: string): object[] {
    const content: object[] = [];
    const linkPattern = /\[([^\]]+)\]\(<([^>]+)>\)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkPattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        content.push({
          type: 'text',
          text: text.slice(lastIndex, match.index),
        });
      }

      content.push({
        type: 'text',
        text: match[1],
        marks: [
          {
            type: 'link',
            attrs: {
              href: match[2],
            },
          },
        ],
      });

      lastIndex = linkPattern.lastIndex;
    }

    if (lastIndex < text.length) {
      content.push({
        type: 'text',
        text: text.slice(lastIndex),
      });
    }

    return content.length > 0 ? content : [{ type: 'text', text }];
  }

  private async makeRequest<T>(
    url: string,
    options?: RequestInit
  ): Promise<T> {
    const fullUrl = url.startsWith('http')
      ? url
      : new URL(url, this.config.jiraUrl).toString();

    const auth = Buffer.from(
      `${this.config.jiraEmail}:${this.apiToken}`
    ).toString('base64');

    const method = options?.method || 'GET';
    this.log(`[JIRA-API] ${method} ${fullUrl.split('?')[0]}`);

    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options?.headers,
      },
    });

    this.log(`[JIRA-API] Respuesta: ${response.status} ${response.statusText}`);

    if (response.status === 401) {
      throw new Error('API Token inválido o expirado');
    }

    if (response.status === 403) {
      throw new Error('Sin permisos en este proyecto');
    }

    if (response.status === 404) {
      throw new Error('Ticket no encontrado');
    }

    if (response.status === 429) {
      throw new Error('429 - Rate limit alcanzado');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      const details = errorBody ? ` - ${errorBody}` : '';

      if (response.status === 410) {
        throw new Error(
          `Error 410: endpoint de búsqueda Jira removido. Use /rest/api/3/search/jql.${details}`
        );
      }

      throw new Error(
        `Error ${response.status}: ${response.statusText}${details}`
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }
}
