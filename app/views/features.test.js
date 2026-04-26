import { describe, expect, test, vi } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createSubscriptionStore } from '../data/subscriptions-store.js';
import { createFeaturesView } from './features.js';

/**
 * Shared test fixture: lightweight per-subscription issue store registry that
 * mirrors the production `subscription-issue-stores` API surface used by views.
 */
function createTestIssueStores() {
  const stores = new Map();
  const listeners = new Set();
  /** @param {string} id */
  const getStore = (id) => {
    let s = stores.get(id);
    if (!s) {
      s = createSubscriptionIssueStore(id);
      stores.set(id, s);
      s.subscribe(() => {
        for (const fn of Array.from(listeners)) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
      });
    }
    return s;
  };
  return {
    getStore,
    /** @param {string} id */
    snapshotFor(id) {
      return getStore(id).snapshot().slice();
    },
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    register() {
      // no-op; tests seed stores directly via getStore + applyPush
    },
    unregister() {
      // no-op for tests
    }
  };
}

describe('views/features', () => {
  test('renders feature groups from tab:features and reveals direct children on expand', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const data = { updateIssue: vi.fn() };
    const issueStores = createTestIssueStores();
    const subscriptions = createSubscriptionStore(async () => {});

    issueStores.getStore('tab:features').applyPush({
      type: 'snapshot',
      id: 'tab:features',
      revision: 1,
      issues: [
        { id: 'F-1', title: 'Feature One', issue_type: 'feature' },
        { id: 'F-2', title: 'Feature Two', issue_type: 'feature' }
      ]
    });

    /** @type {string[]} */
    const navCalls = [];
    const view = createFeaturesView(
      mount,
      /** @type {any} */ (data),
      (id) => navCalls.push(id),
      subscriptions,
      /** @type {any} */ (issueStores)
    );
    await view.load();

    // Both features are listed and the first is auto-expanded.
    const groups = mount.querySelectorAll('.epic-group[data-feature-id]');
    expect(groups.length).toBe(2);
    expect(groups[0].getAttribute('data-feature-id')).toBe('F-1');

    // Seed F-1's children via its detail subscription.
    issueStores.getStore('detail:F-1').applyPush({
      type: 'snapshot',
      id: 'detail:F-1',
      revision: 1,
      issues: [
        {
          id: 'F-1',
          title: 'Feature One',
          issue_type: 'feature',
          dependents: [
            {
              id: 'T-1',
              title: 'Sub task',
              status: 'open',
              priority: 1,
              issue_type: 'task'
            }
          ]
        }
      ]
    });
    await view.load();

    const childRows = mount.querySelectorAll('tr.epic-row');
    expect(childRows.length).toBeGreaterThanOrEqual(1);
    // Clicking the row body navigates to the child issue.
    childRows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navCalls[0]).toBe('T-1');
  });

  test('nested chevron reveals subtasks of subtasks for a child row', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const data = { updateIssue: vi.fn() };
    const issueStores = createTestIssueStores();
    const subscriptions = createSubscriptionStore(async () => {});

    // Feature F-9 has direct child T-9, and T-9 itself has child T-99.
    issueStores.getStore('tab:features').applyPush({
      type: 'snapshot',
      id: 'tab:features',
      revision: 1,
      issues: [{ id: 'F-9', title: 'Nested', issue_type: 'feature' }]
    });
    issueStores.getStore('detail:F-9').applyPush({
      type: 'snapshot',
      id: 'detail:F-9',
      revision: 1,
      issues: [
        {
          id: 'F-9',
          title: 'Nested',
          issue_type: 'feature',
          dependents: [
            {
              id: 'T-9',
              title: 'Direct child',
              status: 'open',
              priority: 2,
              issue_type: 'task'
            }
          ]
        }
      ]
    });

    const view = createFeaturesView(
      mount,
      /** @type {any} */ (data),
      () => {},
      subscriptions,
      /** @type {any} */ (issueStores)
    );
    await view.load();

    // Pre-seed T-9's detail so the nested table has data the moment we expand.
    issueStores.getStore('detail:T-9').applyPush({
      type: 'snapshot',
      id: 'detail:T-9',
      revision: 1,
      issues: [
        {
          id: 'T-9',
          title: 'Direct child',
          status: 'open',
          priority: 2,
          issue_type: 'task',
          dependents: [
            {
              id: 'T-99',
              title: 'Grandchild',
              status: 'open',
              priority: 2,
              issue_type: 'task'
            }
          ]
        }
      ]
    });

    // Click the child row's chevron — should NOT navigate, only expand.
    const chevron = /** @type {HTMLButtonElement|null} */ (
      mount.querySelector('tr.epic-row .row-expander__btn')
    );
    expect(chevron).not.toBeNull();
    chevron?.click();
    // Wait a microtask for the toggle's async subscription path.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const grandIds = Array.from(
      mount.querySelectorAll('.nested-children tr.epic-row td.mono')
    ).map((c) => c.textContent?.trim());
    expect(grandIds).toContain('T-99');
  });
});
