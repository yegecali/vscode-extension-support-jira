import * as vscode from 'vscode';
import { JiraTicket, LlmAnalysis, MarkdownPrompt, LlmScore } from '../types';

export class LlmService {
  constructor(private logger?: (message: string) => void) {}

  async analyzeTicketGeneric(ticket: JiraTicket): Promise<LlmAnalysis> {
    try {
      const model = await this.selectModel();
      if (!model) {
        return this.defaultAnalysis('UNCLASSIFIED');
      }

      const systemPrompt =
        'Eres un agente de soporte que clasifica tickets de soporte. ' +
        'Analiza el ticket y proporciona: clasificación, campos faltantes, ' +
        'resumen breve, próximos pasos y confianza (0-100).';

      const userMessage = this.buildUserMessage(ticket);

      const text = await this.sendLoggedRequest(
        model,
        'analyzeTicketGeneric',
        systemPrompt,
        userMessage
      );

      if (!text) {
        return this.defaultAnalysis('UNCLASSIFIED');
      }

      return this.parseAnalysis(text, 'UNCLASSIFIED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showWarningMessage(
        `Error en análisis LLM genérico: ${message}`
      );
      return this.defaultAnalysis('UNCLASSIFIED');
    }
  }

  async scoreTicketAgainstPrompt(
    ticket: JiraTicket,
    markdownPrompt: MarkdownPrompt,
    documentation?: string
  ): Promise<LlmScore> {
    try {
      const model = await this.selectModel();
      if (!model) {
        return { score: 0, reason: 'Model not available' };
      }

      const systemPrompt =
        'Eres un evaluador de relevancia. Analiza qué tan relevante es el ticket respecto a la descripción del problema. ' +
        'Responde SOLO con JSON válido: {"score": <número 0-100>, "reason": "explicación breve"}';

      let userMessage =
        `Ticket: ${ticket.key}\n` +
        `Título: ${ticket.summary}\n` +
        `Descripción: ${ticket.description || 'No proporcionada'}\n\n` +
        `Descripción del problema:\n${markdownPrompt.body}`;

      this.logDocumentationCheck('scoreTicketAgainstPrompt', documentation);

      if (documentation?.trim()) {
        userMessage += `\n\nContexto del proyecto:\n${documentation}`;
      }

      const text = await this.sendLoggedRequest(
        model,
        'scoreTicketAgainstPrompt',
        systemPrompt,
        userMessage
      );

      if (!text) {
        return { score: 0, reason: 'No response from model' };
      }

      return this.parseScore(text);
    } catch (error) {
      return { score: 0, reason: 'Error en scoring' };
    }
  }

  async analyzeTicketWithMarkdown(
    ticket: JiraTicket,
    markdownPrompt: MarkdownPrompt,
    documentation?: string
  ): Promise<LlmAnalysis> {
    try {
      const model = await this.selectModel();
      if (!model) {
        return this.defaultAnalysis(markdownPrompt.frontmatter.classification);
      }

      let systemPrompt = markdownPrompt.body;
      this.logDocumentationCheck('analyzeTicketWithMarkdown', documentation);

      if (documentation?.trim()) {
        systemPrompt += `\n\nContexto adicional del proyecto:\n${documentation}`;
      }

      const userMessage = this.buildUserMessage(ticket);

      const text = await this.sendLoggedRequest(
        model,
        'analyzeTicketWithMarkdown',
        systemPrompt,
        userMessage
      );

      if (!text) {
        return this.defaultAnalysis(markdownPrompt.frontmatter.classification);
      }

      return this.parseAnalysis(text, markdownPrompt.frontmatter.classification);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showWarningMessage(
        `Error en análisis LLM con markdown: ${message}`
      );
      return this.defaultAnalysis(markdownPrompt.frontmatter.classification);
    }
  }

  async extractRequestId(ticket: JiraTicket): Promise<string | null> {
    try {
      const model = await this.selectModel();
      if (!model) {
        this.logger?.('[REQUEST-ID] No hay modelo LLM disponible para extraer request id');
        return null;
      }

      const systemPrompt =
        'Extrae de un ticket el valor que represente el request id. ' +
        'El usuario puede escribir el nombre del campo de muchas formas: request-id, request_id, Request_Id, requestid, request id, id de request, id request o similares. ' +
        'Devuelve el valor solo si parece un identificador real asociado a ese campo. ' +
        'Responde SOLO con JSON válido: {"requestId": "valor o null", "reason": "explicación breve"}.';

      const userMessage =
        `Ticket: ${ticket.key}\n` +
        `Título: ${ticket.summary}\n` +
        `Descripción:\n${this.descriptionToString(ticket.description) || 'No proporcionada'}`;

      this.logRequestIdExtractionStep(ticket.key, 'Descripción normalizada', this.descriptionToString(ticket.description) || 'No proporcionada');

      const text = await this.sendLoggedRequest(
        model,
        'extractRequestId',
        systemPrompt,
        userMessage
      );

      if (!text) {
        this.logRequestIdExtractionStep(ticket.key, 'Resultado parseado', 'null (sin respuesta del LLM)');
        return null;
      }

      const requestId = this.parseExtractedRequestId(text);
      this.logRequestIdExtractionStep(
        ticket.key,
        'Resultado parseado',
        requestId || 'null (el LLM no identificó un request id usable)'
      );

      return requestId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger?.(`[LLM REQUEST][extractRequestId] Error extrayendo request id: ${message}`);
      return null;
    }
  }

  private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
    });

    if (models.length === 0) {
      vscode.window.showErrorMessage(
        'No Copilot models available. Install GitHub Copilot.'
      );
      return undefined;
    }

    const preferredNames = [
      'copilot-gpt-4o',
      'copilot-gpt-4',
      'gpt-4o',
      'gpt-4',
    ];

    for (const name of preferredNames) {
      const model = models.find(m => m.id.includes(name));
      if (model) {
        return model;
      }
    }

    return models[0];
  }

  private buildUserMessage(ticket: JiraTicket): string {
    return (
      `Ticket: ${ticket.key}\n` +
      `Título: ${ticket.summary}\n` +
      `Descripción: ${ticket.description || 'No proporcionada'}\n` +
      `Estado: ${ticket.status}\n` +
      `Prioridad: ${ticket.priority}\n\n` +
      `Responde SOLO con JSON válido con exactamente este schema:\n` +
      `{\n` +
      `  "classification": "string",\n` +
      `  "missingFields": ["field1", "field2"],\n` +
      `  "summary": "string breve",\n` +
      `  "nextSteps": ["step1", "step2"],\n` +
      `  "confidence": número entre 0 y 100\n` +
      `}`
    );
  }

  private descriptionToString(description: string | object | null): string {
    if (!description) return '';
    if (typeof description === 'string') return description;
    const adfDescription = description as { content?: unknown[] };
    if (adfDescription.content && Array.isArray(adfDescription.content)) {
      return adfDescription.content.map((item: unknown) => this.extractTextFromAdf(item)).join(' ');
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

  private async sendLoggedRequest(
    model: vscode.LanguageModelChat,
    operation: string,
    systemPrompt: string,
    userMessage: string
  ): Promise<string | null> {
    const messages = [
      vscode.LanguageModelChatMessage.Assistant(systemPrompt),
      vscode.LanguageModelChatMessage.User(userMessage),
    ];

    this.logLlmMessage(operation, 'REQUEST', [
      `Model: ${model.name} (${model.id})`,
      `[Assistant prompt]\n${systemPrompt}`,
      `[User message]\n${userMessage}`,
    ].join('\n\n'));

    const response = await Promise.race([
      model.sendRequest(
        messages,
        {},
        new vscode.CancellationTokenSource().token
      ),
      this.timeout(30000),
    ]);

    if (!response) {
      this.logLlmMessage(operation, 'RESPONSE', 'No response from model (timeout).');
      return null;
    }

    let text = '';
    for await (const chunk of response.text) {
      text += chunk;
    }

    this.logLlmMessage(operation, 'RESPONSE', text || '(empty response)');
    return text;
  }

  private logLlmMessage(operation: string, direction: 'REQUEST' | 'RESPONSE', content: string): void {
    const message = [
      `[LLM ${direction}][${operation}]`,
      '----------------------------------------',
      content,
      '----------------------------------------',
    ].join('\n');

    console.log(`\n[Jira Classifier]${message}`);
    this.logger?.(message);
  }

  private logDocumentationCheck(operation: string, documentation?: string): void {
    const rawLength = documentation?.length ?? 0;
    const trimmedLength = documentation?.trim().length ?? 0;
    const willSend = trimmedLength > 0;
    const preview = willSend
      ? this.previewText(documentation ?? '')
      : '(no se adjunta documentación: undefined, vacío o solo espacios)';

    this.logLlmMessage(operation, 'REQUEST', [
      '[Documentation check]',
      `rawLength: ${rawLength}`,
      `trimmedLength: ${trimmedLength}`,
      `willSendContext: ${willSend}`,
      `[Documentation preview]\n${preview}`,
    ].join('\n'));
  }

  private logRequestIdExtractionStep(ticketKey: string, step: string, content: string): void {
    const message = [
      `[REQUEST-ID][${ticketKey}] ${step}`,
      this.previewText(content),
    ].join('\n');

    console.log(`\n[Jira Classifier]${message}`);
    this.logger?.(message);
  }

  private previewText(text: string, maxLength = 1000): string {
    return text.length > maxLength
      ? `${text.slice(0, maxLength)}... [truncado]`
      : text;
  }

  private parseScore(text: string): LlmScore {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { score: 0, reason: 'Error en scoring' };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        score: typeof parsed.score === 'number'
          ? Math.max(0, Math.min(100, parsed.score))
          : 0,
        reason: typeof parsed.reason === 'string'
          ? parsed.reason
          : 'No se obtuvo razón',
      };
    } catch {
      return { score: 0, reason: 'Error en scoring' };
    }
  }

  private parseAnalysis(text: string, fallbackClassification: string): LlmAnalysis {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.defaultAnalysis(fallbackClassification);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        classification: parsed.classification || fallbackClassification,
        missingFields: Array.isArray(parsed.missingFields)
          ? parsed.missingFields
          : [],
        summary: typeof parsed.summary === 'string'
          ? parsed.summary
          : 'No se obtuvo resumen',
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(100, parsed.confidence)) / 100
          : 0.5,
      };
    } catch {
      return this.defaultAnalysis(fallbackClassification);
    }
  }

  private parseExtractedRequestId(text: string): string | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.requestId !== 'string') {
        return null;
      }

      const requestId = parsed.requestId.trim();
      if (!requestId || requestId.toLowerCase() === 'null') {
        return null;
      }

      return requestId;
    } catch {
      return null;
    }
  }

  private defaultAnalysis(classification: string): LlmAnalysis {
    return {
      classification,
      missingFields: [],
      summary: 'No se pudo analizar automáticamente',
      nextSteps: ['Requiere revisión manual'],
      confidence: 0,
    };
  }

  private timeout(ms: number): Promise<null> {
    return new Promise(resolve => setTimeout(() => resolve(null), ms));
  }
}
