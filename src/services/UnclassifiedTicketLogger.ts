import * as fs from 'fs';
import * as path from 'path';
import { JiraTicket, TicketResult } from '../types';

export class UnclassifiedTicketLogger {
  private logsDir: string;

  constructor(workspaceRoot: string) {
    this.logsDir = path.join(workspaceRoot, 'unclassified-tickets');
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  async logUnclassifiedTicket(ticket: JiraTicket, result: TicketResult, reason: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${ticket.key}_${timestamp}.txt`;
      const filepath = path.join(this.logsDir, filename);

      const description = this.descriptionToString(ticket.description);

      const content = `╔════════════════════════════════════════════════════════════════╗
║           TICKET NO CLASIFICADO - REGISTRO DETALLADO              ║
╚════════════════════════════════════════════════════════════════╝

INFORMACIÓN DEL TICKET
────────────────────────────────────────────────────────────────
Clave Jira:     ${ticket.key}
Resumen:        ${ticket.summary}
Tipo:           ${ticket.issueType}
Estado:         ${ticket.status}
Prioridad:      ${ticket.priority}
Reportero:      ${ticket.reporter}
Creado:         ${ticket.created}
Actualizado:    ${ticket.updated}
URL:            ${ticket.url}

RAZÓN DE FALLO DE CLASIFICACIÓN
────────────────────────────────────────────────────────────────
${reason}

DESCRIPCIÓN DEL TICKET
────────────────────────────────────────────────────────────────
${description || '(sin descripción)'}

INFORMACIÓN DE ANÁLISIS
────────────────────────────────────────────────────────────────
Conclusión:     ${result.conclusion}
Prompt Markdown: ${result.matchedMarkdownPrompt?.frontmatter.label || 'No coincidió'}
Análisis LLM:    ${result.analysis ? `Sí (Confianza: ${result.analysis.confidence})` : 'No'}
URL Grafana:     ${result.grafanaUrl || 'No generada'}
URL Kibana:      ${result.kibanaUrl || 'No generada'}

REGISTRO DE TIMESTAMP
────────────────────────────────────────────────────────────────
Registrado en: ${new Date().toISOString()}

════════════════════════════════════════════════════════════════
`;

      fs.writeFileSync(filepath, content, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`No se pudo registrar ticket no clasificado: ${message}`);
    }
  }

  private descriptionToString(description: any): string {
    if (!description) return '';
    if (typeof description === 'string') return description;
    if (typeof description === 'object') {
      if (Array.isArray(description)) return '';
      if (description.content && Array.isArray(description.content)) {
        return description.content
          .map((item: any) => this.extractTextFromAdf(item))
          .join(' ');
      }
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
}
