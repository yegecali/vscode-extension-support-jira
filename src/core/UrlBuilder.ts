import { JiraTicket, ClassifierPrompt, MarkdownFrontmatter } from '../types';

export class UrlBuilder {
  buildGrafanaUrl(
    ticket: JiraTicket,
    prompt: ClassifierPrompt,
    grafanaBaseUrl: string
  ): string {
    if (!grafanaBaseUrl) {
      return '';
    }

    const baseUrl = new URL(prompt.grafanaDashboard, grafanaBaseUrl).toString();
    const url = new URL(baseUrl);

    const requestId = this.extractRequestId(ticket.description);
    if (requestId) {
      url.searchParams.set('var-requestId', requestId);
    }

    url.searchParams.set('var-ticketKey', ticket.key);
    url.searchParams.set('from', 'now-1h');

    return url.toString();
  }

  buildKibanaUrl(
    ticket: JiraTicket,
    prompt: ClassifierPrompt,
    kibanaBaseUrl: string
  ): string {
    if (!kibanaBaseUrl) {
      return '';
    }

    const baseUrl = new URL(prompt.kibanaDashboard, kibanaBaseUrl).toString();
    const url = new URL(baseUrl);

    const aQuery = {
      query: {
        match_phrase: {
          ticket: ticket.key,
        },
      },
    };

    url.searchParams.set('_a', JSON.stringify(aQuery));

    return url.toString();
  }

  buildGrafanaUrlFromMarkdown(
    ticket: JiraTicket,
    frontmatter: MarkdownFrontmatter,
    grafanaBaseUrl: string
  ): string {
    if (!grafanaBaseUrl) {
      return '';
    }

    const baseUrl = new URL(frontmatter.grafanaDashboard, grafanaBaseUrl).toString();
    const url = new URL(baseUrl);

    const requestId = this.extractRequestId(ticket.description);
    if (requestId) {
      url.searchParams.set('var-requestId', requestId);
    }

    url.searchParams.set('var-ticketKey', ticket.key);
    url.searchParams.set('from', 'now-1h');

    return url.toString();
  }

  buildKibanaUrlFromMarkdown(
    ticket: JiraTicket,
    frontmatter: MarkdownFrontmatter,
    kibanaBaseUrl: string
  ): string {
    if (!kibanaBaseUrl) {
      return '';
    }

    const baseUrl = new URL(frontmatter.kibanaDashboard, kibanaBaseUrl).toString();
    const url = new URL(baseUrl);

    const aQuery = {
      query: {
        match_phrase: {
          ticket: ticket.key,
        },
      },
    };

    url.searchParams.set('_a', JSON.stringify(aQuery));

    return url.toString();
  }

  private descriptionToString(description: any): string {
    if (!description) return '';
    if (typeof description === 'string') return description;
    if (typeof description === 'object' && description.content && Array.isArray(description.content)) {
      return description.content.map((item: any) => this.extractTextFromAdf(item)).join(' ');
    }
    return '';
  }

  private extractTextFromAdf(node: any): string {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text') return node.text || '';
    if (node.content && Array.isArray(node.content)) {
      return node.content.map((item: any) => this.extractTextFromAdf(item)).join(' ');
    }
    return '';
  }

  private extractRequestId(description: string | object | null): string | null {
    const descriptionStr = this.descriptionToString(description);
    if (!descriptionStr) {
      return null;
    }

    const requestIdMatch = descriptionStr.match(
      /request[_-]?id[:\s=]+([a-zA-Z0-9\-_]+)/i
    );
    if (requestIdMatch) {
      return requestIdMatch[1];
    }

    return null;
  }
}
