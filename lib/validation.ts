/**
 * Maximum allowed length of a single user message (PRD edge case).
 * Mirrors the textarea `maxLength`; enforced here for any non-UI path.
 */
export const MAX_INPUT_LENGTH = 4000

/** A message is submittable when it has non-whitespace content within the length bound. */
export function isValidMessageInput(text: string): boolean {
  return text.trim() !== '' && text.length <= MAX_INPUT_LENGTH
}
