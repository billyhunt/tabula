/**
 * ipcRenderer.invoke wraps main-process errors as
 * "Error invoking remote method 'agent:ask': Error: <message>"; the user
 * only needs the message main wrote for them.
 */
export const remoteErrorMessage = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
