'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2, Network, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getAdminCompanionKnowledgeGraph, type AdminKnowledgeGraphEntity, type AdminKnowledgeGraphEdge } from '@/lib/api/admin-companions';

interface KnowledgeGraphViewerProps {
  companionId: string;
}

interface Node {
  id: string;
  name: string;
  entityType: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  relationType: string;
}

const ENTITY_COLORS: Record<string, string> = {
  person: '#3b82f6', // blue
  place: '#22c55e', // green
  thing: '#f59e0b', // amber
  concept: '#a855f7', // purple
  event: '#ef4444', // red
  organization: '#06b6d4', // cyan
  default: '#6b7280', // gray
};

function getEntityColor(entityType: string): string {
  return ENTITY_COLORS[entityType.toLowerCase()] || ENTITY_COLORS.default;
}

export function KnowledgeGraphViewer({ companionId }: KnowledgeGraphViewerProps) {
  const [entities, setEntities] = useState<AdminKnowledgeGraphEntity[]>([]);
  const [edges, setEdges] = useState<AdminKnowledgeGraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const fetchGraph = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getAdminCompanionKnowledgeGraph(companionId);
      setEntities(response.data.entities);
      setEdges(response.data.edges);
    } catch (error) {
      console.error('Failed to fetch knowledge graph:', error);
    } finally {
      setIsLoading(false);
    }
  }, [companionId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Initialize node positions with force-directed layout
  useEffect(() => {
    if (entities.length === 0) return;

    const width = 800;
    const height = 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Create initial random positions
    const initialNodes: Node[] = entities.map((entity, i) => {
      const angle = (2 * Math.PI * i) / entities.length;
      const radius = Math.min(width, height) * 0.3;
      return {
        id: entity.id,
        name: entity.name,
        entityType: entity.entityType,
        x: centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 50,
        y: centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
      };
    });

    // Simple force-directed simulation
    const nodeMap = new Map(initialNodes.map(n => [n.id, n]));
    const iterations = 100;

    for (let iter = 0; iter < iterations; iter++) {
      const alpha = 1 - iter / iterations;

      // Repulsion between all nodes
      for (let i = 0; i < initialNodes.length; i++) {
        for (let j = i + 1; j < initialNodes.length; j++) {
          const nodeA = initialNodes[i];
          const nodeB = initialNodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (100 * alpha) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodeA.vx -= fx;
          nodeA.vy -= fy;
          nodeB.vx += fx;
          nodeB.vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const source = nodeMap.get(edge.sourceEntityId);
        const target = nodeMap.get(edge.targetEntityId);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.01 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      // Center gravity
      for (const node of initialNodes) {
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * 0.001 * alpha;
        node.vy += dy * 0.001 * alpha;
      }

      // Apply velocities with damping
      for (const node of initialNodes) {
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.6;
        node.vy *= 0.6;

        // Keep within bounds
        node.x = Math.max(50, Math.min(width - 50, node.x));
        node.y = Math.max(50, Math.min(height - 50, node.y));
      }
    }

    setNodes(initialNodes);
  }, [entities, edges]);

  const edgeLines = useMemo(() => {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    return edges.map(edge => {
      const source = nodeMap.get(edge.sourceEntityId);
      const target = nodeMap.get(edge.targetEntityId);
      if (!source || !target) return null;
      return {
        id: edge.id,
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y,
        relationType: edge.relationType,
      };
    }).filter(Boolean);
  }, [nodes, edges]);

  const handleZoomIn = () => setScale(s => Math.min(s * 1.2, 3));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.2, 0.3));
  const handleReset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const selectedEntity = useMemo(() => {
    if (!selectedNode) return null;
    return entities.find(e => e.id === selectedNode.id);
  }, [selectedNode, entities]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  if (entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Network className="h-12 w-12 mb-3 opacity-50" />
        <p>No knowledge graph data</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{entities.length} entities</span>
          <span>&middot;</span>
          <span>{edges.length} relationships</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            className="h-8 w-8"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="h-8 w-8"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReset}
            className="h-8 w-8"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(ENTITY_COLORS).filter(([k]) => k !== 'default').map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-400 capitalize">{type}</span>
          </div>
        ))}
      </div>

      {/* Graph */}
      <div
        ref={containerRef}
        className="relative w-full h-[400px] rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox="0 0 800 600"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {/* Edges */}
          <g>
            {edgeLines.map((edge) => edge && (
              <g key={edge.id}>
                <line
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={1}
                />
              </g>
            ))}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => (
              <Popover key={node.id} open={selectedNode?.id === node.id}>
                <PopoverTrigger asChild>
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(selectedNode?.id === node.id ? null : node);
                    }}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={12}
                      fill={getEntityColor(node.entityType)}
                      opacity={0.9}
                      stroke="white"
                      strokeWidth={selectedNode?.id === node.id ? 2 : 0}
                    />
                    <text
                      x={node.x}
                      y={node.y + 24}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.7)"
                      fontSize={10}
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.name.length > 15 ? node.name.slice(0, 15) + '...' : node.name}
                    </text>
                  </g>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  className="w-64 bg-zinc-900 border-white/10"
                  onClick={(e) => e.stopPropagation()}
                >
                  {selectedEntity && (
                    <div className="space-y-2">
                      <div>
                        <p className="font-medium text-white">{selectedEntity.name}</p>
                        <p className="text-xs text-gray-500 capitalize">{selectedEntity.entityType}</p>
                      </div>
                      {selectedEntity.aliases.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500">Aliases:</p>
                          <p className="text-sm text-gray-400">{selectedEntity.aliases.join(', ')}</p>
                        </div>
                      )}
                      {selectedEntity.metadata && Object.keys(selectedEntity.metadata).length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500">Metadata:</p>
                          <pre className="text-xs text-gray-400 overflow-x-auto">
                            {JSON.stringify(selectedEntity.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
