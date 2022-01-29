import { generate } from "../generator/generator.ts";
import { Anonymous, Discovery, router, serve } from "./deps.ts";

const discovery = new Discovery(new Anonymous());
const list = await discovery.apisList({ preferred: true });

const handler = router({
  "GET@/": home,
  "GET@/v1/{:id}": code,
  "GET@/v1/{:id}.ts": code,
  "GET@/_/auth@v1/mod.ts": async () => {
    const url = new URL("../auth/mod.ts", import.meta.url);
    const resp = await fetch(url.href);
    return new Response(await resp.text(), {
      headers: {
        "content-type": "application/typescript; charset=utf-8",
      },
    });
  },
});

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
import { ServiceAccount, Spanner } from "https://googleapis.deno.dev/v1/spanner:v1.ts";

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
    const url = `https://googleapis.deno.dev/v1/${service.id}.ts`;
    const name = service.name![0].toUpperCase() + service.name!.slice(1);
    return `
        <tr>
          <td><a href="${url}">${service.title}</a></td>
          <td><pre>import { ${name} } from "${url}";</pre></td>
          <td><a href="https://doc.deno.land/${url}">Docs</a></td>
        </tr>`;
  }).join("\n")
}

    `;

function home(): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

async function code(req: Request, { id }: Record<string, string>): Promise<Response> {
  const service = list.items!.find((i) => i.id === id);
  if (!service) {
    return new Response("Service not found", { status: 404 });
  }
  const resp = await fetch(service.discoveryRestUrl!);
  const schema = await resp.json();
  const module = generate(schema);
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
