import { OPPORTUNITIES } from '@/data/opportunities';
import type { Opportunity } from '@/data/types';
import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';

/**
 * 进程内状态中枢（纯 mock，无持久化、无网络）：
 *   savedIds     —— 收藏的机会（最近在前）
 *   dismissedIds —— 在「探索」滑走的机会（不再进卡组）
 * 概念体验产品，刷新即重置——保持演示干净。
 */
interface StoreState {
  savedIds: string[];
  dismissedIds: string[];
}

type Action =
  | { type: 'toggleSave'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'restoreDeck' }
  | { type: 'reset' };

// 预置两条收藏，首开「收藏」页即有内容
const INITIAL: StoreState = {
  savedIds: ['op-indie-distribution', 'op-env-secrets'],
  dismissedIds: [],
};

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.type) {
    case 'toggleSave': {
      const has = state.savedIds.includes(action.id);

      return {
        ...state,
        savedIds: has
          ? state.savedIds.filter((x) => x !== action.id)
          : [action.id, ...state.savedIds],
      };
    }

    case 'dismiss': {
      if (state.dismissedIds.includes(action.id)) {
        return state;
      }

      return { ...state, dismissedIds: [...state.dismissedIds, action.id] };
    }

    case 'restoreDeck':
      return { ...state, dismissedIds: [] };
    case 'reset':
      return INITIAL;
    default:
      return state;
  }
}

interface StoreValue extends StoreState {
  toggleSave: (id: string) => void;
  dismiss: (id: string) => void;
  restoreDeck: () => void;
  reset: () => void;
  isSaved: (id: string) => boolean;
  savedOpportunities: Opportunity[];
  /** 探索卡组：未滑走的机会，按机会分降序。 */
  deck: Opportunity[];
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const value = useMemo<StoreValue>(() => {
    const byId = new Map(OPPORTUNITIES.map((o) => [o.id, o] as const));

    return {
      ...state,
      toggleSave: (id) => dispatch({ type: 'toggleSave', id }),
      dismiss: (id) => dispatch({ type: 'dismiss', id }),
      restoreDeck: () => dispatch({ type: 'restoreDeck' }),
      reset: () => dispatch({ type: 'reset' }),
      isSaved: (id) => state.savedIds.includes(id),
      savedOpportunities: state.savedIds
        .map((id) => byId.get(id))
        .filter((o): o is Opportunity => Boolean(o)),
      deck: OPPORTUNITIES.filter((o) => !state.dismissedIds.includes(o.id)).sort(
        (a, b) => b.score - a.score,
      ),
    };
  }, [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error('useStore 必须在 <StoreProvider> 内使用');
  }

  return ctx;
}
