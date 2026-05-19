import { JiraTicket } from '../types';

export class UrlBuilder {
  private static readonly REQUEST_ID_PLACEHOLDERS = [
    '{request-id-changed}',
    '{request-id-changes}',
  ];

  buildGrafanaUrl(
    ticket: JiraTicket,
    grafanaUrlTemplate: string,
    extractedRequestId?: string | null
  ): string {
    return this.buildUrlFromTemplate(ticket, grafanaUrlTemplate, extractedRequestId);
  }

  buildKibanaUrl(
    ticket: JiraTicket,
    kibanaUrlTemplate: string,
    extractedRequestId?: string | null
  ): string {
    return this.buildUrlFromTemplate(ticket, kibanaUrlTemplate, extractedRequestId);
  }

  private buildUrlFromTemplate(
    ticket: JiraTicket,
    urlTemplate: string,
    extractedRequestId?: string | null
  ): string {
    if (!urlTemplate.trim()) {
      return '';
    }

    const requestId = extractedRequestId || this.extractRequestId(ticket.description);
    if (!requestId && this.hasRequestIdPlaceholder(urlTemplate)) {
      return '';
    }

    return this.replaceRequestIdPlaceholders(urlTemplate, requestId);
  }

  private hasRequestIdPlaceholder(value: string): boolean {
    return UrlBuilder.REQUEST_ID_PLACEHOLDERS.some(placeholder => value.includes(placeholder));
  }

  private replaceRequestIdPlaceholders(value: string, requestId: string | null): string {
    if (!requestId) {
      return value;
    }

    return UrlBuilder.REQUEST_ID_PLACEHOLDERS.reduce(
      (formattedValue, placeholder) => formattedValue.split(placeholder).join(requestId),
      value
    );
  }

  private descriptionToString(description: unknown): string {
    if (!description) return '';
    if (typeof description === 'string') return description;
    if (typeof description === 'object') {
      const adfDescription = description as { content?: unknown[] };
      if (adfDescription.content && Array.isArray(adfDescription.content)) {
        return adfDescription.content
          .map((item: unknown) => this.extractTextFromAdf(item))
          .join(' ');
      }
    }
    return '';
  }

  private extractTextFromAdf(node: unknown): string {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';

    const adfNode = node as { type?: string; text?: string; content?: unknown[] };
    if (adfNode.type === 'text') return adfNode.text || '';
    if (adfNode.content && Array.isArray(adfNode.content)) {
      return adfNode.content.map((item: unknown) => this.extractTextFromAdf(item)).join(' ');
    }

    return '';
  }

  private extractRequestId(description: string | object | null): string | null {
    const descriptionStr = this.descriptionToString(description);
    if (!descriptionStr) {
      return null;
    }

    const requestIdMatch = descriptionStr.match(
      /request[_-]?id\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i
    );
    if (requestIdMatch) {
      return requestIdMatch[1];
    }

    return null;
  }
}
