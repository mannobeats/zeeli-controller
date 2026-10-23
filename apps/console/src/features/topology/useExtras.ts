import { useQuery } from '@tanstack/react-query';
import type { MeshMember, PortLink } from '@zeeli/router-api';
import { useMemo } from 'react';
import { useAgent } from '../../api/queries.ts';
import { api } from '../../api/router.ts';

const NONE: never[] = [];

/** What the map adds beyond clients and networks: mesh nodes (when mesh is on) and port link state (with the agent). */
export function useExtras(): { mesh: MeshMember[]; ports: PortLink[] } {
  const agent = useAgent().data;
  const meshOn = useQuery({ queryKey: ['mesh'], queryFn: api.networkExtras.mesh.config.get }).data?.enabled === true;
  const nodes = useQuery({
    queryKey: ['mesh-nodes'],
    queryFn: api.networkExtras.mesh.nodes,
    enabled: meshOn,
    refetchInterval: 15_000,
  }).data;
  const status = useQuery({
    queryKey: ['port-status'],
    queryFn: api.safety.ports.status,
    enabled: Boolean(agent),
    refetchInterval: 10_000,
  }).data;
  return useMemo(() => ({ mesh: nodes ?? NONE, ports: status?.ports ?? NONE }), [nodes, status]);
}
