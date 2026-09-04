import { HttpTransport } from './types';
import { jsonRequest } from './http';

export interface GitHubUser {
  login: string;
  id: number;
}

export interface GitHubRepository {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubCommitSummary {
  oid: string;
  message: string;
  author: string;
  date: string;
}

export interface GitHubCommitFile {
  path: string;
  change: 'added' | 'modified' | 'deleted';
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { throw new Error('GitHub returned invalid JSON'); }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  };
}

export function parseGitHubRepositoryUrl(value: string): { owner: string; repo: string } | null {
  const normalized = value.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const https = normalized.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (https) return { owner: https[1], repo: https[2] };
  const ssh = normalized.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  return null;
}

export class GitHubApi {
  constructor(private readonly transport: HttpTransport, private readonly token: string) {}

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const response = await jsonRequest(this.transport, {
      url: 'https://api.github.com/user',
      headers: authHeaders(this.token),
    });
    const data = parseJson(response.text);
    if (response.status !== 200) throw new Error(data.message || `GitHub authentication check failed (${response.status})`);
    return { login: String(data.login), id: Number(data.id) };
  }

  async getRepository(repoUrl: string): Promise<GitHubRepository> {
    const parsed = parseGitHubRepositoryUrl(repoUrl);
    if (!parsed) throw new Error('The configured repository URL is not a GitHub repository');
    const response = await jsonRequest(this.transport, {
      url: `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      headers: authHeaders(this.token),
    });
    const data = parseJson(response.text);
    if (response.status !== 200) throw new Error(data.message || `GitHub repository check failed (${response.status})`);
    return {
      fullName: String(data.full_name),
      private: Boolean(data.private),
      defaultBranch: String(data.default_branch || 'main'),
    };
  }

  async listCommits(repoUrl: string, branch: string, limit = 25): Promise<GitHubCommitSummary[]> {
    const parsed = parseGitHubRepositoryUrl(repoUrl);
    if (!parsed) return [];
    const response = await jsonRequest(this.transport, {
      url: `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${Math.min(100, Math.max(1, limit))}`,
      headers: authHeaders(this.token),
    });
    const data = parseJson(response.text);
    if (response.status !== 200) throw new Error(data.message || `GitHub commit history failed (${response.status})`);
    return (Array.isArray(data) ? data : []).map((commit: any) => ({
      oid: String(commit.sha),
      message: String(commit.commit?.message || ''),
      author: String(commit.commit?.author?.name || commit.author?.login || 'Unknown'),
      date: String(commit.commit?.author?.date || ''),
    }));
  }

  async getCommitFiles(repoUrl: string, oid: string): Promise<GitHubCommitFile[]> {
    const parsed = parseGitHubRepositoryUrl(repoUrl);
    if (!parsed) return [];
    const response = await jsonRequest(this.transport, {
      url: `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits/${encodeURIComponent(oid)}`,
      headers: authHeaders(this.token),
    });
    const data = parseJson(response.text);
    if (response.status !== 200) throw new Error(data.message || `GitHub commit details failed (${response.status})`);
    const statusMap: Record<string, GitHubCommitFile['change']> = { added: 'added', modified: 'modified', removed: 'deleted', renamed: 'modified' };
    return (Array.isArray(data.files) ? data.files : []).map((file: any) => ({
      path: String(file.filename || file.previous_filename || ''),
      change: statusMap[file.status] || 'modified',
    })).filter((file: GitHubCommitFile) => file.path);
  }
}
