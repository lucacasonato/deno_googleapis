#!/usr/bin/env -S deno run --allow-read=. --allow-net --allow-env --allow-hrtime
import { request } from "../base/mod.ts";
import { assert } from "../generator/deps.ts";
import { RestDescription } from "../generator/discovery:v1.gen.ts";
import { generate, primaryName } from "../generator/generator.ts";
import { ConnInfo, Discovery, router, serve } from "./deps.ts";

const discovery = new Discovery();
const list = await discovery.apisList({ preferred: true });

const handler = router<ConnInfo>({
  "GET@/": home,
  "GET@/v1/{:api}\\:{:version}.ts": code,
  "GET@/v1/{:api}\\:{:version}": code,
  "GET@/_/base@v1/:path*": staticFiles,
});

async function staticFiles(
  req: Request,
  _: ConnInfo,
  { path }: Record<string, string>,
): Promise<Response> {
  const url = new URL("../base/", import.meta.url);
  url.pathname += path;
  try {
    const resp = await fetch(url.href);
    const module = await resp.text();
    const acceptsHtml = req.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      return new Response(module, {
        headers: {
          "content-type": "text/plain",
        },
      });
    }
    return new Response(module, {
      headers: {
        "content-type": "application/typescript; charset=utf-8",
      },
    });
  } catch {
    return new Response(`Not found: ${url.href}`, {
      status: 404,
    });
  }
}

function home(req: Request): Response {
  const origin = new URL(req.url).origin;
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Google APIs for Deno</title>
  </head>
  <body>
    <h1>Google APIs for Deno</h1>
    <p>
      This service provides auto-generated Google API clients for Deno.
    </p>
    <h2>Example</h2>
    <pre><code>// Import the client
import { ServiceAccount, Spanner } from "${origin}/v1/spanner:v1.ts";

// Read the service account key.
const file = Deno.readTextFileSync("service-account.json");
const auth = ServiceAccount.fromJson(JSON.parse(file));

// Instantiate the client.
const spanner = new Spanner(auth);

// List Spanner instances.
const instances = await spanner.listInstances("projects/my-project");
console.log(instances);
    </code></pre>
    <h2>Services</h2>
    <table>
      <thead>
        <tr>
          <th>Service</th>
          <th>Usage</th>
          <th>Docs</th>
        </tr>
      </thead>
      <tbody>
${
    list.items!.map((service) => {
      const url = `${origin}/v1/${service.id}.ts`;
      assert(service.name);
      assert(service.title);
      const name = primaryName(service.name, service.title?.split(" "));
      return `
        <tr>
          <td><a href="${url}">${service.title}</a></td>
          <td><pre>import { ${name} } from "${url}";</pre></td>
          <td><a href="https://doc.deno.land/${url}">Docs</a></td>
        </tr>`;
    }).join("\n")
  }

    `;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

async function code(
  req: Request,
  _: ConnInfo,
  { api, version }: Record<string, string>,
): Promise<Response> {
  const discoveryRestUrl =
    list.items!.find((service) =>
      service.name === api && service.version === version
    )!.discoveryRestUrl;
  if (!discoveryRestUrl) {
    return new Response(`Not found: ${api} ${version}`, {
      status: 404,
    });
  }
  const service: RestDescription = await request(discoveryRestUrl, {
    client: undefined,
    method: "GET",
  });
  const module = generate(service, req.url);
  const acceptsHtml = req.headers.get("accept")?.includes("text/html");
  if (acceptsHtml) {
    return new Response(module, {
      headers: {
        "content-type": "text/plain",
      },
    });
  }
  return new Response(module, {
    headers: {
      "content-type": "application/typescript; charset=utf-8",
    },
  });
}

console.log("Listening on http://localhost:8000");
serve(handler);
