import Mention from '@tiptap/extension-mention';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';

export interface MentionCandidate {
  serverId: number;
  username: string;
  name: string | null;
}

export type MentionSearch = (query: string) => Promise<MentionCandidate[]>;

/**
 * Vikunja-compatible mention node. Serializes to
 * `<mention-user data-id="username">@username</mention-user>` — the exact
 * markup Vikunja web writes and the SERVER parses out of stored HTML to
 * create mention notifications (pkg/models/mentions.go). Do not change the
 * tag or attribute without checking upstream.
 */
function buildSuggestion(search: MentionSearch): Partial<SuggestionOptions<MentionCandidate>> {
  return {
    char: '@',
    items: async ({ query }) => {
      try {
        return (await search(query)).slice(0, 8);
      } catch (err) {
        console.error('[mentions] search failed:', err);
        return [];
      }
    },
    render: () => {
      let el: HTMLDivElement | null = null;
      let current: SuggestionProps<MentionCandidate> | null = null;
      let selected = 0;

      const paint = () => {
        if (!el || !current) return;
        el.innerHTML = '';
        current.items.forEach((item, i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className =
            'mention-suggestion-item' + (i === selected ? ' is-selected' : '');
          btn.textContent = item.name ? `${item.name} (@${item.username})` : `@${item.username}`;
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            current?.command(item);
          });
          el!.appendChild(btn);
        });
        el.style.display = current.items.length ? 'flex' : 'none';
        const rect = current.clientRect?.();
        if (rect) {
          el.style.left = `${rect.left}px`;
          el.style.top = `${rect.bottom + 4}px`;
        }
      };

      return {
        onStart: (props) => {
          current = props;
          selected = 0;
          el = document.createElement('div');
          el.className = 'mention-suggestion-popup';
          document.body.appendChild(el);
          paint();
        },
        onUpdate: (props) => {
          current = props;
          selected = Math.min(selected, Math.max(0, props.items.length - 1));
          paint();
        },
        onKeyDown: ({ event }) => {
          if (!current || current.items.length === 0) return false;
          if (event.key === 'ArrowDown') {
            selected = (selected + 1) % current.items.length;
            paint();
            return true;
          }
          if (event.key === 'ArrowUp') {
            selected = (selected - 1 + current.items.length) % current.items.length;
            paint();
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = current.items[selected];
            if (item) current.command(item);
            return true;
          }
          if (event.key === 'Escape') {
            el?.remove();
            el = null;
            return true;
          }
          return false;
        },
        onExit: () => {
          el?.remove();
          el = null;
          current = null;
        },
      };
    },
  };
}

export function buildMentionExtension(search: MentionSearch) {
  return Mention.extend({
    parseHTML() {
      return [{ tag: 'mention-user' }];
    },
    renderHTML({ node }) {
      const id = String(node.attrs.id ?? '');
      return ['mention-user', { 'data-id': id }, `@${node.attrs.label ?? id}`];
    },
  }).configure({
    suggestion: {
      ...buildSuggestion(search),
      command: ({ editor, range, props }) => {
        // Suggestion items are MentionCandidates (typed as node attrs upstream).
        const user = props as unknown as MentionCandidate;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'mention',
              attrs: { id: user.username, label: user.username },
            },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
    },
  });
}
