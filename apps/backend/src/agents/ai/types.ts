/**
 * Interfaz de proveedor de IA (intercambiable: Gemini primero; OpenAI posible
 * implementando esta misma interfaz). El backend nunca envía credenciales,
 * SQL ni identificadores modificables por el modelo.
 */
export type AIUserPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface AIToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema de los argumentos. */
  parameters: Record<string, unknown>;
}

/** Contenido opaco del proveedor, conservado SOLO en memoria entre llamadas.
 * Gemini 3 exige reenviar thoughtSignature sin modificar; nunca se registra. */
export interface AIModelContent {
  role: "model";
  parts: Array<{ text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: unknown; id?: string } }>;
}

export type AIMessage =
  | { role: "user"; parts: AIUserPart[] }
  | { role: "model_tool_calls"; calls: AIToolCall[]; modelContent?: AIModelContent }
  | { role: "tool_results"; results: Array<{ id: string; name: string; result: unknown; providerId?: string }> };

export interface AIToolCall {
  id: string;
  name: string;
  args: unknown;
  providerId?: string;
}

export interface AIRequest {
  system: string;
  messages: AIMessage[];
  tools: AIToolDeclaration[];
  responseJsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  signal: AbortSignal;
  /** Paso final: se exige JSON del esquema y se prohíben llamadas a herramientas (las declaraciones se mantienen si el historial las usó). */
  final?: boolean;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AIResponse = ({ kind: "final"; json: unknown } | { kind: "tool_calls"; calls: AIToolCall[]; modelContent?: AIModelContent }) & { usage: AIUsage };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** true = proveedor de prueba/demo (FAKE/MOCK); nunca se presenta como IA real. */
  readonly isSimulated: boolean;
  generate(req: AIRequest): Promise<AIResponse>;
}

export type AIErrorCode = "TIMEOUT" | "RATE_LIMITED" | "UNAVAILABLE" | "AUTH" | "BAD_REQUEST" | "INVALID_DOCUMENT" | "INVALID_RESPONSE" | "AI_SPEND_LIMIT";

/** Error del proveedor con clasificación temporal/permanente para los reintentos por etapa. */
export class AIProviderError extends Error {
  constructor(
    readonly code: AIErrorCode,
    readonly retryable: boolean,
    message: string,
    readonly usage?: AIUsage,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
