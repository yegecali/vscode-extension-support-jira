import { TicketResult } from '../types';

export class CommentBuilder {
  buildComment(result: TicketResult): string {
    switch (result.conclusion) {
      case 'EMPTY':
        return this.buildEmptyComment();
      case 'MISSING_DATA':
        return this.buildMissingDataComment(result);
      case 'COMPLETE':
        return this.buildCompleteComment(result);
      case 'CLOSED':
        return this.buildClosedComment();
      case 'UNCLASSIFIED':
        return this.buildUnclassifiedComment(result);
      default:
        return this.buildUnclassifiedComment(result);
    }
  }

  private buildEmptyComment(): string {
    return (
      '🤖 [Jira Classifier] Análisis automático\n' +
      '❌ Ticket incompleto — sin descripción\n\n' +
      'El ticket no contiene descripción ni contexto suficiente para clasificar.\n\n' +
      '📋 Por favor proporciona:\n' +
      '- Descripción detallada del problema\n' +
      '- Pasos para reproducir\n' +
      '- Fecha y hora del incidente\n' +
      '- Cualquier mensaje de error\n\n' +
      '_El análisis se ejecutará nuevamente cuando el ticket se actualice._'
    );
  }

  private buildMissingDataComment(result: TicketResult): string {
    const analysis = result.analysis!;
    const missingFieldsList = analysis.missingFields
      .map(field => `  - ${field}`)
      .join('\n');

    return (
      '🤖 [Jira Classifier] Análisis automático\n' +
      `⚠️ Clasificación: ${result.matchedPrompt?.label || result.matchedMarkdownPrompt?.frontmatter.label || analysis.classification} — Datos incompletos\n\n` +
      '📋 Campos faltantes:\n' +
      `${missingFieldsList}\n\n` +
      `💬 Resumen: ${analysis.summary}\n\n` +
      '📊 Próximos pasos:\n' +
      '- Proporciona los campos faltantes\n' +
      '- Re-actualiza el ticket para que se ejecute el análisis nuevamente\n\n' +
      '_Confianza del análisis: ' +
      `${Math.round(analysis.confidence * 100)}%_`
    );
  }

  private buildCompleteComment(result: TicketResult): string {
    const analysis = result.analysis!;
    const nextStepsText = analysis.nextSteps
      .map((step, i) => `  ${i + 1}. ${step}`)
      .join('\n');

    let dashboardsText = '';
    if (result.grafanaUrl) {
      dashboardsText += `📊 [Grafana](${result.grafanaUrl})\n`;
    }
    if (result.kibanaUrl) {
      dashboardsText += `🔍 [Kibana](${result.kibanaUrl})\n`;
    }

    return (
      '🤖 [Jira Classifier] Análisis automático\n' +
      `✅ Clasificación: **${result.matchedPrompt?.label || result.matchedMarkdownPrompt?.frontmatter.label || analysis.classification}**\n` +
      `Confianza: ${Math.round(analysis.confidence * 100)}%\n\n` +
      `💬 ${analysis.summary}\n\n` +
      '📋 Próximos pasos:\n' +
      `${nextStepsText}\n\n` +
      (dashboardsText
        ? '🔗 Dashboards de monitoreo:\n' + dashboardsText + '\n'
        : '') +
      `_Actualizado: ${new Date().toISOString()}_`
    );
  }

  private buildClosedComment(): string {
    return (
      '🤖 [Jira Classifier] Análisis automático\n' +
      'El ticket ya está cerrado. No se realizará análisis.\n\n' +
      '_Si deseas reabrirlo para análisis, cambia su estado._'
    );
  }

  private buildUnclassifiedComment(result: TicketResult): string {
    return (
      '🤖 [Jira Classifier] Análisis automático\n' +
      '⚠️ No se pudo clasificar automáticamente\n\n' +
      'El sistema no pudo determinar la categoría de este ticket.\n' +
      'Por favor, revísalo manualmente y proporciona más contexto si es necesario.\n\n' +
      `_Ticket: ${result.ticket.key}_`
    );
  }
}
