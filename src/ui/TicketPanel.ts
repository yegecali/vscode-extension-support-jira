import * as vscode from 'vscode';
import { TicketResult } from '../types';
import { SupportController } from '../support/SupportController';
import { JiraService } from '../services/JiraService';

export class TicketPanel {
  public static currentPanel: TicketPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private results: TicketResult[] = [];

  public static createOrShow(
    supportController: SupportController,
    jiraService: JiraService
  ): TicketPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TicketPanel.currentPanel) {
      TicketPanel.currentPanel.panel.reveal(column);
      return TicketPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'ticketPanel',
      'Jira Tickets',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
      }
    );

    TicketPanel.currentPanel = new TicketPanel(
      panel,
      supportController,
      jiraService
    );
    return TicketPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    supportController: SupportController,
    jiraService: JiraService
  ) {
    this.panel = panel;
    this.results = supportController.getCachedResults();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'moveTicket':
            try {
              const transitions = await jiraService.getTransitions(message.key);
              this.panel.webview.postMessage({
                command: 'showTransitions',
                transitions,
                ticketKey: message.key,
              });
            } catch (error) {
              const msg = error instanceof Error ? error.message : 'Unknown error';
              vscode.window.showErrorMessage(`No se pudieron obtener transiciones: ${msg}`);
            }
            break;

          case 'applyTransition':
            try {
              await jiraService.applyTransition(message.key, message.transitionId);
              vscode.window.showInformationMessage(
                `Ticket ${message.key} movido exitosamente`
              );
            } catch (error) {
              const msg = error instanceof Error ? error.message : 'Unknown error';
              vscode.window.showErrorMessage(`Error al mover ticket: ${msg}`);
            }
            break;

          case 'openUrl':
            if (message.url) {
              vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;
        }
      },
      null,
      this.disposables
    );

    this.update();
  }

  private update(): void {
    this.panel.webview.html = this.getHtmlContent();
  }

  public updateResults(results: TicketResult[]): void {
    this.results = results;
    this.update();
  }

  private getHtmlContent(): string {
    const ticketsHtml = this.results
      .map((result) => this.renderTicket(result))
      .join('');
    const counts = this.getConclusionCounts();
    const lastUpdated = this.results.length > 0
      ? new Date().toLocaleString('es-ES')
      : 'Sin datos';

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Jira Tickets</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            padding: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }

          .header {
            position: sticky;
            top: 0;
            z-index: 10;
            padding: 16px 18px 14px;
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-widget-border);
          }

          .header-top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 14px;
          }

          .header h2 {
            font-size: 17px;
            font-weight: 600;
            margin-bottom: 4px;
            letter-spacing: 0;
          }

          .header p {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
          }

          .updated-at {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            line-height: 1.4;
            text-align: right;
            white-space: nowrap;
          }

          .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
            gap: 8px;
          }

          .summary-item {
            min-height: 54px;
            padding: 8px 10px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            background-color: var(--vscode-sideBar-background);
          }

          .summary-value {
            display: block;
            font-size: 18px;
            font-weight: 650;
            line-height: 1.2;
          }

          .summary-label {
            display: block;
            margin-top: 2px;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
          }

          .tickets-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px 18px 18px;
          }

          .ticket {
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            overflow: hidden;
            background-color: var(--vscode-editor-background);
            transition: border-color 0.15s, background-color 0.15s;
          }

          .ticket:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
          }

          .ticket-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            padding: 12px 12px 8px;
          }

          .ticket-key {
            display: inline-flex;
            align-items: center;
            width: fit-content;
            font-weight: 600;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
          }

          .ticket-key:hover {
            text-decoration: underline;
          }

          .ticket-title-group {
            min-width: 0;
            flex: 1;
          }

          .status-badge {
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            border: 1px solid transparent;
          }

          .status-complete {
            background-color: rgba(46, 160, 67, 0.18);
            border-color: rgba(46, 160, 67, 0.45);
            color: var(--vscode-debugIcon-startForeground);
          }

          .status-missing {
            background-color: rgba(187, 128, 9, 0.18);
            border-color: rgba(187, 128, 9, 0.5);
            color: var(--vscode-notebookStatusRunningColor);
          }

          .status-empty {
            background-color: rgba(248, 81, 73, 0.16);
            border-color: rgba(248, 81, 73, 0.45);
            color: var(--vscode-errorForeground);
          }

          .status-closed {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
          }

          .status-unclassified {
            background-color: rgba(88, 166, 255, 0.14);
            border-color: rgba(88, 166, 255, 0.42);
            color: var(--vscode-textLink-foreground);
          }

          .ticket-summary {
            font-weight: 500;
            margin-top: 6px;
            font-size: 14px;
            line-height: 1.35;
            overflow-wrap: anywhere;
          }

          .ticket-priority {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 7px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-badge-foreground);
            background-color: var(--vscode-badge-background);
          }

          .ticket-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
            gap: 8px;
            padding: 0 12px 12px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
          }

          .detail-line {
            min-width: 0;
          }

          .detail-label {
            display: block;
            margin-bottom: 2px;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
          }

          .detail-value {
            display: block;
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .ticket-analysis {
            margin: 0 12px 12px;
            padding: 10px;
            border: 1px solid var(--vscode-widget-border);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 6px;
            background-color: var(--vscode-sideBar-background);
            font-size: 12px;
          }

          .analysis-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
          }

          .analysis-title {
            font-weight: 600;
            overflow-wrap: anywhere;
          }

          .confidence {
            display: inline-flex;
            align-items: center;
            min-width: 44px;
            justify-content: center;
            padding: 3px 7px;
            border-radius: 999px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
          }

          .analysis-summary {
            line-height: 1.45;
            color: var(--vscode-editor-foreground);
            overflow-wrap: anywhere;
          }

          .missing-fields {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 10px 0 0;
            padding: 0;
            list-style: none;
          }

          .missing-fields li {
            padding: 3px 7px;
            border-radius: 999px;
            background-color: rgba(248, 81, 73, 0.14);
            color: var(--vscode-errorForeground);
            font-size: 11px;
            font-weight: 600;
          }

          .next-steps {
            margin-top: 10px;
            padding-left: 18px;
            color: var(--vscode-editor-foreground);
          }

          .next-steps li {
            margin-top: 4px;
            line-height: 1.4;
          }

          .dashboard-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            padding: 0 12px 12px;
          }

          .ticket-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            padding: 10px 12px;
            border-top: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-sideBar-background);
          }

          .btn {
            min-height: 28px;
            padding: 4px 10px;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            transition: background-color 0.15s;
          }

          .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }

          .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }

          .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }

          .empty-state {
            text-align: center;
            padding: 42px 20px;
            border: 1px dashed var(--vscode-widget-border);
            border-radius: 8px;
            color: var(--vscode-descriptionForeground);
          }

          .empty-state strong {
            display: block;
            margin-bottom: 6px;
            color: var(--vscode-editor-foreground);
            font-size: 14px;
          }

          .empty-state p {
            margin-bottom: 0;
          }

          .transition-select {
            min-width: 190px;
            flex: 1;
            padding: 6px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 12px;
          }

          .hidden {
            display: none;
          }

          @media (max-width: 560px) {
            .header-top {
              flex-direction: column;
              gap: 8px;
            }

            .updated-at {
              text-align: left;
              white-space: normal;
            }

            .ticket-header {
              flex-direction: column;
            }

            .status-badge {
              align-self: flex-start;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-top">
            <div>
              <h2>Tickets clasificados</h2>
              <p>${this.results.length} tickets encontrados</p>
            </div>
            <div class="updated-at">Actualizado: ${lastUpdated}</div>
          </div>
          <div class="summary-grid" aria-label="Resumen de tickets">
            <div class="summary-item">
              <span class="summary-value">${this.results.length}</span>
              <span class="summary-label">Total</span>
            </div>
            <div class="summary-item">
              <span class="summary-value">${counts.COMPLETE}</span>
              <span class="summary-label">Completos</span>
            </div>
            <div class="summary-item">
              <span class="summary-value">${counts.MISSING_DATA}</span>
              <span class="summary-label">Incompletos</span>
            </div>
            <div class="summary-item">
              <span class="summary-value">${counts.UNCLASSIFIED}</span>
              <span class="summary-label">Sin clasificar</span>
            </div>
            <div class="summary-item">
              <span class="summary-value">${counts.EMPTY}</span>
              <span class="summary-label">Vacíos</span>
            </div>
            <div class="summary-item">
              <span class="summary-value">${counts.CLOSED}</span>
              <span class="summary-label">Cerrados</span>
            </div>
          </div>
        </div>

        <div class="tickets-list">
          ${ticketsHtml || '<div class="empty-state"><strong>No hay tickets para mostrar</strong><p>Inicia o refresca el ciclo de soporte para procesar tickets.</p></div>'}
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          document.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) {
              return;
            }

            const action = target.dataset.action;
            const key = target.dataset.key;

            if (action === 'openUrl') {
              vscode.postMessage({ command: 'openUrl', url: target.dataset.url });
              return;
            }

            if (action === 'moveTicket') {
              vscode.postMessage({ command: 'moveTicket', key });
              target.textContent = 'Cargando estados...';
              target.disabled = true;
              return;
            }

            if (action === 'applyTransition') {
              const select = document.getElementById('transition-' + key);
              if (select && select.value) {
                vscode.postMessage({
                  command: 'applyTransition',
                  key,
                  transitionId: select.value
                });
              }
            }
          });

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'showTransitions') {
              const select = document.getElementById('transition-' + message.ticketKey);
              const applyButton = document.getElementById('apply-' + message.ticketKey);
              const moveButton = document.querySelector('[data-action="moveTicket"][data-key="' + message.ticketKey + '"]');

              if (select) {
                select.replaceChildren();

                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Seleccionar estado...';
                select.appendChild(placeholder);

                message.transitions.forEach((transition) => {
                  const option = document.createElement('option');
                  option.value = transition.id;
                  option.textContent = transition.name;
                  select.appendChild(option);
                });

                select.classList.remove('hidden');
              }

              if (applyButton) {
                applyButton.classList.remove('hidden');
              }

              if (moveButton) {
                moveButton.textContent = 'Cambiar estado';
                moveButton.disabled = false;
              }
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private renderTicket(result: TicketResult): string {
    const { ticket, analysis, conclusion, grafanaUrl, kibanaUrl, commentedAt } = result;

    const statusMap: Record<string, string> = {
      COMPLETE: 'status-complete',
      MISSING_DATA: 'status-missing',
      EMPTY: 'status-empty',
      CLOSED: 'status-closed',
      UNCLASSIFIED: 'status-unclassified',
    };

    const conclusionText: Record<string, string> = {
      COMPLETE: 'Completo',
      MISSING_DATA: 'Datos incompletos',
      EMPTY: 'Vacío',
      CLOSED: 'Cerrado',
      UNCLASSIFIED: 'No clasificado',
    };

    let analysisHtml = '';
    if (analysis) {
      const missingFieldsHtml =
        analysis.missingFields.length > 0
          ? `<ul class="missing-fields">${analysis.missingFields
              .map((field) => `<li>${this.escapeHtml(field)}</li>`)
              .join('')}</ul>`
          : '';
      const nextStepsHtml = analysis.nextSteps.length > 0
        ? `<ol class="next-steps">${analysis.nextSteps
            .map((step) => `<li>${this.escapeHtml(step)}</li>`)
            .join('')}</ol>`
        : '';

      analysisHtml = `
        <div class="ticket-analysis">
          <div class="analysis-header">
            <div class="analysis-title">${this.escapeHtml(analysis.classification)}</div>
            <span class="confidence">${Math.round(analysis.confidence * 100)}%</span>
          </div>
          <div class="analysis-summary">${this.escapeHtml(analysis.summary)}</div>
          ${missingFieldsHtml}
          ${nextStepsHtml}
        </div>
      `;
    }

    let dashboardsHtml = '';
    if (grafanaUrl || kibanaUrl) {
      dashboardsHtml += '<div class="dashboard-actions">';
      if (grafanaUrl) {
        dashboardsHtml += `<button class="btn btn-secondary" data-action="openUrl" data-url="${this.escapeAttribute(grafanaUrl)}">Grafana</button>`;
      }
      if (kibanaUrl) {
        dashboardsHtml += `<button class="btn btn-secondary" data-action="openUrl" data-url="${this.escapeAttribute(kibanaUrl)}">Kibana</button>`;
      }
      dashboardsHtml += '</div>';
    }

    const commentedAtText = commentedAt ? new Date(commentedAt).toLocaleString('es-ES') : 'Pendiente';
    const createdText = new Date(ticket.created).toLocaleString('es-ES');
    const updatedText = new Date(ticket.updated).toLocaleString('es-ES');

    return `
      <div class="ticket">
        <div class="ticket-header">
          <div class="ticket-title-group">
            <button class="ticket-key" data-action="openUrl" data-url="${this.escapeAttribute(ticket.url)}">${this.escapeHtml(ticket.key)}</button>
            <div class="ticket-summary">${this.escapeHtml(ticket.summary)}</div>
          </div>
          <span class="status-badge ${statusMap[conclusion]}">${conclusionText[conclusion]}</span>
        </div>
        <div class="ticket-details">
          <div class="detail-line">
            <span class="detail-label">Prioridad</span>
            <span class="ticket-priority">${this.escapeHtml(ticket.priority)}</span>
          </div>
          <div class="detail-line">
            <span class="detail-label">Estado Jira</span>
            <span class="detail-value">${this.escapeHtml(ticket.status)}</span>
          </div>
          <div class="detail-line">
            <span class="detail-label">Tipo</span>
            <span class="detail-value">${this.escapeHtml(ticket.issueType)}</span>
          </div>
          <div class="detail-line">
            <span class="detail-label">Reportante</span>
            <span class="detail-value" title="${this.escapeAttribute(ticket.reporter)}">${this.escapeHtml(ticket.reporter)}</span>
          </div>
          <div class="detail-line">
            <span class="detail-label">Creado</span>
            <span class="detail-value">${createdText}</span>
          </div>
          <div class="detail-line">
            <span class="detail-label">Actualizado</span>
            <span class="detail-value">${updatedText}</span>
          </div>
          <div class="detail-line">
            <span class="detail-label">Comentario</span>
            <span class="detail-value">${commentedAtText}</span>
          </div>
        </div>
        ${analysisHtml}
        ${dashboardsHtml}
        <div class="ticket-actions">
          <button class="btn" data-action="moveTicket" data-key="${this.escapeAttribute(ticket.key)}">Cambiar estado</button>
          <select id="transition-${this.escapeAttribute(ticket.key)}" class="transition-select hidden">
            <option value="">Cargando estados...</option>
          </select>
          <button id="apply-${this.escapeAttribute(ticket.key)}" class="btn hidden" data-action="applyTransition" data-key="${this.escapeAttribute(ticket.key)}">Aplicar</button>
        </div>
      </div>
    `;
  }

  private getConclusionCounts(): Record<TicketResult['conclusion'], number> {
    const counts: Record<TicketResult['conclusion'], number> = {
      COMPLETE: 0,
      MISSING_DATA: 0,
      EMPTY: 0,
      CLOSED: 0,
      UNCLASSIFIED: 0,
    };

    for (const result of this.results) {
      counts[result.conclusion]++;
    }

    return counts;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  private escapeAttribute(text: string): string {
    return this.escapeHtml(text);
  }

  public dispose(): void {
    TicketPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
