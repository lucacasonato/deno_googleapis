import { assert, CodeBlockWriter, dedent } from "./deps.ts";
import {
  Discovery,
  DiscoveryMethod,
  DiscoveryParameter,
  DiscoveryResource,
  DiscoverySchema,
  Type,
} from "./types.ts";

interface Method extends DiscoveryMethod {
  camelCaseName: string;
  pascalCaseName: string;
  queryParams: [string, DiscoveryParameter][];
  pathParams: [string, DiscoveryParameter][];
}

interface Param {
  name: string;
  type: Type;
  description?: string;
  default?: boolean;
}

function camelCase(parts: string[]): string {
  let name = "";
  for (const n of parts) {
    if (name !== "") {
      name += n[0].toUpperCase() + n.slice(1);
    } else {
      name += n;
    }
  }
  return name;
}

function pascalCase(parts: string[]): string {
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

class Generator {
  #schema: Discovery;
  #w = new CodeBlockWriter({
    newLine: "\n",
    indentNumberOfSpaces: 2,
  });
  #methods: Method[];
  #name: string;

  #visitResource(names: string[], resource: DiscoveryResource) {
    if (resource.methods) {
      for (const [name, method] of Object.entries(resource.methods)) {
        const parts = [...names, name];
        const camelCaseName = camelCase(parts);
        const pascalCaseName = pascalCase(parts);
        const queryParams: [string, DiscoveryParameter][] = [];
        const pathParams: [string, DiscoveryParameter][] = [];
        for (const [name, param] of Object.entries(method.parameters)) {
          if (param.location === "query") {
            queryParams.push([name, param]);
          } else if (param.location === "path") {
            pathParams.push([name, param]);
          }
        }
        queryParams.sort((a, b) => a[0].localeCompare(b[0]));
        pathParams.sort((a, b) => a[0].localeCompare(b[0]));
        this.#methods.push({
          ...method,
          camelCaseName,
          pascalCaseName,
          queryParams,
          pathParams,
        });
      }
    }
    if (resource.resources) {
      for (const [name, child] of Object.entries(resource.resources)) {
        this.#visitResource([...names, name], child);
      }
    }
  }

  constructor(schema: Discovery) {
    this.#schema = schema;
    this.#methods = [];
    for (const [name, resource] of Object.entries(this.#schema.resources)) {
      this.#visitResource([name], resource);
    }
    this.#methods.sort((a, b) =>
      a.camelCaseName.localeCompare(b.camelCaseName)
    );
    this.#name = pascalCase([this.#schema.name]);
  }

  generate(): string {
    this.#writeHeader();
    this.#writePrimary();
    this.#writeOptions();
    this.#writeTypes();

    return this.#w.toString();
  }

  get #selfUrl() {
    return `https://googleapis.deno.dev/v1/${this.#schema.id}`;
  }

  /** Escape a documentation string so it is safe to use in a multiline JS
   * comment. */
  #escapeDocs(s: string): string {
    return s.replaceAll("\*/", "*\\/");
  }

  #writeDocComment(s: string, params?: Param[]) {
    // split the comment into multiple (line length - 3) column lines at word boundaries
    const maxLen = 80 - 3 - (this.#w.getIndentationLevel() * 2);
    const words = this.#escapeDocs(s).split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (line.length + word.length + 1 > maxLen) {
        lines.push(line.trim());
        line = word;
      } else {
        line += ` ${word}`;
      }
    }
    lines.push(line.trim());
    this.#w.writeLine(`/**`);
    for (const line of lines) {
      this.#w.writeLine(` * ${line}`);
    }
    if (params) {
      this.#w.writeLine(" *");
      for (const param of params) {
        if (param.description) {
          this.#w.writeLine(` * @param ${param.name} ${param.description}`);
        }
      }
    }
    this.#w.writeLine(` */`);
  }

  #writeHeader() {
    const title = `${this.#schema.title} Client for Deno`;
    const header = dedent`
    // Copyright 2022 Luca Casonato. All rights reserved. MIT license.
    /**
     * ${title}
     * ${"=".repeat(title.length)}
     * 
     * ${this.#escapeDocs(this.#schema.description)}
     * 
     * Docs: ${this.#schema.documentationLink}
     * Source: ${this.#selfUrl}
     */
    `;
    this.#w.writeLine(header);
    this.#w.blankLine();

    const imports =
      `import { Anonymous, type Auth, ServiceAccount } from "/_/auth@v1/mod.ts";\nexport { Anonymous, type Auth, ServiceAccount };`;
    this.#w.writeLine(imports);
    this.#w.blankLine();
  }

  #type(t: Type) {
    switch (t.type) {
      case "any":
        this.#w.write("any");
        return;
      case "array": {
        if (Array.isArray(t.items)) {
          this.#w.write("[");
          for (const item of t.items) {
            this.#type(item);
            this.#w.write(", ");
          }
          this.#w.write("]");
        } else {
          this.#type(t.items);
          this.#w.write("[]");
        }
        return;
      }
      case "boolean":
        this.#w.write("boolean");
        return;
      case "number":
      case "integer":
        this.#w.write("number");
        return;
      case "string":
        if ("format" in t) {
          switch (t.format) {
            case "byte":
              this.#w.write("Uint8Array");
              return;
            case "int64":
            case "uint64":
              this.#w.write("bigint");
              return;
            case "date":
            case "date-time":
            case "google-datetime":
              this.#w.write("Date");
              return;
            case "google-duration":
              this.#w.write("number /* Duration */");
              return;
            case "google-fieldmask": {
              this.#w.write("string /* FieldMask */");
              return;
            }
          }
        } else if ("enum" in t) {
          for (const e of t.enum) {
            this.#w.write(` | "${e}"`);
          }
        } else {
          this.#w.write("string");
        }
        return;
      case "object": {
        this.#w.inlineBlock(() => {
          if (t.properties) {
            const properties = Object.entries(t.properties);
            properties.sort((a, b) => a[0].localeCompare(b[0]));
            for (const [name, prop] of properties) {
              this.#writeIdent(name);
              if (!prop.required) this.#w.write("?");
              this.#w.write(": ");
              this.#type(prop);
              this.#w.write(";");
              this.#w.newLine();
            }
          }
          if (t.additionalProperties) {
            this.#w.write("[key: string]: ");
            this.#type(t.additionalProperties);
          }
        });
        return;
      }
      default:
        if ("$ref" in t) {
          this.#w.write(t.$ref);
        } else {
          this.#w.write("unknown /* TODO */");
        }
    }
  }

  #writePrimary() {
    this.#writeDocComment(this.#schema.description);
    this.#w.write("export class ");
    this.#w.write(this.#name);
    this.#w.block(() => {
      // write fields
      this.#w.writeLine("#auth: Auth;");
      this.#w.writeLine("#baseUrl: string;");
      this.#w.blankLine();

      // write constructor
      const baseUrl = new URL(this.#schema.basePath, this.#schema.rootUrl);
      this.#w.write("constructor(auth: Auth = new Anonymous(), baseUrl: string = ");
      this.#w.quote(baseUrl.href);
      this.#w.write(")");
      this.#w.block(() => {
        this.#w.writeLine("this.#auth = auth;");
        this.#w.writeLine("this.#baseUrl = baseUrl;");
      });

      // write methods
      for (const method of this.#methods) {
        this.#writeMethod(method);
      }
    });
  }

  #writeIdent(ident: string) {
    if (ident.includes(".")) {
      this.#w.write("[");
      this.#w.quote(ident);
      this.#w.write("]");
    } else {
      this.#w.write(ident);
    }
  }

  #writeIndex(ident: string) {
    if (ident.includes(".")) {
      this.#w.write("[");
      this.#w.quote(ident);
      this.#w.write("]");
    } else {
      this.#w.write(".");
      this.#w.write(ident);
    }
  }

  #writeParams(params: Param[]) {
    for (const param of params) {
      if (this.#w.getLastChar() !== "(") {
        this.#w.write(", ");
      }
      this.#w.write(param.name);
      this.#w.write(": ");
      this.#type(param.type);
      if (param.default) {
        this.#w.write(" = {}");
      }
    }
  }

  #writeMethod(method: Method) {
    const params: Param[] = [];
    for (const [name, param] of method.pathParams) {
      assert(param.required, "path params must be required");
      params.push({
        name,
        type: param,
        description: param.description,
      });
    }
    if (method.request) {
      params.push({
        name: "req",
        type: method.request,
      });
    }
    if (method.queryParams.length > 0) {
      params.push({
        name: "opts",
        type: { type: undefined, $ref: `${method.pascalCaseName}Options` },
        default: true,
      });
    }

    this.#w.blankLine();
    this.#writeDocComment(method.description, params);
    this.#w.write("async ");
    this.#w.write(method.camelCaseName);
    this.#w.write("(");
    this.#writeParams(params);
    this.#w.write("): Promise<");
    this.#type(method.response);
    this.#w.write(">");
    this.#w.block(() => {
      // construct url
      let path = method.path;
      for (const [name] of method.pathParams) {
        path = path.replace(`{+${name}}`, `\${${name}}`);
        path = path.replace(`{${name}}`, `\${${name}}`);
      }
      this.#w.writeLine(`const url = new URL(\`\${this.#baseUrl}${path}\`);`);
      // add options as query params
      for (const [name] of method.queryParams) {
        this.#w.write(`if (opts`);
        this.#writeIndex(name);
        this.#w.write(` !== undefined)`);
        this.#w.block(() => {
          this.#w.write(`url.searchParams.append(`);
          this.#w.quote(name);
          // TODO(lucacasonato): encode properly
          this.#w.write(`, String(opts`);
          this.#writeIndex(name);
          this.#w.write(`));`);
        });
      }
      // create request body
      if (method.request) {
        // TODO(lucacasonato): serialize properly
        this.#w.writeLine(`const body = JSON.stringify(req);`);
      }
      // make request
      this.#w.write(`const resp = await this.#auth.request(url.href, `);
      this.#w.inlineBlock(() => {
        this.#w.write("method: ");
        this.#w.quote(method.httpMethod);
        this.#w.write(",");
        this.#w.newLine();
        if (method.request) {
          this.#w.writeLine("body,");
        }
      });
      this.#w.write(`);`);
      this.#w.newLine();
      this.#w.write("if (resp.status >= 500)");
      this.#w.block(() => {
        this.#w.writeLine("const body = await resp.text();");
        this.#w.writeLine(
          "throw new Error(`${resp.status} ${resp.statusText}: ${body}`);",
        );
      });
      // TODO(lucacasonato): handle errors
      // deserialize response
      // TODO(lucacasonato): deserialize properly
      this.#w.write(`return resp.json();`);
    });
  }

  #writeOptions() {
    for (const method of this.#methods) {
      if (method.queryParams.length > 0) {
        this.#writeOption(method);
      }
    }
  }

  #writeOption(method: Method) {
    this.#w.blankLine();
    const description =
      `Additional options for ${this.#name}#${method.camelCaseName}.`;
    this.#writeDocComment(description);
    const name = method.pascalCaseName + "Options";
    this.#w.write("export interface ");
    this.#w.write(name);
    this.#w.block(() => {
      for (const [name, param] of method.queryParams) {
        if (param.description) this.#writeDocComment(param.description);
        this.#writeIdent(name);
        if (!param.required) this.#w.write("?");
        this.#w.write(": ");
        this.#type(param);
        this.#w.write(";");
        this.#w.newLine();
      }
    });
  }

  #writeTypes() {
    const schemas = Object.values(this.#schema.schemas);
    schemas.sort((a, b) => a.id.localeCompare(b.id));
    for (const schema of schemas) {
      this.#writeType(schema);
    }
  }

  #writeType(schema: DiscoverySchema) {
    this.#w.blankLine();
    if (schema.description) this.#writeDocComment(schema.description);
    this.#w.write("export interface ");
    this.#w.write(schema.id);
    this.#w.block(() => {
      assert(schema.type === "object", "schema must be an object");
      if (schema.properties) {
        const properties = Object.entries(schema.properties);
        properties.sort((a, b) => a[0].localeCompare(b[0]));
        for (const [name, prop] of properties) {
          if (prop.description) this.#writeDocComment(prop.description);
          this.#writeIdent(name);
          if (!prop.required) this.#w.write("?");
          this.#w.write(": ");
          this.#type(prop);
          this.#w.write(";");
          this.#w.newLine();
        }
      }
      if (schema.additionalProperties) {
        this.#w.write("[key: string]: ");
        this.#type(schema.additionalProperties);
        this.#w.write(";");
        this.#w.newLine();
      }
    });
  }
}

export function generate(schema: Discovery): string {
  return new Generator(schema).generate();
}
