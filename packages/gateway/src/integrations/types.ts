import type { IntegrationJob, IntegrationJobStatus } from '../db.js';

export type IntegrationSurfaceId = 'jobs' | 'workflows' | 'integrations' | 'activity';

export type IntegrationProviderRuntimeStatus =
  | 'ready'
  | 'disabled'
  | 'planned'
  | 'error';

export interface IntegrationSurfaceDescriptor {
  id: IntegrationSurfaceId;
  label: string;
  description: string;
}

export interface IntegrationProviderDescriptor {
  id: string;
  kind: string;
  label: string;
  status: IntegrationProviderRuntimeStatus;
  enabled: boolean;
  configured: boolean;
  capabilities: string[];
  notes?: string[];
}

export interface WorkflowCommandDescriptor {
  label: string;
  usage: string;
  examples: string[];
}

export type WorkflowInputFieldType = 'text' | 'textarea' | 'select';
export type WorkflowAvailability = 'ready' | 'coming-soon';
export type WorkflowGroup =
  | 'quick-actions'
  | 'research'
  | 'launch'
  | 'feedback'
  | 'discovery';

export interface WorkflowInputFieldOptionDescriptor {
  value: string;
  label: string;
  description?: string;
}

export interface WorkflowInputFieldDescriptor {
  id: string;
  label: string;
  type?: WorkflowInputFieldType;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: WorkflowInputFieldOptionDescriptor[];
  dynamicOptionsSource?: 'wiki-index';
}

export interface WorkflowInvocationInput {
  text?: string;
  fields?: Record<string, string>;
  source?: 'text' | 'modal' | 'api';
}

export interface WikiIndexEntry {
  name: string;
  description?: string;
  path?: string;
  plugin?: string;
  tags?: string[];
  type?: string;
  modified_at?: number;
}

export type WikiBrowserRoot = 'types' | 'tags' | 'plugins';

export interface WikiBrowserState {
  root: WikiBrowserRoot;
  branch?: string;
  entryPath?: string;
  page?: number;
}

export interface WikiBrowserRootSummary {
  id: WikiBrowserRoot;
  label: string;
  branchCount: number;
  entryCount: number;
  description: string;
}

export interface WikiBrowserBranch {
  id: string;
  label: string;
  count: number;
  description: string;
}

export interface WikiBrowserBreadcrumb {
  label: string;
  state: WikiBrowserState;
}

export interface WikiBrowserModel {
  state: WikiBrowserState;
  roots: WikiBrowserRootSummary[];
  breadcrumbs: WikiBrowserBreadcrumb[];
  branches: WikiBrowserBranch[];
  activeBranch?: WikiBrowserBranch;
  entries: WikiIndexEntry[];
  selectedEntry?: WikiIndexEntry;
  totalEntries: number;
  totalBranchCount: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  page: number;
  pageSize: number;
}

export type WikiBrowserAction =
  | { type: 'set-root'; root: WikiBrowserRoot }
  | { type: 'open-branch'; branch: string }
  | { type: 'open-entry'; entryPath: string }
  | { type: 'back-to-root' }
  | { type: 'back-to-branch' }
  | { type: 'next-page' }
  | { type: 'prev-page' };

export interface WorkflowRunContext {
  repoRoot: string;
}

export interface IntegrationArtifactLink {
  label: string;
  url: string;
}

export interface WorkflowRunResult {
  summary: string;
  lines?: string[];
  json?: unknown;
  status?: IntegrationJobStatus;
  metadata?: Record<string, unknown>;
}

export interface WorkflowInputValidationResult {
  fieldErrors?: Record<string, string>;
}

export interface IntegrationWorkflowDescriptor {
  id: string;
  title: string;
  description: string;
  surface: IntegrationSurfaceId;
  availability?: WorkflowAvailability;
  group?: WorkflowGroup;
  registrySource?: 'built-in' | 'wiki';
  command: WorkflowCommandDescriptor;
  requiresInput?: boolean;
  submitLabel?: string;
  inputFields?: WorkflowInputFieldDescriptor[];
  aliases?: string[];
}

export interface IntegrationWorkflowDefinition extends IntegrationWorkflowDescriptor {
  formatCommandText?(input: WorkflowInvocationInput): string;
  validateInput?(input: WorkflowInvocationInput): WorkflowInputValidationResult | null;
  run(input: WorkflowInvocationInput, context: WorkflowRunContext): Promise<WorkflowRunResult>;
}

export interface InboundIntegrationMessage {
  provider: string;
  requester: string;
  text: string;
  channel?: string;
  thread?: string;
}

export interface BrokerCommandResponse {
  kind: 'reply' | 'job';
  text: string;
  job?: IntegrationJob;
}

export interface WorkflowLaunchRequest {
  provider: string;
  requester: string;
  workflowId: string;
  channel?: string;
  thread?: string;
  input?: WorkflowInvocationInput;
}

export interface IntegrationJobCompletionRequest {
  summary: string;
  lines?: string[];
  resultJson?: unknown;
  metadata?: Record<string, unknown>;
  artifactLink?: IntegrationArtifactLink;
  notifyRequester?: boolean;
}

export interface IntegrationJobStartRequest {
  summary?: string;
  metadata?: Record<string, unknown>;
  notifyRequester?: boolean;
}

export interface IntegrationJobFailureRequest {
  errorText: string;
  summary?: string;
  lines?: string[];
  metadata?: Record<string, unknown>;
  notifyRequester?: boolean;
}

export interface IntegrationJobNotification {
  job: IntegrationJob;
  text: string;
}

export interface IntegrationProviderNotifier {
  notifyJobNotification(notification: IntegrationJobNotification): Promise<void>;
}

export interface IntegrationBrokerSnapshot {
  schema: 'aos-integration-broker-snapshot';
  version: '1.0.0';
  generated_at: string;
  broker: {
    label: string;
    url: string;
  };
  surfaces: IntegrationSurfaceDescriptor[];
  providers: IntegrationProviderDescriptor[];
  workflows: IntegrationWorkflowDescriptor[];
  jobs: IntegrationJob[];
}
