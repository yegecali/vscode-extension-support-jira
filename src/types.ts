export interface JiraTicket {
  key: string;
  summary: string;
  description: string | object | null;
  status: string;
  priority: string;
  issueType: string;
  reporter: string;
  created: string;
  updated: string;
  url: string;
}

export interface MarkdownFrontmatter {
  id: string;
  label: string;
  classification: string;
}

export interface MarkdownPrompt {
  frontmatter: MarkdownFrontmatter;
  body: string;
  filePath: string;
}

export interface LlmScore {
  score: number;
  reason: string;
}

export interface LlmAnalysis {
  classification: string;
  missingFields: string[];
  summary: string;
  nextSteps: string[];
  confidence: number;
  isIncident: boolean;
}

export interface NewmanRunResult {
  collection: string;
  environment: string | null;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface TicketResult {
  ticket: JiraTicket;
  matchedMarkdownPrompt: MarkdownPrompt | null;
  analysis: LlmAnalysis | null;
  grafanaUrl: string | null;
  kibanaUrl: string | null;
  newmanSummary: string | null;
  newmanResults: NewmanRunResult[];
  conclusion: 'COMPLETE' | 'MISSING_DATA' | 'EMPTY' | 'CLOSED' | 'UNCLASSIFIED';
  commentedAt: string | null;
}

export interface ExtensionConfig {
  jiraUrl: string;
  jiraEmail: string;
  jiraProject: string;
  jiraJql: string;
  grafanaUrlTemplate: string;
  kibanaUrlTemplate: string;
  pollingIntervalMinutes: number;
  scoreThreshold: number;
  promptsDirectory: string;
  promptsDocumentation: string;
  postmanCollectionPaths: string[];
  postmanEnvironmentPaths: string[];
  newmanCommand: string;
  newmanTimeoutMs: number;
}
