import { createParentGroupsView } from './parent-groups.js';

/**
 * Features view — thin wrapper over the generic parent-groups view.
 *
 * Differs from Epics only in the source list (`tab:features`), the empty-state
 * label, and the absence of pre-aggregated child counters: progress is derived
 * from the parent's `dependents` once it is expanded (and therefore subscribed
 * via `detail:<id>`).
 *
 * @param {HTMLElement} mount_element
 * @param {{ updateIssue: (input: any) => Promise<any> }} data
 * @param {(id: string) => void} goto_issue
 * @param {any} [subscriptions]
 * @param {any} [issue_stores]
 */
export function createFeaturesView(
  mount_element,
  data,
  goto_issue,
  subscriptions = undefined,
  issue_stores = undefined
) {
  return createParentGroupsView(
    mount_element,
    data,
    goto_issue,
    subscriptions,
    issue_stores,
    {
      tab_subscription_id: 'tab:features',
      parent_kind: 'feature',
      // Counters are derived locally from `dependents` (no server-side
      // aggregation for features). Show progress so users get the same visual
      // signal once the feature is expanded.
      show_progress: true,
      empty_label: 'No features found.',
      auto_expand_first: true
    }
  );
}
