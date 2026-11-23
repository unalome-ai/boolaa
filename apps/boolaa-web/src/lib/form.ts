import { useEffect, useRef, type RefObject } from "react";

/**
 * Text typed into a server-rendered form before React hydrates stays in the DOM, but the controlled
 * input's state is still "", so a submit would send an empty value ("missing email" from GoTrue).
 * Fields keep a ref; submit handlers read the DOM value, and on mount any typed value is adopted
 * into state so the field and state agree from then on.
 *
 * The inputs deliberately have no `name`: a submit before hydration then can't put the email or
 * password in the URL of a native GET.
 */
export type FieldRef = RefObject<HTMLInputElement | null>;

export function useFieldRef(): FieldRef {
  return useRef<HTMLInputElement>(null);
}

/** The field's live DOM value, or `fallback` (the state) when it isn't mounted. */
export function domValue(ref: FieldRef, fallback: string): string {
  return ref.current?.value ?? fallback;
}

/** Once, after hydration: copy values typed before hydration into state. */
export function useAdoptTypedValues(fields: [FieldRef, (value: string) => void][]) {
  useEffect(() => {
    for (const [ref, set] of fields) {
      const value = ref.current?.value;
      if (value) set(value);
    }
    // Mount only: later typing goes through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Same for a checkbox. */
export function useAdoptChecked(ref: FieldRef, set: (checked: boolean) => void) {
  useEffect(() => {
    if (ref.current?.checked) set(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
