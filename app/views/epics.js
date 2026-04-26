import { createParentGroupsView } from './parent-groups.js';

/**
 * Epics view — thin wrapper over the generic parent-groups view.
 *
 * @param {HTMLElement} mount_element
 * @param {{ updateIssue: (input: any) => Promise<any> }} data
 * @param {(id: string) => void} goto_issue
 * @param {any} [subscriptions]
 * @param {any} [issue_stores]
 */
export function createEpicsView(
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
      tab_subscription_id: 'tab:epics',
      parent_kind: 'epic',
      show_progress: true,
      empty_label: 'No epics found.',
      auto_expand_first: true
    }
  );
}
