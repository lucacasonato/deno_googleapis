import * as jose from "https://deno.land/x/jose@v4.4.0/index.ts";

export interface RequestOpts {
  method: string;
  body?: Uint8Array | string;
}

export interface Auth {
  projectId?: string;
  request(url: string, opts: RequestOpts): Promise<unknown>;
}

export interface ServiceAccountKey {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

export class Anonymous implements Auth {
  constructor() {}

  get projectId(): string | undefined {
    return undefined;
  }

  async request(url: string, opts: RequestOpts): Promise<unknown> {
    const resp = await fetch(url, {
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
      },
      body: opts.body,
      method: opts.method,
    });
    return await decodeResponse(resp);
  }
}

export class ServiceAccount implements Auth {
  #projectId: string;
  #clientEmail: string;
  #privateKeyId: string;
  #privateKey: jose.KeyLike;

  constructor(
    projectId: string,
    clientEmail: string,
    privateKeyId: string,
    privateKey: jose.KeyLike,
  ) {
    this.#projectId = projectId;
    this.#clientEmail = clientEmail;
    this.#privateKeyId = privateKeyId;
    this.#privateKey = privateKey;
  }

  static async from(sa: ServiceAccountKey): Promise<ServiceAccount> {
    const privateKey = await jose.importPKCS8(sa.private_key, "RS256");
    return new ServiceAccount(
      sa.project_id,
      sa.client_email,
      sa.private_key_id,
      privateKey,
    );
  }

  get projectId(): string {
    return this.#projectId;
  }

  #token(aud: string): Promise<string> {
    return new jose.SignJWT({ aud: aud })
      .setProtectedHeader({ alg: "RS256", kid: this.#privateKeyId })
      .setIssuer(this.#clientEmail)
      .setSubject(this.#clientEmail)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(this.#privateKey);
  }

  async request(url: string, opts: RequestOpts): Promise<unknown> {
    const aud = new URL(url).origin + "/";
    const token = await this.#token(aud);
    const resp = await fetch(url, {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: opts.body,
      method: opts.method,
    });
    return await decodeResponse(resp);
  }
}

async function decodeResponse(resp: Response): Promise<unknown> {
  if (resp.status >= 400) {
    if (resp.headers.get("content-type")?.includes("application/json")) {
      const body = await resp.json();
      throw new GoogleApiError(
        resp.status,
        body.error.code,
        body.error.message,
        body.error.details,
      );
    } else {
      const body = await resp.text();
      throw new GoogleApiError(
        resp.status,
        "UNCLASSIFIED",
        body,
        undefined,
      );
    }
  }
  return await resp.json();
}

export class GoogleApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(`${code}: ${message}`);
    this.name = "GoogleApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
