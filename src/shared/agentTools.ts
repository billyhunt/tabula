/**
 * The canvas tools agents use. One list feeds both the MCP server (external
 * agents such as Claude Code) and the chat (Claude inside the app), so the
 * two always offer the same abilities.
 *
 * Each tool runs in the renderer against the live Excalidraw scene; main
 * forwards calls through src/main/agent/bridge.ts. The MCP-only file tools
 * (export, open_file, save) are split: main checks paths and does file IO,
 * and asks the renderer for scene work through the bridge-only tools below.
 */
import { z } from 'zod'

export interface CanvasToolSpec<Schema extends z.ZodType = z.ZodType> {
  name: string
  /** Written for a model: what the tool does and when to use it. */
  description: string
  input: Schema
  /** Some tools (file paths, opening files) only make sense for MCP clients. */
  availability: 'all' | 'mcp'
}

// ── Shared pieces ──────────────────────────────────────────────────────────

const elementId = z.string().min(1)
const color = z.string().min(1).describe('CSS color such as "#1e1e1e", or "transparent"')
const coordinate = z.number().describe('Scene coordinate in px')
const length = z.number().positive()
const angle = z.number().describe('Rotation in radians')
const fontSize = z.number().positive().max(200)
const textAlign = z.enum(['left', 'center', 'right'])
const link = z.string().min(1).describe('URL opened when the element is clicked')

const style = {
  strokeColor: color.optional(),
  backgroundColor: color.optional(),
  fillStyle: z.enum(['hachure', 'cross-hatch', 'solid', 'zigzag']).optional(),
  strokeWidth: z.number().positive().max(32).optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  roughness: z.number().int().min(0).max(2).optional().describe('0 = clean lines, 2 = sketchy'),
  opacity: z.number().min(0).max(100).optional(),
}

const label = z
  .strictObject({
    text: z.string().min(1),
    fontSize: fontSize.optional(),
    strokeColor: color.optional(),
    textAlign: textAlign.optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  })
  .describe('Text inside the shape, or on the arrow')

const callerId = elementId
  .optional()
  .describe('Your own id for this element, so arrows and frames in the same call can refer to it')

const point = z.array(z.number()).length(2).describe('[x, y] relative to the element position')

const arrowhead = z
  .enum(['arrow', 'bar', 'circle', 'circle_outline', 'triangle', 'triangle_outline', 'diamond', 'diamond_outline'])
  .nullable()

const endpoint = z
  .strictObject({
    id: elementId
      .optional()
      .describe('Connect to this element: an id from this call or an existing element'),
    type: z
      .enum(['rectangle', 'ellipse', 'diamond', 'text'])
      .optional()
      .describe('Or create a new element at this end'),
    text: z.string().min(1).optional().describe('Text of a new text element at this end'),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: length.optional(),
    height: length.optional(),
    ...style,
  })
  .refine((end) => (end.id === undefined) !== (end.type === undefined), {
    message: 'give either id (to connect to an element) or type (to create one), not both',
  })
  .refine((end) => end.type !== 'text' || end.text !== undefined, {
    message: 'a text endpoint needs text',
  })

const shapeSkeleton = z.strictObject({
  type: z.enum(['rectangle', 'ellipse', 'diamond']),
  id: callerId,
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: length.optional(),
  height: length.optional(),
  angle: angle.optional(),
  label: label.optional(),
  link: link.optional(),
  ...style,
})

const textSkeleton = z.strictObject({
  type: z.literal('text'),
  id: callerId,
  text: z.string().min(1),
  x: coordinate.optional(),
  y: coordinate.optional(),
  fontSize: fontSize.optional(),
  textAlign: textAlign.optional(),
  angle: angle.optional(),
  link: link.optional(),
  strokeColor: color.optional(),
  opacity: style.opacity,
})

const arrowSkeleton = z.strictObject({
  type: z.literal('arrow'),
  id: callerId,
  x: coordinate.optional(),
  y: coordinate.optional(),
  points: z.array(point).min(2).optional().describe('Path from [0, 0]; defaults to a straight line'),
  start: endpoint.optional(),
  end: endpoint.optional(),
  label: label.optional(),
  startArrowhead: arrowhead.optional(),
  endArrowhead: arrowhead.optional(),
  ...style,
})

const lineSkeleton = z.strictObject({
  type: z.literal('line'),
  id: callerId,
  x: coordinate.optional(),
  y: coordinate.optional(),
  points: z.array(point).min(2).optional().describe('Path from [0, 0]'),
  ...style,
})

const frameSkeleton = z.strictObject({
  type: z.literal('frame'),
  id: callerId,
  name: z.string().optional(),
  children: z
    .array(elementId)
    .optional()
    .describe('Ids (from this call) of the elements inside; the frame wraps them unless x/y/width/height are given'),
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: length.optional(),
  height: length.optional(),
})

export const elementSkeleton = z.discriminatedUnion('type', [
  shapeSkeleton,
  textSkeleton,
  arrowSkeleton,
  lineSkeleton,
  frameSkeleton,
])
export type ElementSkeletonInput = z.infer<typeof elementSkeleton>
export type EndpointInput = z.infer<typeof endpoint>

// ── Tool inputs ────────────────────────────────────────────────────────────

const empty = z.strictObject({})

export const addElementsInput = z.strictObject({
  elements: z.array(elementSkeleton).min(1).max(500),
})

export const elementUpdate = z
  .strictObject({
    id: elementId,
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: length.optional(),
    height: length.optional(),
    angle: angle.optional(),
    ...style,
    text: z
      .string()
      .optional()
      .describe("New text: a text element's text, a shape's or arrow's label, or a frame's name"),
    link: link.nullable().optional().describe('null removes the link'),
    locked: z.boolean().optional(),
  })
  .refine((update) => Object.keys(update).length > 1, {
    message: 'give at least one property to change besides id',
  })
export type ElementUpdate = z.infer<typeof elementUpdate>

export const updateElementsInput = z.strictObject({
  updates: z.array(elementUpdate).min(1).max(500),
})

export const idsInput = z.strictObject({ ids: z.array(elementId).min(1) })

export const selectElementsInput = z.strictObject({
  ids: z.array(elementId).describe('Elements to select; an empty list clears the selection'),
})

export const zoomToFitInput = z.strictObject({
  ids: z.array(elementId).min(1).optional().describe('Defaults to the whole drawing'),
})

export const importMermaidInput = z
  .strictObject({
    mermaid: z.string().min(1).describe('Mermaid source, e.g. "flowchart LR\\n  A --> B"'),
    x: coordinate.optional(),
    y: coordinate.optional(),
  })
  .refine((input) => (input.x === undefined) === (input.y === undefined), {
    message: 'give both x and y, or neither',
  })

export const screenshotInput = z.strictObject({
  selectionOnly: z.boolean().optional(),
  scale: z
    .number()
    .min(0.25)
    .max(4)
    .optional()
    .describe('Pixel scale; by default large drawings are scaled down to stay legible'),
})

export const exportFormat = z.enum(['png', 'svg', 'pdf', 'mermaid'])
export type ExportFileFormat = z.infer<typeof exportFormat>

export const exportInput = z.strictObject({
  format: exportFormat,
  path: z.string().min(1).describe('Absolute path ending in .png, .svg, .pdf, or .mmd for mermaid'),
  overwrite: z.boolean().optional().describe('Replace an existing file'),
  dark: z.boolean().optional().describe('Dark-mode colours, as Tabula shows them in dark mode (png and svg)'),
})

export const openFileInput = z.strictObject({
  path: z.string().min(1).describe('Absolute path to a .excalidraw.md or .excalidraw file'),
  discardChanges: z.boolean().optional().describe('Open even if the current drawing has unsaved changes'),
})

export const saveInput = z.strictObject({
  path: z
    .string()
    .min(1)
    .optional()
    .describe('Absolute path ending in .excalidraw.md or .excalidraw; omit to save in place'),
})

export const newDrawingInput = z.strictObject({
  discardChanges: z.boolean().optional().describe('Start over even if the drawing has unsaved changes'),
})

// ── Tool list ──────────────────────────────────────────────────────────────

export const CANVAS_TOOLS: CanvasToolSpec[] = [
  {
    name: 'get_scene',
    description:
      'Read the drawing: file path, unsaved-changes flag, selected element ids, the visible ' +
      'area, and every element (id, type, position, size, text or label, colors, stroke, ' +
      'frame, groups, bindings, arrow points). Coordinates are scene px; y grows downward. ' +
      'Call this before changing existing elements.',
    input: empty,
    availability: 'all',
  },
  {
    name: 'add_elements',
    description:
      'Add elements as one undoable step; they end up selected. Types: rectangle, ellipse and ' +
      'diamond (optional label), text, arrow (start/end connect to an element by id — from this ' +
      'call or already on the canvas — or create a new shape; optional label), line (points), ' +
      'and frame (children = ids from this call). Give your own ids so arrows and frames can ' +
      'refer to elements in the same call. Give x/y for every element to lay out a diagram; ' +
      'omit all coordinates to drop the group in the middle of the view. Default size is 100x100. ' +
      'Returns the created ids and a map from your ids to the real ones.',
    input: addElementsInput,
    availability: 'all',
  },
  {
    name: 'update_elements',
    description:
      'Change existing elements as one undoable step: position, size, rotation, colors, fill, ' +
      'stroke, roughness, opacity, link, lock, or text (a text element’s text, a shape’s or ' +
      'arrow’s label — created if missing — or a frame’s name). Labels move and re-wrap with ' +
      'their shape, a frame’s contents move with it, and the ends of connected arrows follow ' +
      'moved or resized shapes in a straight line (curved or elbow routing is not recomputed). ' +
      'Text elements resize to fit their text; width/height apply to shapes, frames and arrows.',
    input: updateElementsInput,
    availability: 'all',
  },
  {
    name: 'delete_elements',
    description:
      'Delete elements as one undoable step, together with their labels; deleting a frame ' +
      'deletes what is inside it. Arrows connected to deleted shapes stay, unconnected.',
    input: idsInput,
    availability: 'all',
  },
  {
    name: 'import_mermaid',
    description:
      'Draw a Mermaid diagram (flowchart, sequence, class, …) as editable elements, placed with ' +
      'its top-left at x/y or in the middle of the view. One undoable step; the new elements ' +
      'end up selected. Often the quickest way to draw a flowchart.',
    input: importMermaidInput,
    availability: 'all',
  },
  {
    name: 'select_elements',
    description: 'Select elements so the user can see them highlighted; an empty list clears the selection.',
    input: selectElementsInput,
    availability: 'all',
  },
  {
    name: 'zoom_to_fit',
    description: 'Scroll and zoom the view to show the given elements, or the whole drawing. Never zooms past 100%.',
    input: zoomToFitInput,
    availability: 'all',
  },
  {
    name: 'screenshot',
    description:
      'Render the drawing (or just the selection) as a PNG image, to check how it looks.',
    input: screenshotInput,
    availability: 'all',
  },
  {
    name: 'export',
    description:
      'Export the drawing to a file: png, svg, pdf (one page) or mermaid (flowchart text). ' +
      'The path must be absolute with the matching extension (.png, .svg, .pdf, .mmd). ' +
      'Refuses to replace an existing file unless overwrite is true.',
    input: exportInput,
    availability: 'mcp',
  },
  {
    name: 'open_file',
    description:
      'Open a drawing (.excalidraw.md or .excalidraw) in Tabula, replacing the current one. ' +
      'Refuses when the current drawing has unsaved changes unless discardChanges is true.',
    input: openFileInput,
    availability: 'mcp',
  },
  {
    name: 'save',
    description:
      'Save the drawing to its file, or to a new path (.excalidraw.md for Obsidian, or ' +
      '.excalidraw), which becomes its file. An untitled drawing needs a path.',
    input: saveInput,
    availability: 'mcp',
  },
  {
    name: 'new_drawing',
    description:
      'Start a new, empty, untitled drawing. Refuses when the current drawing has unsaved ' +
      'changes unless discardChanges is true.',
    input: newDrawingInput,
    availability: 'mcp',
  },
]

export const findCanvasTool = (name: string) => CANVAS_TOOLS.find((tool) => tool.name === name)

// ── Bridge-only tools ──────────────────────────────────────────────────────

/**
 * Tools main calls on the renderer to carry out the MCP file tools. Never
 * listed to agents: they take no paths from agents, or only paths main has
 * already checked.
 */
export const BRIDGE_TOOLS = {
  /** Answers once the editor is up, so main knows a new window is ready. */
  ping: empty,
  loadFile: z.strictObject({
    path: z.string().min(1),
    contents: z.string(),
    discardChanges: z.boolean().optional(),
  }),
  renderExport: z.strictObject({ format: exportFormat, dark: z.boolean().optional() }),
  saveDocument: z.strictObject({ path: z.string().min(1).optional() }),
}
export type BridgeToolName = keyof typeof BRIDGE_TOOLS

/** `renderExport` result for svg and mermaid, in `json`; png comes back as `image`. */
export const renderedText = z.object({ text: z.string(), warnings: z.array(z.string()) })

/** `renderExport` result for pdf, in `json`. */
export const renderedPdf = z.object({
  pages: z.array(z.object({ svg: z.string(), width: z.number(), height: z.number() })),
})

// ── Validation ─────────────────────────────────────────────────────────────

const pathText = (path: readonly PropertyKey[]) =>
  path.reduce<string>(
    (out, key) =>
      typeof key === 'number' ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key),
    '',
  )

/** Zod issues as one sentence a model can act on. */
export const describeZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const where = pathText(issue.path)
      const missing = issue.code === 'invalid_type' && issue.message.endsWith('received undefined')
      if (missing) return `${where || 'input'} is required`
      return where ? `${where}: ${issue.message}` : issue.message
    })
    .join('; ')

/** Parses tool arguments, throwing an Error with a readable message. */
export const parseToolArgs = <Schema extends z.ZodType>(
  tool: string,
  schema: Schema,
  args: unknown,
): z.output<Schema> => {
  const result = schema.safeParse(args ?? {})
  if (!result.success) {
    throw new Error(`Invalid arguments for ${tool}: ${describeZodError(result.error)}.`)
  }
  return result.data
}
