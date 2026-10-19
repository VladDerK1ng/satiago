import { create } from 'zustand';
import type { MatchedItem } from '../domain/ai';

/** One reviewable AI item. `alt` holds the AI's own estimate when the item matched a database food. */
export interface DraftItem extends MatchedItem {
  alt?: MatchedItem;
}

/** An AI meal result waiting for the user's review (AD-8: nothing is logged until they confirm). */
export interface AiDraft {
  date: string;
  minute: number;
  source: 'describe' | 'snap';
  items: DraftItem[];
  note?: string | null;
}

interface AiDraftState {
  draft?: AiDraft;
  /** Photo picked from the Food Log speed dial, handed to Add Food for analysis. */
  pendingPhoto?: Blob;
  setDraft: (d: AiDraft) => void;
  updateItem: (id: string, patch: Partial<DraftItem>) => void;
  replaceItem: (id: string, item: DraftItem) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  setPendingPhoto: (b: Blob | undefined) => void;
  /** Returns the pending photo once and clears it. */
  takePendingPhoto: () => Blob | undefined;
}

/** Non-persisted store that carries AI drafts from Add Food to the review screen. */
export const useAiDraft = create<AiDraftState>((set, get) => ({
  setDraft: (draft) => set({ draft }),
  updateItem: (id, patch) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } });
  },
  replaceItem: (id, item) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, items: d.items.map((i) => (i.id === id ? item : i)) } });
  },
  removeItem: (id) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, items: d.items.filter((i) => i.id !== id) } });
  },
  clear: () => set({ draft: undefined }),
  setPendingPhoto: (pendingPhoto) => set({ pendingPhoto }),
  takePendingPhoto: () => {
    const p = get().pendingPhoto;
    if (p) set({ pendingPhoto: undefined });
    return p;
  },
}));
