import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
  type WorkspaceCollabContext,
} from '@open-design/contracts';
import {
  activeFileSharesWarning,
  readActiveFileSharesBeforeDelete,
} from '../src/components/project-actions/activeFileSharesBeforeDelete';

function context(overrides: Partial<WorkspaceCollabContext> = {}): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-1',
    workspaceType: 'team',
    teamId: 'team-1',
    workspaceMemberId: 'wm-1',
    role: 'member',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: null,
    providerMode: 'platform_credits',
    seatSummary: buildWorkspaceSeatSummary({ seatLimit: 5, usedSeats: 1 }),
    permissions: buildWorkspacePermissions({ role: 'member', lifecycleState: 'active' }),
    ...overrides,
  };
}

function historyBody(publications: Array<{ sourceFilePath: string; slug: string; status: 'active' | 'stopped' }>) {
  return {
    projectId: 'project-1',
    bindingExists: true,
    hasEverShared: true,
    publications: publications.map(row => ({ ...row, sourceFileId: `fid-${row.slug}` })),
  };
}

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readActiveFileSharesBeforeDelete', () => {
  it('skips the share read for files with no HTML path', async () => {
    const fetchMock = stubFetch(new Response('{}'));
    expect(await readActiveFileSharesBeforeDelete('project-1', ['notes.md'], context()))
      .toEqual({ status: 'not-applicable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The reported bug: a remote read that answers 503 (hub down, offline, signed
  // out) threw, so every HTML delete died on "Une erreur est survenue" and the
  // only offer was a retry that could not help. The count is unknown, not zero.
  it('reports an unavailable share state as unverified instead of throwing', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'SHARE_STATE_UNAVAILABLE' }), { status: 503 }));
    expect(await readActiveFileSharesBeforeDelete('project-1', ['index.html'], context()))
      .toEqual({ status: 'unverified' });
  });

  it('treats a transport failure as unverified', async () => {
    stubFetch(new Error('network down'));
    expect(await readActiveFileSharesBeforeDelete('project-1', ['index.html'], context()))
      .toEqual({ status: 'unverified' });
  });

  it('treats a missing workspace identity as unverified', async () => {
    const fetchMock = stubFetch(new Response('{}'));
    expect(await readActiveFileSharesBeforeDelete('project-1', ['index.html'], null))
      .toEqual({ status: 'unverified' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts only active links naming the deleted HTML files', async () => {
    stubFetch(new Response(JSON.stringify(historyBody([
      { sourceFilePath: 'index.html', slug: 'a', status: 'active' },
      { sourceFilePath: 'other.html', slug: 'b', status: 'active' },
      { sourceFilePath: 'index.html', slug: 'c', status: 'stopped' },
    ])), { status: 200 }));
    expect(await readActiveFileSharesBeforeDelete('project-1', ['index.html'], context()))
      .toEqual({ status: 'verified', count: 1 });
  });

  it('treats a body that names another project as unverified', async () => {
    stubFetch(new Response(JSON.stringify({ ...historyBody([]), projectId: 'project-2' }), { status: 200 }));
    expect(await readActiveFileSharesBeforeDelete('project-1', ['index.html'], context()))
      .toEqual({ status: 'unverified' });
  });
});

describe('activeFileSharesWarning', () => {
  const translate = (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key;

  it('says nothing when the files carry no active links', () => {
    expect(activeFileSharesWarning({ status: 'verified', count: 0 }, translate)).toBe('');
    expect(activeFileSharesWarning({ status: 'not-applicable' }, translate)).toBe('');
  });

  it('warns about the links that will stop working', () => {
    expect(activeFileSharesWarning({ status: 'verified', count: 2 }, translate))
      .toBe('designs.deleteActiveShares:{"count":2}');
  });

  it('says the links could not be checked rather than claiming none exist', () => {
    expect(activeFileSharesWarning({ status: 'unverified' }, translate))
      .toBe('workspace.deleteSharesUnverified');
  });
});
