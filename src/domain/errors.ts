export type MoyeErrorCategory =
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "TRANSIENT_IO"
  | "UNKNOWN_SIDE_EFFECT"
  | "TERMINAL";

export class MoyeError extends Error {
  readonly code: string;
  readonly category: MoyeErrorCategory;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, string>>;

  constructor(options: {
    code: string;
    category: MoyeErrorCategory;
    message: string;
    retryable?: boolean;
    details?: Readonly<Record<string, string>>;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "MoyeError";
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export function asMoyeError(error: unknown): MoyeError {
  if (error instanceof MoyeError) {
    return error;
  }

  return new MoyeError({
    code: "UNEXPECTED_ERROR",
    category: "TRANSIENT_IO",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    cause: error,
  });
}
