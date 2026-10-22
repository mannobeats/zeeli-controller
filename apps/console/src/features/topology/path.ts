interface GraphNode {
  id: string;
  type?: string;
  parentId?: string;
  position: { x: number; y: number };
}
interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

/** The focused node, its parent box and every edge and node back to the internet. */
export function litPath(nodes: GraphNode[], edges: GraphEdge[], focus: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const into = new Map(edges.map((e) => [e.target, e]));
  const lit = new Set<string>([focus]);
  let at: string | undefined = focus;
  while (at) {
    const parent: string | undefined = byId.get(at)?.parentId;
    const edge = into.get(parent ?? at);
    if (parent) lit.add(parent);
    if (!edge) break;
    lit.add(edge.id).add(edge.source);
    at = edge.source;
  }
  return lit;
}

/** Where a node sits on the canvas: device positions are relative to their network box. */
export function absolute(nodes: GraphNode[], node: GraphNode) {
  const parent = nodes.find((n) => n.id === node.parentId);
  return { x: (parent?.position.x ?? 0) + node.position.x, y: (parent?.position.y ?? 0) + node.position.y };
}
