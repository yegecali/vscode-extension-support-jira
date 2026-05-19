import { JiraTicket, MarkdownPrompt } from '../types';
import { LlmService } from '../services/LlmService';

export class ClassifierEngine {
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

  async findBestMatchLlm(
    ticket: JiraTicket,
    markdownPrompts: MarkdownPrompt[],
    llmService: LlmService,
    threshold: number,
    logger?: (msg: string) => void,
    documentation?: string
  ): Promise<{ prompt: MarkdownPrompt | null; score: number }> {
    if (markdownPrompts.length === 0) {
      return { prompt: null, score: 0 };
    }

    const scores = await Promise.all(
      markdownPrompts.map(prompt =>
        llmService.scoreTicketAgainstPrompt(ticket, prompt, documentation)
      )
    );

    let bestPrompt: MarkdownPrompt | null = null;
    let bestScore = 0;

    for (let i = 0; i < markdownPrompts.length; i++) {
      const score = scores[i].score;
      if (score > bestScore) {
        bestScore = score;
        if (score >= threshold) {
          bestPrompt = markdownPrompts[i];
        }
      }
    }

    if (logger) {
      logger(`[TICKET-${ticket.key}] Scoring en paralelo (threshold: ${threshold})...`);

      for (let i = 0; i < markdownPrompts.length; i++) {
        const score = scores[i].score;
        const label = markdownPrompts[i].frontmatter.label;
        const relevance =
          score >= threshold * 0.8 ? '(muy relevante)' :
          score >= threshold * 0.5 ? '(poco relevante)' :
          '(no relevante)';
        logger(`  → ${label}: score ${score} ${relevance}`);
      }

      if (bestScore >= threshold) {
        logger(`✓ Seleccionado: ${bestPrompt!.frontmatter.label} (score ${bestScore} >= ${threshold})`);
      } else {
        logger(`✗ Ningún prompt cumple threshold. Usando análisis por defecto.`);
      }
    }

    return { prompt: bestPrompt, score: bestScore };
  }

  isEmpty(ticket: JiraTicket): boolean {
    const summary = (ticket.summary || '').trim();
    const description = this.descriptionToString(ticket.description).trim();
    return summary.length === 0 && description.length === 0;
  }
}
