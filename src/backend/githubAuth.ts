import { CredentialProvider, GitCredential, HttpTransport } from './types';
import { jsonRequest } from './http';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GitHubAuthSession {
  credential: GitCredential;
  userCode: string;
  verificationUri: string;
}

export interface GitHubDeviceAuthOptions {
  clientId: string;
  scope?: string;
  transport: HttpTransport;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onUserCode?: (code: DeviceCode) => void;
}

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function parseJson(response: { text: string }): any {
  try {
    return JSON.parse(response.text || '{}');
  } catch {
    throw new Error('GitHub returned invalid authentication data');
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`GitHub authentication response omitted ${name}`);
  return value;
}

export class GitHubDeviceAuth {
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: GitHubDeviceAuthOptions) {
    if (!options.clientId.trim()) throw new Error('A GitHub OAuth client ID is required');
    this.wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now || (() => Date.now());
  }

  async requestDeviceCode(): Promise<DeviceCode> {
    const response = await jsonRequest(this.options.transport, {
      url: DEVICE_CODE_URL,
      method: 'POST',
      body: JSON.stringify({
        client_id: this.options.clientId,
        scope: this.options.scope || 'repo',
      }),
    });
    const data = parseJson(response);
    if (response.status < 200 || response.status >= 300 || data.error) {
      throw new Error(data.error_description || data.error || `GitHub device authorization failed (${response.status})`);
    }

    const code: DeviceCode = {
      deviceCode: requiredString(data.device_code, 'device code'),
      userCode: requiredString(data.user_code, 'user code'),
      verificationUri: requiredString(data.verification_uri || data.verification_uri_complete, 'verification URI'),
      expiresIn: Number(data.expires_in) || 900,
      interval: Math.max(1, Number(data.interval) || 5),
    };
    this.options.onUserCode?.(code);
    return code;
  }

  async authenticate(): Promise<GitHubAuthSession> {
    const code = await this.requestDeviceCode();
    const deadline = this.now() + code.expiresIn * 1000;
    let interval = code.interval;

    while (this.now() < deadline) {
      await this.wait(interval * 1000);
      const response = await jsonRequest(this.options.transport, {
        url: ACCESS_TOKEN_URL,
        method: 'POST',
        body: JSON.stringify({
          client_id: this.options.clientId,
          device_code: code.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const data = parseJson(response);

      if (data.access_token) {
        return {
          credential: {
            username: 'x-access-token',
            password: requiredString(data.access_token, 'access token'),
            source: 'github',
          },
          userCode: code.userCode,
          verificationUri: code.verificationUri,
        };
      }

      if (data.error === 'authorization_pending') continue;
      if (data.error === 'slow_down') {
        interval += 5;
        continue;
      }
      throw new Error(data.error_description || data.error || `GitHub authentication failed (${response.status})`);
    }

    throw new Error('GitHub authentication timed out before approval');
  }
}

export class StaticCredentialProvider implements CredentialProvider {
  constructor(private credential: GitCredential | null) {}

  async getCredential(): Promise<GitCredential | null> {
    return this.credential;
  }

  setCredential(credential: GitCredential | null): void {
    this.credential = credential;
  }
}
