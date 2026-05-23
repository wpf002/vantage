'use client';

import { useMemo, useState, useTransition } from 'react';
import { runScenarioAction } from './actions';

export type PortfolioOption = {
  id: string;
  name: string;
  kind: 'system' | 'personal' | 'published';
};

interface TreeNode {
  id: string;
  name: string;
  probability: number; // 0–100 in the UI
  impact: number; // -50 to +50 in the UI
  children: TreeNode[];
}

const MAX_DEPTH = 3;
const ROOT_MAX = 4;
const CHILD_MAX = 3;

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `n${Date.now().toString(36)}-${nextId}`;
}

function makeNode(name = 'New Outcome', probability = 50, impact = 0): TreeNode {
  return { id: makeId(), name, probability, impact, children: [] };
}

const STARTER: TreeNode[] = [
  makeNode('Bull case', 30, 15),
  makeNode('Base case', 50, 5),
  makeNode('Bear case', 20, -15),
];

interface ApiScenarioNode {
  name: string;
  probability: number;
  impact: number;
  children?: ApiScenarioNode[];
}

function toApiTree(nodes: TreeNode[]): ApiScenarioNode[] {
  return nodes.map((n) => ({
    name: n.name.trim() || 'Unnamed',
    probability: clamp01(n.probability / 100),
    // Impact in the engine is multiplicative: 1 == flat, 1.10 == +10%.
    impact: 1 + n.impact / 100,
    children: n.children.length > 0 ? toApiTree(n.children) : undefined,
  }));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

interface SiblingProbCheck {
  path: string;
  sum: number;
}

function collectSiblingChecks(nodes: TreeNode[], pathLabel: string, out: SiblingProbCheck[]) {
  const sum = nodes.reduce((a, n) => a + n.probability, 0);
  out.push({ path: pathLabel, sum });
  for (const n of nodes) {
    if (n.children.length > 0) {
      collectSiblingChecks(n.children, pathLabel ? `${pathLabel} → ${n.name}` : n.name, out);
    }
  }
}

function depthOf(nodes: TreeNode[]): number {
  let d = 0;
  for (const n of nodes) {
    if (n.children.length > 0) d = Math.max(d, depthOf(n.children) + 1);
  }
  return d + 1; // count this level
}

function countLeaves(nodes: TreeNode[]): number {
  let leaves = 0;
  for (const n of nodes) {
    if (n.children.length === 0) leaves += 1;
    else leaves += countLeaves(n.children);
  }
  return leaves;
}

function impactRange(nodes: TreeNode[]): { lo: number; hi: number } {
  // Walk every leaf, compute cumulative multiplicative impact, return min/max.
  let lo = Infinity;
  let hi = -Infinity;
  function walk(n: TreeNode, acc: number, parentProb: number) {
    const next = acc * (1 + n.impact / 100);
    const prob = parentProb * (n.probability / 100);
    if (n.children.length === 0) {
      if (prob > 0) {
        lo = Math.min(lo, next);
        hi = Math.max(hi, next);
      }
      return;
    }
    for (const c of n.children) walk(c, next, prob);
  }
  for (const r of nodes) walk(r, 1, 1);
  if (!Number.isFinite(lo)) return { lo: 1, hi: 1 };
  return { lo, hi };
}

export function ScenarioTreeForm({ portfolios }: { portfolios: PortfolioOption[] }) {
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? '');
  const [tree, setTree] = useState<TreeNode[]>(() => STARTER.map((n) => ({ ...n, id: makeId() })));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submitting = pending;

  const checks = useMemo<SiblingProbCheck[]>(() => {
    const out: SiblingProbCheck[] = [];
    collectSiblingChecks(tree, '', out);
    return out;
  }, [tree]);

  const invalidChecks = checks.filter((c) => Math.abs(c.sum - 100) > 0.01);
  const leaves = countLeaves(tree);
  const range = impactRange(tree);
  const canSubmit = portfolios.length > 0 && tree.length > 0 && invalidChecks.length === 0 && !submitting;

  // ── Mutation helpers ──────────────────────────────────────────────────
  function updateNode(targetId: string, mut: (n: TreeNode) => TreeNode): void {
    function walk(nodes: TreeNode[]): TreeNode[] {
      return nodes.map((n) => {
        if (n.id === targetId) return mut(n);
        if (n.children.length > 0) return { ...n, children: walk(n.children) };
        return n;
      });
    }
    setTree((t) => walk(t));
  }

  function addRoot(): void {
    if (tree.length >= ROOT_MAX) return;
    setTree((t) => [...t, makeNode('New Outcome', 0, 0)]);
  }

  function addChild(parentId: string): void {
    function walk(nodes: TreeNode[], depth: number): TreeNode[] {
      return nodes.map((n) => {
        if (n.id === parentId) {
          if (depth + 1 >= MAX_DEPTH) return n;
          if (n.children.length >= CHILD_MAX) return n;
          return { ...n, children: [...n.children, makeNode('New Sub-Outcome', 0, 0)] };
        }
        if (n.children.length > 0) return { ...n, children: walk(n.children, depth + 1) };
        return n;
      });
    }
    setTree((t) => walk(t, 0));
  }

  function removeNode(targetId: string): void {
    function walk(nodes: TreeNode[]): TreeNode[] {
      return nodes
        .filter((n) => n.id !== targetId)
        .map((n) => (n.children.length > 0 ? { ...n, children: walk(n.children) } : n));
    }
    setTree((t) => walk(t));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await runScenarioAction({ portfolioId, tree: toApiTree(tree) });
      } catch (err) {
        // NEXT_REDIRECT is how server actions signal a redirect — bubble through.
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
        const msg = err instanceof Error ? err.message : 'unknown error';
        const match = msg.match(/"message":"([^"]+)"/);
        setError(match ? match[1] : msg);
      }
    });
  }

  const currentDepth = depthOf(tree);

  if (portfolios.length === 0) {
    return (
      <p className="font-serif italic text-ink-700 max-w-measure">
        No portfolios available yet. Build one and come back.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-x-10 gap-y-12">
      {/* ── Portfolio picker ─────────────────────────────────────────── */}
      <section className="col-span-12 pb-6">
        <p className="eyebrow mb-4">Pick A Portfolio</p>
        <div className="divide-y divide-ink-100 border-y border-ink-100">
          {portfolios.map((p) => {
            const checked = p.id === portfolioId;
            return (
              <label key={p.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="portfolioId"
                  value={p.id}
                  checked={checked}
                  onChange={() => setPortfolioId(p.id)}
                  className="peer sr-only"
                />
                <div
                  className={`border-l-2 pl-6 py-4 transition-colors ${
                    checked ? 'border-editorial' : 'border-transparent hover:border-ink-300'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p
                      className={`font-display text-xl tracking-tight ${
                        checked ? 'text-editorial' : 'text-ink-900'
                      }`}
                    >
                      {p.name}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-wider text-ink-500">
                      {p.kind === 'system' ? 'Default' : 'Personal'}
                    </p>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Tree editor + validation rail ─────────────────────────────── */}
      <section className="col-span-12 lg:col-span-8">
        <div className="flex items-baseline justify-between mb-6">
          <p className="eyebrow">Outcomes</p>
          <p className="font-mono text-xs text-ink-500">
            Depth {currentDepth}/{MAX_DEPTH}
          </p>
        </div>

        <div className="space-y-4">
          {tree.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              depth={0}
              onUpdate={updateNode}
              onAddChild={addChild}
              onRemove={removeNode}
            />
          ))}
        </div>

        {tree.length < ROOT_MAX ? (
          <button
            type="button"
            onClick={addRoot}
            className="mt-6 font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
          >
            + Add Branch
          </button>
        ) : (
          <p className="mt-6 font-serif italic text-xs text-ink-500">
            Maximum {ROOT_MAX} root branches.
          </p>
        )}
        <hr className="mt-8" />
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-8">
        <div>
          <p className="eyebrow mb-3">Probability Check</p>
          <ul className="space-y-2">
            {checks.map((c) => {
              const label = c.path === '' ? 'Root' : c.path;
              const ok = Math.abs(c.sum - 100) <= 0.01;
              return (
                <li key={label} className="font-serif text-sm">
                  {ok ? (
                    <span className="text-ink-700">
                      {label} <span className="font-mono text-ink-900">{c.sum.toFixed(0)}%</span>
                    </span>
                  ) : (
                    <span className="italic text-editorial">
                      {label} sums to{' '}
                      <span className="font-mono">{c.sum.toFixed(0)}%</span> — must equal 100%
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <hr className="mt-5" />
        </div>

        <div>
          <p className="eyebrow mb-3">Path Summary</p>
          <p className="font-serif text-sm text-ink-700 leading-relaxed">
            <span className="font-mono text-ink-900">{leaves}</span> leaf paths.
            <br />
            Impact range:{' '}
            <span className="font-mono text-ink-900">{formatPct(range.lo - 1)}</span> to{' '}
            <span className="font-mono text-ink-900">{formatPct(range.hi - 1)}</span>.
          </p>
          <hr className="mt-5" />
        </div>

        {error ? (
          <p className="font-serif italic text-editorial text-sm">{error}</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`font-display text-2xl border-b-2 transition-colors ${
              canSubmit
                ? 'text-editorial border-editorial hover:text-editorial-dark hover:border-editorial-dark'
                : 'text-ink-300 border-ink-300 cursor-not-allowed'
            }`}
          >
            {submitting ? 'Running…' : 'Run Scenario →'}
          </button>
        </div>
      </aside>
    </form>
  );
}

// ─── Recursive node card ─────────────────────────────────────────────────

function NodeCard({
  node,
  depth,
  onUpdate,
  onAddChild,
  onRemove,
}: {
  node: TreeNode;
  depth: number;
  onUpdate: (id: string, mut: (n: TreeNode) => TreeNode) => void;
  onAddChild: (parentId: string) => void;
  onRemove: (id: string) => void;
}) {
  const canHaveChildren = depth + 1 < MAX_DEPTH;
  const childAtCap = node.children.length >= CHILD_MAX;
  return (
    <div>
      <div className="bg-cream-100 border border-ink-100 p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-6">
            <label className="eyebrow block mb-2">Name</label>
            <input
              type="text"
              value={node.name}
              onChange={(e) => onUpdate(node.id, (n) => ({ ...n, name: e.target.value }))}
              className="w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-sans text-base py-1.5 px-0"
            />
          </div>
          <div className="md:col-span-3">
            <label className="eyebrow block mb-2">Probability</label>
            <div className="flex items-baseline gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={node.probability}
                onChange={(e) =>
                  onUpdate(node.id, (n) => ({ ...n, probability: Number(e.target.value) }))
                }
                className="w-20 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-base py-1.5 px-0 text-right"
              />
              <span className="font-mono text-xs text-ink-500">%</span>
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="eyebrow block mb-2">Impact</label>
            <div className="flex items-baseline gap-2">
              <input
                type="number"
                min={-50}
                max={50}
                step={1}
                value={node.impact}
                onChange={(e) =>
                  onUpdate(node.id, (n) => ({ ...n, impact: Number(e.target.value) }))
                }
                className="w-20 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-base py-1.5 px-0 text-right"
              />
              <span className="font-mono text-xs text-ink-500">%</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-6">
          {canHaveChildren && !childAtCap ? (
            <button
              type="button"
              onClick={() => onAddChild(node.id)}
              className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
            >
              + Sub-Outcome
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(node.id)}
            className="font-sans text-eyebrow uppercase tracking-wider text-ink-500 hover:text-editorial"
          >
            Remove
          </button>
        </div>
      </div>

      {node.children.length > 0 ? (
        <div className="pl-6 border-l border-ink-100 mt-3 space-y-3">
          {node.children.map((c) => (
            <NodeCard
              key={c.id}
              node={c}
              depth={depth + 1}
              onUpdate={onUpdate}
              onAddChild={onAddChild}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}
