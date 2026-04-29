import { html, render } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';
import { createIssueIdRenderer } from '../utils/issue-id-renderer.js';
import { createIssueRowRenderer } from './issue-row.js';

/**
 * @typedef {{ id: string, title?: string, status?: string, priority?: number, issue_type?: string, assignee?: string, created_at?: number, updated_at?: number, total_children?: number, closed_children?: number, dependents?: any[] }} IssueLite
 */

/**
 * Count total and closed direct children for a parent issue.
 *
 * @param {IssueLite[]} children
 * @returns {{ total_children: number, closed_children: number }}
 */
function countChildrenProgress(children) {
  let closed_children = 0;
  for (const child of children) {
    // Only direct children count toward this parent progress bar.
    if (String(child.status || '') === 'closed') {
      closed_children++;
    }
  }
  return {
    total_children: children.length,
    closed_children
  };
}

/**
 * Get progress counters, preferring subscribed children when they are loaded.
 *
 * @param {{ total_children: number, closed_children: number }} group
 * @param {IssueLite[]} children
 * @returns {{ total_children: number, closed_children: number }}
 */
function getProgressCounts(group, children) {
  if (children.length > 0) {
    return countChildrenProgress(children);
  }
  return {
    total_children: Number(group.total_children || 0),
    closed_children: Number(group.closed_children || 0)
  };
}

/**
 * Generalized "parent → direct children" expandable list view.
 *
 * Used by the Epics and Features tabs. The view subscribes to a tab list
 * (parent issues) and, on expand, subscribes to `detail:<parent_id>` so the
 * parent's `dependents` list (= direct children via parent-child) becomes the
 * row data for the child table.
 *
 * Each child row also has a chevron that recursively reveals *its* direct
 * children in a nested mini-table. The same `detail:<id>` subscription is
 * reused at every level — there is no eager tree fetch and no special handling
 * for cycles beyond the user's own click depth.
 *
 * @param {HTMLElement} mount_element
 * @param {{ updateIssue: (input: any) => Promise<any> }} data
 * @param {(id: string) => void} goto_issue - Navigate to issue detail.
 * @param {{
 *   subscribeList: (client_id: string, spec: { type: string, params?: Record<string, string|number|boolean> }) => Promise<() => Promise<void>>,
 *   selectors: { getIds: (client_id: string) => string[], count?: (client_id: string) => number }
 * }} [subscriptions]
 * @param {{
 *   snapshotFor?: (client_id: string) => any[],
 *   subscribe?: (fn: () => void) => () => void,
 *   register?: (id: string, spec: any) => void,
 *   unregister?: (id: string) => void
 * }} [issue_stores]
 * @param {{
 *   tab_subscription_id: string,
 *   parent_kind: 'epic' | 'feature',
 *   show_progress?: boolean,
 *   empty_label?: string,
 *   auto_expand_first?: boolean
 * }} [config]
 */
export function createParentGroupsView(
  mount_element,
  data,
  goto_issue,
  subscriptions = undefined,
  issue_stores = undefined,
  config = {
    tab_subscription_id: 'tab:epics',
    parent_kind: 'epic',
    show_progress: true,
    empty_label: 'No items found.',
    auto_expand_first: true
  }
) {
  const tab_id = config.tab_subscription_id;
  const parent_kind = config.parent_kind;
  const show_progress = config.show_progress !== false;
  const empty_label = config.empty_label || 'No items found.';
  const auto_expand_first = config.auto_expand_first !== false;

  /** @type {any[]} */
  let groups = [];
  // Top-level expansion state (for parent rows).
  /** @type {Set<string>} */
  const expanded_parents = new Set();
  /** @type {Set<string>} */
  const loading_parents = new Set();
  /** @type {Map<string, () => Promise<void>>} */
  const parent_unsubs = new Map();

  // Nested expansion state — applies to any descendant row, not just direct
  // children of a parent. Keyed by the descendant's issue id.
  /** @type {Set<string>} */
  const expanded_descendants = new Set();
  /** @type {Map<string, () => Promise<void>>} */
  const descendant_unsubs = new Map();

  const selectors = issue_stores ? createListSelectors(issue_stores) : null;
  if (selectors) {
    selectors.subscribe(() => {
      const had_none = groups.length === 0;
      groups = buildGroupsFromSnapshot();
      doRender();
      if (
        auto_expand_first &&
        had_none &&
        groups.length > 0 &&
        expanded_parents.size === 0
      ) {
        const first_id = String(groups[0].parent?.id || '');
        if (first_id) {
          void toggleParent(first_id);
        }
      }
    });
  }

  const renderRow = createIssueRowRenderer({
    navigate: (id) => goto_issue(id),
    onUpdate: updateInline,
    requestRender: doRender,
    getSelectedId: () => null,
    row_class: 'epic-row',
    prefixCell: (it) => chevronCell(String(it.id))
  });

  /**
   * Render the chevron cell that toggles a row's nested children.
   *
   * @param {string} id
   */
  function chevronCell(id) {
    const is_open = expanded_descendants.has(id);
    return html`<td role="gridcell" class="row-expander">
      <button
        type="button"
        class="row-expander__btn ${is_open ? 'is-open' : ''}"
        aria-expanded=${is_open}
        title=${is_open ? 'Collapse children' : 'Expand children'}
        @click=${(/** @type {MouseEvent} */ ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void toggleDescendant(id);
        }}
      >
        ${is_open ? '▾' : '▸'}
      </button>
    </td>`;
  }

  function doRender() {
    render(template(), mount_element);
  }

  function template() {
    if (!groups.length) {
      return html`<div class="panel__header muted">${empty_label}</div>`;
    }
    return html`${groups.map((g) => groupTemplate(g))}`;
  }

  /**
   * @param {{ parent: IssueLite, total_children: number, closed_children: number }} g
   */
  function groupTemplate(g) {
    const parent = g.parent || /** @type {IssueLite} */ ({});
    const id = String(parent.id || '');
    const is_open = expanded_parents.has(id);
    const list = selectors ? selectors.selectChildren(id) : [];
    const progress = getProgressCounts(g, list);
    const progress_class =
      parent_kind === 'feature' ? 'feature-progress' : 'epic-progress';
    const is_loading = loading_parents.has(id);
    const header = html`
      <div
        class="epic-header"
        @click=${() => toggleParent(id)}
        role="button"
        tabindex="0"
        aria-expanded=${is_open}
      >
        ${createIssueIdRenderer(id, { class_name: 'mono' })}
        <span class="text-truncate" style="margin-left:8px"
          >${parent.title || '(no title)'}</span
        >
        ${show_progress
          ? html`<span
              class=${progress_class}
              style="margin-left:auto; display:flex; align-items:center; gap:8px;"
            >
              <progress
                value=${progress.closed_children}
                max=${Math.max(1, progress.total_children)}
              ></progress>
              <span class="muted mono"
                >${progress.closed_children}/${progress.total_children}</span
              >
            </span>`
          : null}
      </div>
    `;
    const body = is_open
      ? html`<div class="epic-children">
          ${is_loading
            ? html`<div class="muted">Loading…</div>`
            : list.length === 0
              ? html`<div class="muted">No issues found</div>`
              : childTable(list)}
        </div>`
      : null;
    // Emit kind-specific data attribute so tests/CSS can target either tab.
    return parent_kind === 'feature'
      ? html`<div class="epic-group" data-feature-id=${id}>
          ${header}${body}
        </div>`
      : html`<div class="epic-group" data-epic-id=${id}>${header}${body}</div>`;
  }

  /**
   * Render a table of children. Each child row is followed by an optional
   * "expander" row that hosts a nested table of grand-children when expanded.
   *
   * @param {IssueLite[]} list
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function childTable(list) {
    return html`<table class="table table--nested-parent">
      <colgroup>
        <col style="width: 32px" />
        <col style="width: 100px" />
        <col style="width: 120px" />
        <col />
        <col style="width: 120px" />
        <col style="width: 160px" />
        <col style="width: 130px" />
      </colgroup>
      <thead>
        <tr>
          <th></th>
          <th>ID</th>
          <th>Type</th>
          <th>Title</th>
          <th>Status</th>
          <th>Assignee</th>
          <th>Priority</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((it) => childWithMaybeNested(it))}
      </tbody>
    </table>`;
  }

  /**
   * Render the main child row plus, if expanded, a follow-up row that contains
   * a nested table of *its* direct children.
   *
   * @param {IssueLite} it
   */
  function childWithMaybeNested(it) {
    const id = String(it.id || '');
    const is_open = expanded_descendants.has(id);
    if (!is_open) {
      return html`${renderRow(it)}`;
    }
    const grand = selectors ? selectors.selectChildren(id) : [];
    return html`${renderRow(it)}
      <tr class="epic-row epic-row--nested">
        <td colspan="7" class="nested-cell">
          <div class="nested-children">
            ${grand.length === 0
              ? html`<div class="muted">No children</div>`
              : childTable(grand)}
          </div>
        </td>
      </tr>`;
  }

  /**
   * @param {string} id
   * @param {{ [k: string]: any }} patch
   */
  async function updateInline(id, patch) {
    try {
      await data.updateIssue({ id, ...patch });
      doRender();
    } catch {
      // ignore — push will reconcile
    }
  }

  /**
   * Subscribe to a parent or descendant `detail:<id>` so its `dependents` are
   * available for child rendering. Idempotent across calls.
   *
   * @param {string} id
   * @returns {Promise<(() => Promise<void>) | null>}
   */
  async function ensureDetailSubscription(id) {
    if (!subscriptions || typeof subscriptions.subscribeList !== 'function') {
      return null;
    }
    try {
      if (issue_stores && /** @type {any} */ (issue_stores).register) {
        /** @type {any} */ (issue_stores).register(`detail:${id}`, {
          type: 'issue-detail',
          params: { id }
        });
      }
    } catch {
      // ignore registration errors
    }
    try {
      return await subscriptions.subscribeList(`detail:${id}`, {
        type: 'issue-detail',
        params: { id }
      });
    } catch {
      return null;
    }
  }

  /**
   * Tear down a `detail:<id>` subscription and the matching local store.
   *
   * @param {string} id
   * @param {() => Promise<void>} unsub
   */
  async function teardownDetailSubscription(id, unsub) {
    try {
      await unsub();
    } catch {
      // ignore
    }
    try {
      if (issue_stores && /** @type {any} */ (issue_stores).unregister) {
        /** @type {any} */ (issue_stores).unregister(`detail:${id}`);
      }
    } catch {
      // ignore
    }
  }

  /**
   * @param {string} parent_id
   */
  async function toggleParent(parent_id) {
    if (!expanded_parents.has(parent_id)) {
      expanded_parents.add(parent_id);
      loading_parents.add(parent_id);
      doRender();
      const unsub = await ensureDetailSubscription(parent_id);
      if (unsub) {
        parent_unsubs.set(parent_id, unsub);
      }
      loading_parents.delete(parent_id);
    } else {
      expanded_parents.delete(parent_id);
      const unsub = parent_unsubs.get(parent_id);
      if (unsub) {
        parent_unsubs.delete(parent_id);
        await teardownDetailSubscription(parent_id, unsub);
      }
    }
    doRender();
  }

  /**
   * Toggle nested expansion for an arbitrary descendant row (subtasks of
   * subtasks). Each descendant gets its own `detail:<id>` subscription.
   *
   * @param {string} id
   */
  async function toggleDescendant(id) {
    if (!expanded_descendants.has(id)) {
      expanded_descendants.add(id);
      doRender();
      const unsub = await ensureDetailSubscription(id);
      if (unsub) {
        descendant_unsubs.set(id, unsub);
      }
    } else {
      expanded_descendants.delete(id);
      const unsub = descendant_unsubs.get(id);
      if (unsub) {
        descendant_unsubs.delete(id);
        await teardownDetailSubscription(id, unsub);
      }
    }
    doRender();
  }

  /** Build groups from the parent-list snapshot. */
  function buildGroupsFromSnapshot() {
    /** @type {IssueLite[]} */
    const parent_entities =
      issue_stores && issue_stores.snapshotFor
        ? /** @type {IssueLite[]} */ (issue_stores.snapshotFor(tab_id) || [])
        : [];
    /** @type {Array<{ parent: IssueLite, total_children: number, closed_children: number }>} */
    const next_groups = [];
    for (const parent of parent_entities) {
      const dependents = Array.isArray(/** @type {any} */ (parent).dependents)
        ? /** @type {any[]} */ (/** @type {any} */ (parent).dependents)
        : [];
      const has_total = Number.isFinite(
        /** @type {any} */ (parent).total_children
      );
      const has_closed = Number.isFinite(
        /** @type {any} */ (parent).closed_children
      );
      const total = has_total
        ? Number(/** @type {any} */ (parent).total_children) || 0
        : dependents.length;
      let closed = has_closed
        ? Number(/** @type {any} */ (parent).closed_children) || 0
        : 0;
      if (!has_closed) {
        for (const d of dependents) {
          if (String(d.status || '') === 'closed') {
            closed++;
          }
        }
      }
      next_groups.push({
        parent,
        total_children: total,
        closed_children: closed
      });
    }
    return next_groups;
  }

  return {
    async load() {
      groups = buildGroupsFromSnapshot();
      doRender();
      try {
        if (
          auto_expand_first &&
          groups.length > 0 &&
          expanded_parents.size === 0
        ) {
          const first_id = String(groups[0].parent?.id || '');
          if (first_id) {
            await toggleParent(first_id);
          }
        }
      } catch {
        // ignore
      }
    }
  };
}
