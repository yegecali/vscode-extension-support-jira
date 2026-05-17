# Jira Ticket Classifier

Extensión de VS Code para asistir flujos de soporte con tickets de Jira. La extensión consulta tickets mediante JQL, los clasifica con reglas y prompts configurables, valida campos requeridos y genera accesos hacia herramientas de monitoreo como Grafana y Kibana.

## Funcionalidades

- Panel lateral de tickets dentro de VS Code.
- Polling configurable contra Jira.
- **Doble modo de clasificación:**
  - Modo Legacy: Clasificación por keywords y plantillas JSON configurables.
  - Modo Markdown + LLM: Carpeta de diagnósticos markdown con scoring paralelo vía GitHub Copilot.
- Generación de URLs de monitoreo para Grafana y Kibana.
- Almacenamiento seguro del token de Jira usando `context.secrets` de VS Code.
- Comandos para iniciar, detener, refrescar, abrir configuración y limpiar cache.

## Flujos de Clasificación

### Flujo Legacy (JSON Keywords)

Cuando `promptsDirectory` está vacío:
1. Sistema lee la descripción del ticket desde Jira.
2. Compara la descripción contra keywords en `classifierPrompts` (JSON).
3. Selecciona el prompt que coincida con más keywords.
4. Usa el prompt para consultar al LLM (contexto: descripción del ticket).
5. LLM retorna análisis con clasificación y campos faltantes.
6. Genera comentario y URLs de Grafana/Kibana según la clasificación.

### Flujo Markdown + LLM Scoring (Nuevo)

Cuando `promptsDirectory` está configurado (ej: `/Users/me/jira-prompts`):
1. Sistema carga todos los archivos `.md` del directorio (con frontmatter YAML).
2. Se crea un ticket nuevo o se actualiza uno existente en Jira.
3. **Fase de Scoring (Paralela):**
   - Para CADA archivo `.md`, el sistema envía al LLM:
     - Descripción del ticket (key, summary, description)
     - Cuerpo completo del archivo `.md` (contexto diagnóstico)
   - LLM retorna un score de relevancia (0-100) para cada prompt.
   - Se ejecutan todos los scorings en paralelo vía `Promise.all()` (no secuencialmente).
4. **Selección del Mejor Prompt:**
   - Sistema elige el prompt con mayor score.
   - Si `bestScore >= scoreThreshold * 100`, se usa ese prompt.
   - Si ninguno cumple el threshold, retorna mensaje por defecto.
5. **Análisis Completo:**
   - Consulta al LLM nuevamente con el prompt ganador y la descripción del ticket.
   - LLM retorna análisis con clasificación, campos faltantes y recomendaciones.
6. **Generación de Comentario:**
   - Crea comentario en Jira con análisis, clasificación y URLs de monitoreo.
   - URLs provienen del frontmatter del `.md` ganador (Grafana y Kibana).

**Ejemplo de salida en logs:**
```
[CYCLE] 3 prompts Markdown cargados
[TICKET-ABC-123] Scoring en paralelo...
  → login-auth-failure.md: score 92 (muy relevante, describe login issues)
  → api-timeout.md: score 34 (poco relevante)
  → db-connection.md: score 21 (no es relevante)
✓ Seleccionado: login-auth-failure.md (score 92)
[TICKET-ABC-123] Analizando con prompt ganador...
[TICKET-ABC-123] Clasificación: AUTHENTICATION_ERROR | Campos faltantes: logs, user_id
```

### Estructura de un Archivo Markdown de Diagnóstico

Cada `.md` debe incluir frontmatter YAML y cuerpo con contexto diagnóstico:

```markdown
---
id: login-authentication-failure
label: Fallo de Autenticación / Login
classification: AUTHENTICATION_ERROR
grafanaDashboard: /d/auth-dashboard
kibanaDashboard: /app/discover#/?_a=(query:(match_phrase:(event:login_failed)))
---

## Diagnóstico de Fallo de Login

Si el ticket describe problemas con login, los posibles errores son:
- Credenciales inválidas (password mal escrito, usuario no existe)
- Sesión expirada o token inválido
- Rate limiting en intentos de login
- Base de datos de autenticación no responde

### Pasos para Diagnosticar

1. Revisar logs de autenticación en Kibana (link en frontmatter)
2. Buscar request_id o session_id en la descripción del ticket
3. Verificar si hay bloqueos de IP o rate limiting
4. Consultar estado del servicio de autenticación en Grafana
5. Si es un cliente específico, revisar su versión de SDK
```

### Comando para Limpiar Cache

A veces el sistema cachea resultados de análisis anteriores. Para forzar un nuevo análisis:
- Ejecuta desde la paleta de comandos (`Cmd+Shift+P` / `Ctrl+Shift+P`):
  - `Jira Classifier: Limpiar cache y reanalizar`
- Esto elimina todos los resultados cacheados y re-ejecuta el ciclo completo.

## Requisitos

- Node.js 20 o superior recomendado.
- VS Code 1.90.0 o superior.
- Acceso a Jira con email y API token.
- Configuración de Jira, Grafana y Kibana desde los settings de VS Code.

## Instalación para desarrollo

```bash
npm install
npm run compile
```

Para compilar en modo watch:

```bash
npm run watch
```

Luego abre el proyecto en VS Code y ejecuta la extensión desde el entorno de depuración de extensiones.

## Configuración

Configura estos valores desde `Settings` buscando `Jira Classifier`:

| Setting | Descripción |
| --- | --- |
| `jiraClassifier.jiraUrl` | URL base de Jira, por ejemplo `https://myco.atlassian.net`. |
| `jiraClassifier.jiraEmail` | Email de la cuenta Jira. |
| `jiraClassifier.jiraProject` | Clave del proyecto Jira. |
| `jiraClassifier.jiraJql` | Consulta JQL usada para obtener tickets. |
| `jiraClassifier.grafanaBaseUrl` | URL base de Grafana. |
| `jiraClassifier.kibanaBaseUrl` | URL base de Kibana. |
| `jiraClassifier.pollingIntervalMinutes` | Intervalo de polling en minutos. |
| `jiraClassifier.scoreThreshold` | Umbral de score (0-1). El LLM califica relevancia 0-100; internamente se multiplica por 100. Por defecto: 0.7 (equivale a 70/100). |
| `jiraClassifier.promptsDirectory` | **(Nuevo) Ruta al directorio con archivos `.md` de diagnóstico.** Si está configurado, reemplaza `classifierPrompts`. Ej: `/Users/me/jira-prompts`. Consulta la sección "Flujos de Clasificación" para detalles. |
| `jiraClassifier.classifierPrompts` | **(Legacy) Solo se usa cuando `promptsDirectory` está vacío.** Lista de clasificadores, keywords, campos requeridos y prompts en formato JSON. |

La primera vez que se active la extensión, VS Code pedirá el API token de Jira y lo guardará como secreto local de la extensión.

## Comandos

La extensión registra estos comandos (disponibles en la paleta: `Cmd+Shift+P` / `Ctrl+Shift+P`):

| Comando | Descripción |
| --- | --- |
| `Jira Classifier: Iniciar Soporte` | Inicia el polling y monitoreo de tickets. |
| `Jira Classifier: Detener Soporte` | Detiene el polling. |
| `Jira Classifier: Refrescar tickets` | Fuerza una lectura inmediata de tickets. |
| `Jira Classifier: Configurar prompts` | Abre los settings de la extensión. |
| `Jira Classifier: Limpiar cache y reanalizar` | Borra los resultados cacheados y re-ejecuta el análisis desde cero. Útil cuando se actualizan los archivos `.md` de diagnóstico. |

También agrega un contenedor en la barra lateral llamado `Jira Classifier` con la vista `Tickets`.

## Scripts

```bash
npm run compile
npm run watch
npm run lint
npm test
```

## Estructura

```text
src/
  config/       Manejo de configuración de VS Code
  core/         Clasificación, URLs y construcción de comentarios
  services/     Integraciones con Jira, LLM y secretos
  support/      Control del ciclo de soporte
  ui/           Panel webview de tickets
  extension.ts  Punto de entrada de la extensión
```

## Ejemplos

La carpeta `examples/` contiene 3 archivos `.md` de ejemplo que demuestran el formato esperado:

- `login-authentication-failure.md` — Diagnóstico para problemas de autenticación y login.
- `database-connection-error.md` — Diagnóstico para errores de conexión a base de datos.
- `api-timeout-performance.md` — Diagnóstico para timeouts y problemas de latencia en APIs.

Puedes usar estos como plantilla para crear tus propios diagnósticos. Cada archivo contiene:
- **Frontmatter YAML:** id, label, classification, grafanaDashboard, kibanaDashboard.
- **Cuerpo:** Contexto y pasos de diagnóstico que ayudan al LLM a evaluar relevancia y generar análisis.

Para usar estos ejemplos:
1. Copia el directorio `examples/` a una ubicación conocida (ej: `/Users/me/jira-prompts`).
2. Configura `jiraClassifier.promptsDirectory` en los settings de VS Code.
3. Ejecuta "Jira Classifier: Refrescar tickets" para cargar los prompts.

## Empaquetado

Para generar un paquete `.vsix`, instala `vsce` si no lo tienes disponible y ejecuta:

```bash
npx vsce package
```

Los archivos generados, dependencias locales, secretos y salidas de compilación están excluidos por `.gitignore`.
