export type ValidationSuccess<T> = {
  ok: true;
  value: T;
};

export type ValidationFailure<Code extends string> = {
  ok: false;
  code: Code;
};

export type ValidationResult<T, Code extends string> =
  | ValidationSuccess<T>
  | ValidationFailure<Code>;

