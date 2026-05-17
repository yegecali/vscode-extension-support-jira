import * as vscode from 'vscode';
import { JiraTicket, ClassifierPrompt, LlmAnalysis, MarkdownPrompt, LlmScore } from '../types';

export class LlmService {
  async analyzeTicket(
    ticket: JiraTicket,
    prompt: ClassifierPrompt
  ): Promise<LlmAnalysis> {
    try {
      const model = await this.selectModel();
      if (!model) {
        return this.defaultAnalysis('UNCLASSIFIED');
      }

      const userMessage = this.buildUserMessage(ticket);

      const response = await Promise.race([
        model.sendRequest(
          [
            vscode.LanguageModelChatMessage.Assistant(prompt.promptTemplate),
            vscode.LanguageModelChatMessage.User(userMessage),
          ],
          {},
          new vscode.CancellationTokenSource().token
        ),
        this.timeout(30000),
      ]);

      if (!response) {
        return this.defaultAnalysis('UNCLASSIFIED');
      }

      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
      }

      return this.parseAnalysis(text, prompt.classification);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showWarningMessage(
        `Error en análisis LLM: ${message}`
      );
      return this.defaultAnalysis('UNCLASSIFIED');
    }
  }

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

      const response = await Promise.race([
        model.sendRequest(
          [
            vscode.LanguageModelChatMessage.Assistant(systemPrompt),
            vscode.LanguageModelChatMessage.User(userMessage),
          ],
          {},
          new vscode.CancellationTokenSource().token
        ),
        this.timeout(30000),
      ]);

      if (!response) {
        return this.defaultAnalysis('UNCLASSIFIED');
      }

      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
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

      if (documentation) {
        userMessage += `\n\nContexto del proyecto:\n${documentation}`;
      }

      const response = await Promise.race([
        model.sendRequest(
          [
            vscode.LanguageModelChatMessage.Assistant(systemPrompt),
            vscode.LanguageModelChatMessage.User(userMessage),
          ],
          {},
          new vscode.CancellationTokenSource().token
        ),
        this.timeout(30000),
      ]);

      if (!response) {
        return { score: 0, reason: 'No response from model' };
      }

      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
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
      if (documentation) {
        systemPrompt += `\n\nContexto adicional del proyecto:\n${documentation}`;
      }

      const userMessage = this.buildUserMessage(ticket);

      const response = await Promise.race([
        model.sendRequest(
          [
            vscode.LanguageModelChatMessage.Assistant(systemPrompt),
            vscode.LanguageModelChatMessage.User(userMessage),
          ],
          {},
          new vscode.CancellationTokenSource().token
        ),
        this.timeout(30000),
      ]);

      if (!response) {
        return this.defaultAnalysis(markdownPrompt.frontmatter.classification);
      }

      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
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
