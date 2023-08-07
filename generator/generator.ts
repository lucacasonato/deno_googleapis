import { assert, CodeBlockWriter, dedent } from "./deps.ts";
import {
  JsonSchema,
  RestDescription,
  RestMethod,
  RestResource,
} from "https://googleapis.deno.dev/v1/discovery:v1.ts";

interface Method extends RestMethod {
  camelCaseName: string;
  pascalCaseName: string;
  queryParams: [string, JsonSchema][];
  pathParams: [string, JsonSchema][];
}

interface Param {
  name: string;
  schema: JsonSchema;
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

export function primaryName(name: string, words: string[]) {
  let index = 0;
  while (index < name.length) {
    const startIndex = index;
    for (const word of words) {
      if (name.toLowerCase().startsWith(word.toLowerCase(), index)) {
        index += word.length;
        name = name.slice(0, startIndex) + word + name.slice(index);
        break;
      }
    }
    if (index === startIndex) {
      index++;
    }
  }
  return name;
}

class Generator {
  #schema: RestDescription;
  #w = new CodeBlockWriter({
    newLine: "\n",
    indentNumberOfSpaces: 2,
  });
  #methods: Method[];
  #name: string;
  #selfUrl: string;
  #needsBase64Encoder = false;
  #needsBase64Decoder = false;

  #visitResource(names: string[], resource: RestResource) {
    if (resource.methods) {
      for (const [name, method] of Object.entries(resource.methods)) {
        const parts = [...names, name];
        const camelCaseName = camelCase(parts);
        const pascalCaseName = pascalCase(parts);
        const queryParams: [string, JsonSchema][] = [];
        const pathParams: [string, JsonSchema][] = [];
        if (method.parameters) {
          for (const [name, param] of Object.entries(method.parameters)) {
            if (param.location === "query") {
              queryParams.push([name, param]);
            } else if (param.location === "path") {
              pathParams.push([name, param]);
            }
          }
          queryParams.sort((a, b) => a[0].localeCompare(b[0]));
          pathParams.sort((a, b) => a[0].localeCompare(b[0]));
        }
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

  constructor(schema: RestDescription, selfUrl: string) {
    this.#schema = schema;
    this.#methods = [];
    if (this.#schema.resources) {
      for (const [name, resource] of Object.entries(this.#schema.resources)) {
        this.#visitResource([name], resource);
      }
    }
    this.#methods.sort((a, b) =>
      a.camelCaseName.localeCompare(b.camelCaseName)
    );
    assert(this.#schema.name);
    assert(this.#schema.title);
    this.#name = primaryName(this.#schema.name, this.#schema.title.split(" "));
    this.#selfUrl = selfUrl;
  }

  generate(): string {
    this.#writeHeader();
    this.#writePrimary();
    this.#writeTypes();
    if (this.#needsBase64Decoder) {
      this.#w.blankLine();
      this.#w.writeLine(`function decodeBase64(b64: string): Uint8Array {
  const binString = atob(b64);
  const size = binString.length;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}`);
    }
    if (this.#needsBase64Encoder) {
      this.#w.blankLine();
      this.#w.writeLine(
        `const base64abc = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z","0","1","2","3","4","5","6","7","8","9","+","/"];
/**
 * CREDIT: https://gist.github.com/enepomnyaschih/72c423f727d395eeaa09697058238727
 * Encodes a given Uint8Array, ArrayBuffer or string into RFC4648 base64 representation
 * @param data
 */
function encodeBase64(uint8: Uint8Array): string {
  let result = "", i;
  const l = uint8.length;
  for (i = 2; i < l; i += 3) {
    result += base64abc[uint8[i - 2] >> 2];
    result += base64abc[((uint8[i - 2] & 0x03) << 4) | (uint8[i - 1] >> 4)];
    result += base64abc[((uint8[i - 1] & 0x0f) << 2) | (uint8[i] >> 6)];
    result += base64abc[uint8[i] & 0x3f];
  }
  if (i === l + 1) {
    // 1 octet yet to write
    result += base64abc[uint8[i - 2] >> 2];
    result += base64abc[(uint8[i - 2] & 0x03) << 4];
    result += "==";
  }
  if (i === l) {
    // 2 octets yet to write
    result += base64abc[uint8[i - 2] >> 2];
    result += base64abc[((uint8[i - 2] & 0x03) << 4) | (uint8[i - 1] >> 4)];
    result += base64abc[(uint8[i - 1] & 0x0f) << 2];
    result += "=";
  }
  return result;
}`,
      );
    }

    return this.#w.toString();
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
     * ${this.#escapeDocs(this.#schema.description ?? "")}
     * 
     * Docs: ${this.#schema.documentationLink}
     * Source: ${this.#selfUrl}
     */
    `;
    this.#w.writeLine(header);
    this.#w.blankLine();

    const imports =
      `import { auth, CredentialsClient, GoogleAuth, request } from "/_/base@v1/mod.ts";
export { auth, GoogleAuth };
export type { CredentialsClient };`;
    this.#w.writeLine(imports);
    this.#w.blankLine();
  }

  #type(t: JsonSchema) {
    switch (t.type) {
      case "any":
        this.#w.write("any");
        return;
      case "array": {
        assert(t.items);
        this.#type(t.items);
        this.#w.write("[]");
        return;
      }
      case "boolean":
        this.#w.write("boolean");
        return;
      case "number":
      case "integer":
        this.#w.write("number");
        return;
      case "string": {
        let tsFormat = "string";
        let tsComment = "";
        if ("format" in t) {
          switch (t.format) {
            case "byte":
              tsFormat = "Uint8Array";
              break;
            case "int64":
            case "uint64":
              tsFormat = "bigint";
              break;
            case "date":
            case "date-time":
            case "google-datetime":
              tsFormat = "Date";
              break;
            case "google-duration":
              tsFormat = "number";
              tsComment = " /* Duration */";
              break;
            case "google-fieldmask": {
              tsFormat = "string";
              tsComment = " /* FieldMask */";
              break;
            }
          }
        } else if (t.enum !== undefined) {
          tsFormat = `(${t.enum.join(' | ')})`;
        }
        if (t.repeated) {
          tsFormat = `${tsFormat}[]`;
        }
        this.#w.write(`${tsFormat}${tsComment}`);
        return;
      }
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
        if (t.$ref !== undefined) {
          this.#w.write(t.$ref);
        } else {
          assert(false, `unknown type`);
        }
    }
  }

  #writePrimary() {
    if (this.#schema.description) {
      this.#writeDocComment(this.#schema.description);
    }
    this.#w.write("export class ");
    this.#w.write(this.#name);
    this.#w.block(() => {
      // write fields
      this.#w.writeLine("#client: CredentialsClient | undefined;");
      this.#w.writeLine("#baseUrl: string;");
      this.#w.blankLine();

      // write constructor
      assert(this.#schema.rootUrl);
      const baseUrl = new URL(
        this.#schema.servicePath ?? "",
        this.#schema.rootUrl,
      );
      this.#w.write(
        "constructor(client?: CredentialsClient, baseUrl: string = ",
      );
      this.#w.quote(baseUrl.href);
      this.#w.write(")");
      this.#w.block(() => {
        this.#w.writeLine("this.#client = client;");
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
      this.#type(param.schema);
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
        schema: param,
        description: param.description,
      });
    }
    if (method.request) {
      params.push({
        name: "req",
        schema: method.request,
      });
    }
    if (method.queryParams.length > 0) {
      const name = `${method.pascalCaseName}Options`;
      const schema: JsonSchema = {
        id: name,
        type: "object",
        description:
          `Additional options for ${this.#name}#${method.camelCaseName}.`,
        properties: Object.fromEntries(method.queryParams),
      };
      this.#schema.schemas![name] = schema;
      params.push({
        name: "opts",
        schema: { $ref: name },
        default: true,
      });
    }

    this.#w.blankLine();
    if (method.description) this.#writeDocComment(method.description, params);
    this.#w.write("async ");
    this.#w.write(method.camelCaseName);
    this.#w.write("(");
    this.#writeParams(params);
    this.#w.write("): Promise<");
    if (method.response) {
      this.#type(method.response);
    } else {
      this.#w.write("void");
    }
    this.#w.write(">");
    this.#w.block(() => {
      // serialize options
      for (const param of params) {
        if (!this.#isConversionRequired(param.schema)) continue;
        this.#w.write(`${param.name} = `);
        this.#writeSerializer(param.schema, param.name);
        this.#w.write(";");
        this.#w.newLine();
      }
      // construct url
      assert(method.path);
      let path = method.path;
      for (const [name] of method.pathParams) {
        path = path.replace(`{+${name}}`, `\${ ${name} }`);
        path = path.replace(`{${name}}`, `\${ ${name} }`);
      }
      this.#w.writeLine(`const url = new URL(\`\${this.#baseUrl}${path}\`);`);
      // add options as query params
      for (const [name, schema] of method.queryParams) {
        const isArray = !!schema.repeated;
        this.#w.write(`if (opts`);
        this.#writeIndex(name);
        this.#w.write(` !== undefined)`);
        this.#w.block(() => {
          if (isArray) {
            this.#w.write(`for (const ${name} of opts.${name})`);
            this.#w.block(() => {
              this.#w.write(`url.searchParams.append(`);
              this.#w.quote(name);
              this.#w.write(`, String(`);
              this.#w.write(name);
              this.#w.write(`));`);
            });
          } else {
            this.#w.write(`url.searchParams.append(`);
            this.#w.quote(name);
            this.#w.write(`, String(opts`);
            this.#writeIndex(name);
            this.#w.write(`));`);
          }
        });
      }
      // create request body
      if (method.request) {
        this.#w.writeLine(`const body = JSON.stringify(req);`);
      }
      // make request
      this.#w.write(`const data = await request(url.href, `);
      this.#w.inlineBlock(() => {
        this.#w.writeLine("client: this.#client,");
        this.#w.write("method: ");
        assert(method.httpMethod);
        this.#w.quote(method.httpMethod);
        this.#w.write(",");
        this.#w.newLine();
        if (method.request) {
          this.#w.writeLine("body,");
        }
      });
      this.#w.write(`);`);
      this.#w.newLine();
      if (method.response) {
        if (this.#isConversionRequired(method.response)) {
          this.#w.write(`return deserialize${method.response.$ref!}(data);`);
        } else {
          this.#w.write(`return data as ${method.response.$ref!};`);
        }
      }
    });
  }

  #writeTypes() {
    if (this.#schema.schemas === undefined) return;
    const schemas = Object.values(this.#schema.schemas);
    schemas.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
    for (const schema of schemas) {
      this.#writeType(schema);
      this.#writeSerializerFunction(schema);
      this.#writeDeserializerFunction(schema);
    }
  }

  #writeType(schema: JsonSchema) {
    this.#w.blankLine();
    if (schema.description) this.#writeDocComment(schema.description);
    this.#w.write("export interface ");
    assert(schema.id);
    this.#w.write(schema.id);
    this.#w.block(() => {
      assert(schema.type === "object", "schema must be an object");
      if (schema.properties) {
        const properties = Object.entries(schema.properties);
        properties.sort((a, b) => a[0].localeCompare(b[0]));
        for (const [name, prop] of properties) {
          if (prop.description) this.#writeDocComment(prop.description);
          if (prop.readOnly) this.#w.write("readonly ");
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

  #writeDeserializerFunction(schema: JsonSchema) {
    if (!this.#isConversionRequired(schema)) return;
    this.#w.blankLine();
    this.#w.write(`function deserialize${schema.id}(data: any): ${schema.id}`);
    this.#w.block(() => {
      this.#w.write(`return `);
      this.#writeDeserializer(schema, "data");
      this.#w.write(";");
    });
  }

  #writeSerializerFunction(schema: JsonSchema) {
    if (!this.#isConversionRequired(schema)) return;
    this.#w.blankLine();
    this.#w.write(`function serialize${schema.id}(data: any): ${schema.id}`);
    this.#w.block(() => {
      this.#w.write(`return `);
      this.#writeSerializer(schema, "data");
      this.#w.write(";");
    });
  }

  #writeDeserializer(t: JsonSchema, ident: string) {
    if (!this.#isConversionRequired(t)) {
      this.#w.write(ident);
      return;
    }
    switch (t.type) {
      case "array": {
        assert(t.items);
        this.#w.write(`${ident}.map((item: any) => (`);
        this.#writeDeserializer(t.items!, "item");
        this.#w.write("))");
        return;
      }
      case "string":
        if ("format" in t) {
          switch (t.format) {
            case "byte":
              this.#needsBase64Decoder = true;
              this.#w.write(`decodeBase64(${ident} as string)`);
              return;
            case "int64":
            case "uint64":
              this.#w.write(`BigInt(${ident})`);
              return;
            case "date":
            case "date-time":
            case "google-datetime":
              this.#w.write(`new Date(${ident})`);
              return;
            case "google-duration":
              this.#w.write(ident);
              return;
            case "google-fieldmask": {
              this.#w.write(ident);
              return;
            }
          }
        } else {
          this.#w.write(ident);
        }
        return;
      case "object": {
        if (t.additionalProperties) {
          assert((t.properties?.length ?? 0) === 0);
          this.#w.write(
            `Object.fromEntries(Object.entries(${ident}).map(([k, v]: [string, any]) => ([k, `,
          );
          this.#writeDeserializer(t.additionalProperties, "v");
          this.#w.write("])))");
          return;
        } else {
          this.#w.inlineBlock(() => {
            if (t.properties) {
              const properties = Object.entries(t.properties);
              properties.sort((a, b) => a[0].localeCompare(b[0]));
              this.#w.writeLine(`...${ident},`);
              for (const [name, prop] of properties) {
                if (!this.#isConversionRequired(prop)) continue;
                this.#writeIdent(name);
                this.#writeIdent(": ");
                if (prop.required) {
                  this.#writeDeserializer(
                    prop,
                    `${ident}[${JSON.stringify(name)}]`,
                  );
                } else {
                  this.#w.write(
                    `${ident}[${JSON.stringify(name)}] !== undefined ? `,
                  );
                  this.#writeDeserializer(
                    prop,
                    `${ident}[${JSON.stringify(name)}]`,
                  );
                  this.#w.write(" : undefined");
                }
                this.#w.write(",");
                this.#w.newLine();
              }
            }
          });
        }
        return;
      }
      default:
        if (t.$ref !== undefined) {
          this.#w.write(`deserialize${t.$ref}(${ident})`);
        } else {
          assert(false, `unknown type`);
        }
    }
  }

  #writeSerializer(t: JsonSchema, ident: string) {
    if (!this.#isConversionRequired(t)) {
      this.#w.write(ident);
      return;
    }
    switch (t.type) {
      case "array": {
        assert(t.items);
        this.#w.write(`${ident}.map((item: any) => (`);
        this.#writeSerializer(t.items!, "item");
        this.#w.write("))");
        return;
      }
      case "string":
        if ("format" in t) {
          switch (t.format) {
            case "byte":
              this.#needsBase64Encoder = true;
              this.#w.write(`encodeBase64(${ident})`);
              return;
            case "int64":
            case "uint64":
              this.#w.write(`String(${ident})`);
              return;
            case "date":
            case "date-time":
            case "google-datetime":
              this.#w.write(`${ident}.toISOString()`);
              return;
            case "google-duration":
              this.#w.write(ident);
              return;
            case "google-fieldmask": {
              this.#w.write(ident);
              return;
            }
          }
        } else {
          this.#w.write(ident);
        }
        return;
      case "object": {
        if (t.additionalProperties) {
          assert((t.properties?.length ?? 0) === 0);
          this.#w.write(
            `Object.fromEntries(Object.entries(${ident}).map(([k, v]: [string, any]) => ([k, `,
          );
          this.#writeSerializer(t.additionalProperties, "v");
          this.#w.write("])))");
          return;
        } else {
          this.#w.inlineBlock(() => {
            if (t.properties) {
              const properties = Object.entries(t.properties);
              properties.sort((a, b) => a[0].localeCompare(b[0]));
              this.#w.writeLine(`...${ident},`);
              for (const [name, prop] of properties) {
                if (!this.#isConversionRequired(prop)) continue;
                if (prop.readOnly) continue;
                this.#writeIdent(name);
                this.#writeIdent(": ");
                if (prop.required) {
                  this.#writeSerializer(
                    prop,
                    `${ident}[${JSON.stringify(name)}]`,
                  );
                } else {
                  this.#w.write(
                    `${ident}[${JSON.stringify(name)}] !== undefined ? `,
                  );
                  this.#writeSerializer(
                    prop,
                    `${ident}[${JSON.stringify(name)}]`,
                  );
                  this.#w.write(" : undefined");
                }
                this.#w.write(",");
                this.#w.newLine();
              }
            }
          });
        }
        return;
      }
      default:
        if (t.$ref !== undefined) {
          this.#w.write(`serialize${t.$ref}(${ident})`);
        } else {
          assert(false, `unknown type`);
        }
    }
  }

  #isConversionRequired(
    t: JsonSchema,
    visited: Set<string> = new Set(),
  ): boolean {
    switch (t.type) {
      case "any":
        return false;
      case "array": {
        assert(t.items);
        return this.#isConversionRequired(t.items, visited);
      }
      case "boolean":
        return false;
      case "number":
      case "integer":
        return false;
      case "string":
        return "format" in t;
      case "object": {
        if (t.additionalProperties) {
          return this.#isConversionRequired(t.additionalProperties, visited);
        } else if (t.properties) {
          for (const prop of Object.values(t.properties)) {
            if (prop.readOnly) continue;
            if (this.#isConversionRequired(prop, visited)) return true;
          }
        }
        return false;
      }
      default:
        if (t.$ref !== undefined) {
          if (visited.has(t.$ref)) {
            return false;
          }
          visited.add(t.$ref);
          return this.#isConversionRequired(
            this.#schema.schemas![t.$ref],
            visited,
          );
        } else {
          return true;
        }
    }
  }
}

export function generate(schema: RestDescription, selfUrl: string): string {
  return new Generator(schema, selfUrl).generate();
}
