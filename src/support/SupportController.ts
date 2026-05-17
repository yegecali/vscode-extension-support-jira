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
          this.projectDocumentation = fs.readFileSync(docPath, 'utf-8');
          this.log(`[CYCLE] Documentación del proyecto cargada (${this.projectDocumentation.length} caracteres)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.log(`[CYCLE] Advertencia: No se pudo cargar documentación del proyecto: ${message}`);
        }
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
      matchedPrompt: null,
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

    const useMarkdownMode = this.markdownPrompts.length > 0;

    if (useMarkdownMode) {
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
          result.grafanaUrl = this.urlBuilder.buildGrafanaUrlFromMarkdown(
            ticket,
            markdownPrompt.frontmatter,
            this.config.grafanaBaseUrl
          );
          result.kibanaUrl = this.urlBuilder.buildKibanaUrlFromMarkdown(
            ticket,
            markdownPrompt.frontmatter,
            this.config.kibanaBaseUrl
          );
        }
      } else {
        this.log(`[TICKET] ${ticket.key} no tiene coincidencia Markdown, usando análisis genérico`);
        const genericAnalysis =
          await this.llmService.analyzeTicketGeneric(ticket);
        result.analysis = genericAnalysis;
        result.conclusion = 'UNCLASSIFIED';
      }
    } else {
      this.log(`[TICKET] Buscando coincidencia de clasificador para ${ticket.key}`);
      const { prompt: matchedPrompt } = this.classifier.findBestMatch(
        ticket,
        this.config.classifierPrompts,
        this.config.scoreThreshold
      );

      result.matchedPrompt = matchedPrompt;

      if (matchedPrompt) {
        this.log(`[TICKET] ${ticket.key} coincide con: ${matchedPrompt.classification}`);
        this.log(`[TICKET] Analizando ${ticket.key} con LLM`);
        const analysis = await this.llmService.analyzeTicket(
          ticket,
          matchedPrompt
        );
        result.analysis = analysis;
        this.log(`[TICKET] Análisis LLM completado para ${ticket.key} - Confianza: ${analysis.confidence}`);

        const missingFields = this.checkMissingFields(
          ticket,
          matchedPrompt.requiredFields
        );

        if (missingFields.length > 0) {
          this.log(`[TICKET] ${ticket.key} falta campos: ${missingFields.join(', ')}`);
          result.analysis.missingFields = missingFields;
          result.conclusion = 'MISSING_DATA';
        } else {
          this.log(`[TICKET] ${ticket.key} tiene todos los campos requeridos`);
          result.conclusion = 'COMPLETE';
          result.grafanaUrl = this.urlBuilder.buildGrafanaUrl(
            ticket,
            matchedPrompt,
            this.config.grafanaBaseUrl
          );
          result.kibanaUrl = this.urlBuilder.buildKibanaUrl(
            ticket,
            matchedPrompt,
            this.config.kibanaBaseUrl
          );
        }
      } else {
        this.log(`[TICKET] ${ticket.key} no tiene coincidencia, usando análisis genérico`);
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
      this.log(`[COMMENT] Enviando comentario a ${ticket.key} (${comment.length} caracteres)`);
      await this.jiraService.postComment(ticket.key, comment);
      this.log(`[COMMENT] ✓ Comentario enviado exitosamente a ${ticket.key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log(`[WARN] ✗ No se pudo comentar ${ticket.key}: ${message}`);
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

  private checkMissingFields(
    ticket: JiraTicket,
    requiredFields: string[]
  ): string[] {
    const missingFields: string[] = [];
    const description = this.descriptionToString(ticket.description);
    const ticketText = (
      (ticket.summary || '') +
      ' ' +
      description
    ).toLowerCase();

    for (const field of requiredFields) {
      const fieldLower = field.toLowerCase();
      if (
        !ticketText.includes(fieldLower) &&
        !ticketText.includes(fieldLower.replace(/_/g, ' '))
      ) {
        missingFields.push(field);
      }
    }

    return missingFields;
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
}
