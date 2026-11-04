// Stands in for @excalidraw/mermaid-to-excalidraw (next.config.ts resolveAlias).
// Excalidraw imports it only for its "Mermaid to Excalidraw" dialog and for
// pasting Mermaid text; the real package brings all of Mermaid (95 MB) into
// the build, which this machine's build ran out of memory on. The Whiteboard
// (revision 9) has no use for it, so those two paths report it unavailable.
export async function parseMermaidToExcalidraw(): Promise<never> {
  throw new Error('Mermaid diagrams are not available on this whiteboard.')
}
