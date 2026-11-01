import type { WorkspaceCollabContext } from '@open-design/contracts';
import { currentWorkspaceAccountGeneration, workspaceProjectHeaders } from '../../collab/workspace-identity';
import { isProjectShareHistory } from '../share/useProjectShareHistory';

/**
 * What a destructive file operation learned about the files' public links.
 *
 * `unverified` is not zero: the share-state read failed (offline, signed out,
 * hub down), so the count is unknown. It still lets the caller delete — the
 * files are local, and refusing the delete on an unreachable remote turned the
 * only remaining option into a retry that could not help.
 */
export type ActiveFileSharesBeforeDelete =
  | { status: 'not-applicable' }
  | { status: 'verified'; count: number }
  | { status: 'unverified' };

/** Read only the exact HTML files targeted by a destructive file operation. */
export async function readActiveFileSharesBeforeDelete(
  projectId: string,
  filePaths: readonly string[],
  context: WorkspaceCollabContext | null | undefined,
): Promise<ActiveFileSharesBeforeDelete> {
  const htmlPaths = new Set(filePaths.filter(path => /\.html?$/i.test(path)));
  if (htmlPaths.size === 0) return { status: 'not-applicable' };
  if (!context) return { status: 'unverified' };
  const generation = currentWorkspaceAccountGeneration();
  let history: unknown = null;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/share-state`, {
      cache: 'no-store', headers: workspaceProjectHeaders(context),
    });
    history = response.ok ? await response.json() : null;
  } catch {
    history = null;
  }
  if (generation !== currentWorkspaceAccountGeneration() || !isProjectShareHistory(history, projectId)) {
    return { status: 'unverified' };
  }
  return {
    status: 'verified',
    count: history.publications.filter(row => row.status === 'active' && htmlPaths.has(row.sourceFilePath)).length,
  };
}

/**
 * The extra paragraph a delete confirmation appends, or `''` when there is
 * nothing the user needs to know. A verified zero yields `''` — the files carry
 * no public links; an unverified read says so instead of claiming that zero.
 */
export function activeFileSharesWarning(
  shares: ActiveFileSharesBeforeDelete,
  translate: (
    key: 'designs.deleteActiveShares' | 'workspace.deleteSharesUnverified',
    vars?: Record<string, string | number>,
  ) => string,
): string {
  if (shares.status === 'verified') {
    return shares.count > 0 ? translate('designs.deleteActiveShares', { count: shares.count }) : '';
  }
  if (shares.status === 'unverified') return translate('workspace.deleteSharesUnverified');
  return '';
}
