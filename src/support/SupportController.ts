import * as vscode from 'vscode';
import * as fs from 'fs';
import { JiraService } from '../services/JiraService';
import { LlmService } from '../services/LlmService';
import { ClassifierEngine } from '../core/ClassifierEngine';
import { UrlBuilder } from '../core/UrlBuilder';
import { CommentBuilder } from '../core/CommentBuilder';
import { PromptLoader } from '../core/PromptLoader';
import { JiraTicket, TicketResult, ExtensionConfig, MarkdownPrompt } from '../types';

const COMMENTED_STATE_PREFIX = 'ticket-commented-';
const RESULT_STATE_PREFIX = 'ticket-result-';

export class SupportController {
  private interval: NodeJS.Timeout | undefined;
  private isRunning = false;
  private markdownPrompts: MarkdownPrompt[] = [];
  private projectDocumentation: string = '';

  constructor(
    private context: vscode.ExtensionContext,
    private jiraService: JiraService,
    private llmService: LlmService,
    private classifier: ClassifierEngine,
    private urlBuilder: UrlBuilder,
    private commentBuilder: CommentBuilder,
    private promptLoader: PromptLoader,
    private config: ExtensionConfig,
    private onResultsUpdated: (results: TicketResult[]) => void,
    private outputChannel: vscode.OutputChannel
  ) {}

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.outputChannel.show();
    this.log('[START] Iniciando ciclo de soporte');
    this.log(`[CONFIG] URL Jira: ${this.config.jiraUrl}`);
    this.log(`[CONFIG] JQL: ${this.config.jiraJql}`);
    this.log(`[CONFIG] Intervalo de polling: ${this.config.pollingIntervalMinutes} minutos`);

    this.runCycle();
    this.interval = setInterval(
      () => this.runCycle(),
      this.config.pollingIntervalMinutes * 60 * 1000
    );
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    this.log('[STOP] Ciclo de soporte detenido');
  }

  get running(): boolean {
    return this.isRunning;
  }

  async runCycle(): Promise<void> {
    try {
      this.log('[CYCLE] Iniciando ciclo de análisis');

      if (this.config.promptsDirectory.trim()) {
        this.markdownPrompts = this.promptLoader.loadPromptsFromDirectory(this.config.promptsDirectory);
        this.log(`[CYCLE] ${this.markdownPrompts.length} prompts Markdown cargados`);
      } else {
        this.markdownPrompts = [];
      }

      this.projectDocumentation = '';
      if (this.config.promptsDocumentation.trim()) {
        try {
          const docPath = this.config.promptsDocumentation;
          this.log(`[CYCLE] Cargando documentación del proyecto desde: ${docPath}`);
          this.projectDocumentation = fs.readFileSync(docPath, 'utf-8');
          this.log(
            `[CYCLE] Documentación del proyecto cargada ` +
            `(${this.projectDocumentation.length} caracteres, ` +
            `${this.projectDocumentation.trim().length} caracteres sin espacios extremos)`
          );
          this.log(`[CYCLE] Vista previa documentación:\n${this.previewText(this.projectDocumentation)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.log(`[CYCLE] Advertencia: No se pudo cargar documentación del proyecto: ${message}`);
        }
      } else {
        this.log('[CYCLE] promptsDocumentation no configurado; no se enviará contexto de proyecto al LLM');
      }

      const startTime = Date.now();
      const tickets = await this.jiraService.searchTickets();
      this.log(`[CYCLE] Se encontraron ${tickets.length} tickets`);

      if (tickets.length === 0) {
        this.log('[CYCLE] No hay tickets para procesar');
        this.onResultsUpdated([]);
        return;
      }

      const results: TicketResult[] = [];
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        this.log(`[CYCLE] Procesando ticket ${i + 1}/${tickets.length}: ${ticket.key}`);
        const result = await this.processTicket(ticket);
        results.push(result);
        this.log(`[CYCLE] Ticket ${ticket.key} procesado - Conclusión: ${result.conclusion}`);

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      this.cacheResults(results);
      this.onResultsUpdated(results);
      const elapsedTime = Date.now() - startTime;
      this.log(`[CYCLE] Ciclo completado - ${results.length} tickets procesados en ${elapsedTime}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log(`[ERROR] ${message}`);
      vscode.window.showErrorMessage(`Error en ciclo de soporte: ${message}`);
    }
  }

  async processTicket(ticket: JiraTicket): Promise<TicketResult> {
    const stateKey = COMMENTED_STATE_PREFIX + ticket.key;
    const resultStateKey = RESULT_STATE_PREFIX + ticket.key;

    this.log(`[TICKET] Analizando: ${ticket.key} - ${ticket.summary}`);
    this.log(`[TICKET] Estado: ${ticket.status}, Prioridad: ${ticket.priority}`);

    const alreadyCommented =
      this.context.workspaceState.get(stateKey) === true;

    if (alreadyCommented) {
      this.log(`[TICKET] ${ticket.key} ya fue comentado, verificando cache`);
      const cached = this.context.workspaceState.get(resultStateKey) as string | undefined;
      if (cached) {
        try {
          this.log(`[TICKET] Usando resultado en cache para ${ticket.key}`);
          return JSON.parse(cached) as TicketResult;
        } catch {
          this.log(`[TICKET] Cache corrupto para ${ticket.key}, reprocessando`);
        }
      }
    }

    const result: TicketResult = {
      ticket,
      matchedMarkdownPrompt: null,
      analysis: null,
      grafanaUrl: null,
      kibanaUrl: null,
      conclusion: 'UNCLASSIFIED',
      commentedAt: null,
    };

    if (ticket.status === 'Closed' || ticket.status === 'Resuelto') {
      this.log(`[TICKET] ${ticket.key} está cerrado, marcando como CLOSED`);
      result.conclusion = 'CLOSED';
      return result;
    }

    if (this.classifier.isEmpty(ticket)) {
      this.log(`[TICKET] ${ticket.key} está vacío, marcando como EMPTY`);
      result.conclusion = 'EMPTY';
      if (!alreadyCommented) {
        await this.postComment(ticket, result);
        this.markCommented(ticket.key, result);
      }
      return result;
    }

    const monitoringRequestId = await this.extractRequestIdForMonitoring(ticket);
    this.addMonitoringUrls(ticket, result, monitoringRequestId);

    if (this.markdownPrompts.length === 0) {
      this.log(`[TICKET] No hay prompts Markdown cargados, usando análisis genérico para ${ticket.key}`);
      const genericAnalysis = await this.llmService.analyzeTicketGeneric(ticket);
      result.analysis = genericAnalysis;
      result.conclusion = 'UNCLASSIFIED';
    } else {
      this.log(`[TICKET] Buscando coincidencia de clasificador Markdown para ${ticket.key}`);
      const threshold = this.config.scoreThreshold * 100;
      const { prompt: markdownPrompt, score } = await this.classifier.findBestMatchLlm(
        ticket,
        this.markdownPrompts,
        this.llmService,
        threshold,
        (msg) => this.log(msg),
        this.projectDocumentation
      );

      result.matchedMarkdownPrompt = markdownPrompt;

      if (markdownPrompt) {
        this.log(`[TICKET] ${ticket.key} coincide con Markdown: ${markdownPrompt.frontmatter.label} (score: ${score})`);
        this.log(`[TICKET] Analizando ${ticket.key} con LLM usando Markdown`);
        const analysis = await this.llmService.analyzeTicketWithMarkdown(
          ticket,
          markdownPrompt,
          this.projectDocumentation
        );
        result.analysis = analysis;
        this.log(`[TICKET] Análisis LLM completado para ${ticket.key} - Confianza: ${analysis.confidence}`);

        if (analysis.missingFields && analysis.missingFields.length > 0) {
          this.log(`[TICKET] ${ticket.key} falta campos: ${analysis.missingFields.join(', ')}`);
          result.conclusion = 'MISSING_DATA';
        } else {
          this.log(`[TICKET] ${ticket.key} tiene todos los campos requeridos`);
          result.conclusion = 'COMPLETE';
        }
      } else {
        this.log(`[TICKET] ${ticket.key} no tiene coincidencia Markdown, usando análisis genérico`);
        const genericAnalysis =
          await this.llmService.analyzeTicketGeneric(ticket);
        result.analysis = genericAnalysis;
        result.conclusion = 'UNCLASSIFIED';
      }
    }

    if (!alreadyCommented) {
      await this.postComment(ticket, result);
      this.markCommented(ticket.key, result);
    }

    return result;
  }

  getCachedResults(): TicketResult[] {
    const results: TicketResult[] = [];
    const keys = this.context.workspaceState.keys();

    for (const key of keys) {
      if (key.startsWith(RESULT_STATE_PREFIX)) {
        const cached = this.context.workspaceState.get(key) as string | undefined;
        if (cached) {
          try {
            results.push(JSON.parse(cached) as TicketResult);
          } catch {
            // Ignorar cachés corruptos
          }
        }
      }
    }

    return results;
  }

  private async postComment(
    ticket: JiraTicket,
    result: TicketResult
  ): Promise<void> {
    try {
      this.log(`[COMMENT] Generando comentario para ${ticket.key}`);
      const comment = this.commentBuilder.buildComment(result);
      this.log(`[COMMENT] Contenido generado para ${ticket.key}:\n${this.previewText(comment, 3000)}`);
      this.log(`[COMMENT] Enviando comentario a ${ticket.key} (${comment.length} caracteres)`);
      await this.jiraService.postComment(ticket.key, comment);
      this.log(`[COMMENT] ✓ Comentario enviado exitosamente a ${ticket.key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log(`[WARN] ✗ No se pudo comentar ${ticket.key}: ${message}`);
    }
  }

  private async extractRequestIdForMonitoring(ticket: JiraTicket): Promise<string | null> {
    this.log(`[REQUEST-ID] Iniciando búsqueda con LLM para ${ticket.key}`);
    this.log(`[REQUEST-ID] Descripción enviada a extractor (${ticket.key}):\n${this.previewText(this.descriptionToString(ticket.description))}`);
    const requestId = await this.llmService.extractRequestId(ticket);

    if (requestId) {
      this.log(`[REQUEST-ID] Valor detectado para ${ticket.key}: ${requestId}`);
    } else {
      this.log(`[REQUEST-ID] No se detectó request id para ${ticket.key}`);
    }

    return requestId;
  }

  private addMonitoringUrls(
    ticket: JiraTicket,
    result: TicketResult,
    requestId: string | null
  ): void {
    this.log(`[MONITORING] Template Grafana configurado: ${this.config.grafanaUrlTemplate ? 'sí' : 'no'}`);
    this.log(`[MONITORING] Template Kibana configurado: ${this.config.kibanaUrlTemplate ? 'sí' : 'no'}`);

    result.grafanaUrl = this.urlBuilder.buildGrafanaUrl(
      ticket,
      this.config.grafanaUrlTemplate,
      requestId
    );
    result.kibanaUrl = this.urlBuilder.buildKibanaUrl(
      ticket,
      this.config.kibanaUrlTemplate,
      requestId
    );

    if (result.grafanaUrl) {
      this.log(`[MONITORING] URL Grafana generada para ${ticket.key}:\n${result.grafanaUrl}`);
    } else {
      this.log(`[MONITORING] No se generó URL Grafana para ${ticket.key}. Revisa template y request id.`);
    }

    if (result.kibanaUrl) {
      this.log(`[MONITORING] URL Kibana generada para ${ticket.key}:\n${result.kibanaUrl}`);
    } else {
      this.log(`[MONITORING] No se generó URL Kibana para ${ticket.key}. Revisa template y request id.`);
    }
  }

  private markCommented(ticketKey: string, result: TicketResult): void {
    const stateKey = COMMENTED_STATE_PREFIX + ticketKey;
    const resultStateKey = RESULT_STATE_PREFIX + ticketKey;

    result.commentedAt = new Date().toISOString();

    this.context.workspaceState.update(stateKey, true);
    this.context.workspaceState.update(resultStateKey, JSON.stringify(result));
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

  private cacheResults(results: TicketResult[]): void {
    for (const result of results) {
      const key = RESULT_STATE_PREFIX + result.ticket.key;
      this.context.workspaceState.update(key, JSON.stringify(result));
    }
  }

  async clearCache(): Promise<void> {
    try {
      this.log('[CACHE] Limpiando cache...');
      const keys = this.context.workspaceState.keys();
      let clearedCount = 0;

      for (const key of keys) {
        if (key.startsWith(COMMENTED_STATE_PREFIX) || key.startsWith(RESULT_STATE_PREFIX)) {
          await this.context.workspaceState.update(key, undefined);
          clearedCount++;
        }
      }

      this.log(`[CACHE] ✓ Cache limpiado - ${clearedCount} entradas eliminadas`);
      vscode.window.showInformationMessage(`Cache limpiado (${clearedCount} tickets reseteados)`);

      this.log('[CACHE] Reexecutando ciclo sin cache...');
      await this.runCycle();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log(`[CACHE] ✗ Error al limpiar cache: ${message}`);
      vscode.window.showErrorMessage(`Error al limpiar cache: ${message}`);
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  private previewText(text: string, maxLength = 1000): string {
    if (!text.trim()) {
      return '(documentación vacía o solo espacios)';
    }

    const preview = text.length > maxLength
      ? `${text.slice(0, maxLength)}... [truncado]`
      : text;

    return preview;
  }
}
