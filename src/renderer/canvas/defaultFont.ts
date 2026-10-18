/**
 * Tabula's font for new text: Comic Shanns, where Excalidraw would use
 * Excalifont. Kept free of the Excalidraw runtime so skeleton code using it
 * stays testable in node; 8 is `FONT_FAMILY['Comic Shanns']`.
 */
export const DEFAULT_FONT_FAMILY = 8

interface Fontable {
  type?: string
  fontFamily?: number
  label?: { fontFamily?: number }
  start?: unknown
  end?: unknown
}

/**
 * Gives an element skeleton's text, label, and any new elements at an arrow's
 * ends the default font, unless they already name one. Without it,
 * `convertToExcalidrawElements` falls back to Excalifont.
 */
export const withDefaultFont = <T>(skeleton: T): T => {
  // Skeletons come in many shapes; only these optional fields are read, and each is checked.
  const s: Fontable = skeleton as Fontable
  const end = (value: unknown) =>
    typeof value === 'object' && value !== null && 'type' in value ? withDefaultFont(value) : value
  return {
    ...s,
    ...(s.type === 'text' && s.fontFamily === undefined && { fontFamily: DEFAULT_FONT_FAMILY }),
    ...(s.label && { label: { fontFamily: DEFAULT_FONT_FAMILY, ...s.label } }),
    ...(s.start !== undefined && { start: end(s.start) }),
    ...(s.end !== undefined && { end: end(s.end) }),
  } as T
}
