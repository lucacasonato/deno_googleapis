export interface Discovery {
  id: string;
  version: string;
  name: string;
  title: string;
  rootUrl: string;
  basePath: string;
  documentationLink: string;
  description: string;
  parameters: Record<string, unknown>;
  schemas: Record<string, DiscoverySchema>;
  resources: Record<string, DiscoveryResource>;
}

export type DiscoverySchema = Type & { id: string };

export interface DiscoveryResource {
  resources?: Record<string, DiscoveryResource>;
  methods?: Record<string, DiscoveryMethod>;
}

export interface DiscoveryMethod {
  id: string;
  description: string;
  parameters: Record<string, DiscoveryParameter>;
  request?: Type;
  response: Type;
  httpMethod: string;
  path: string;
  parameterOrder: string[];
}

export type DiscoveryParameter = Type & {
  required: boolean;
  location: "path" | "query";
};

export type Type =
  & (
    | TypeAny
    | TypeArray
    | TypeBoolean
    | TypeByte
    | TypeDate
    | TypeDateTime
    | TypeDuration
    | TypeEnum
    | TypeFieldmask
    | TypeIntegerSmall
    | TypeIntegerLarge
    | TypeNumber
    | TypeObject
    | TypeRef
    | TypeString
  )
  & {
    description?: string;
    required?: boolean;
  };

export interface TypeAny {
  type: "any";
}

export interface TypeArray {
  type: "array";
  items: Type | Type[];
}

export interface TypeBoolean {
  type: "boolean";
}

export interface TypeByte {
  type: "string";
  format: "byte";
}

export interface TypeDate {
  type: "string";
  format: "date";
}

export interface TypeDateTime {
  type: "string";
  format: "date-time" | "google-datetime";
}

export interface TypeDuration {
  type: "string";
  format: "google-duration";
}

export interface TypeEnum {
  type: "string";
  enum: string[];
  enumDescriptions: string[];
}

export interface TypeFieldmask {
  type: "string";
  format: "google-fieldmask";
}

export interface TypeIntegerSmall {
  type: "integer";
  format: "int32" | "uint32";
}

export interface TypeNumber {
  type: "number";
  format: "double" | "float";
}

export interface TypeIntegerLarge {
  type: "string";
  format: "int64" | "uint64";
}

export interface TypeObject {
  type: "object";
  properties?: Record<string, Type>;
  additionalProperties?: Type;
  extends?: string;
}

export interface TypeRef {
  type: undefined;
  $ref: string;
}

export interface TypeString {
  type: "string";
}
