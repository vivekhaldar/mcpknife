// ABOUTME: Interfaces for deployment providers (Fly.io, Cloud Run, etc.).
// ABOUTME: Defines the contract that all providers must implement.

export interface DeployResult {
  url: string;           // Deployed MCP endpoint URL
  name: string;          // App name as deployed
  target: string;        // Provider name
  apiKey: string;        // The API key set on the server
  dashboardUrl?: string; // Provider dashboard link
}

export interface DeployOptions {
  projectDir: string;    // Absolute path to exported project
  name: string;          // App name
  region?: string;       // Deployment region
  env: Record<string, string>; // Extra env vars
  apiKey: string;        // Bearer token for deployed server
}

export interface Provider {
  name: string;
  preflight(opts: DeployOptions): Promise<void>;
  deploy(opts: DeployOptions): Promise<DeployResult>;
  destroy(name: string, region?: string): Promise<void>;
}
