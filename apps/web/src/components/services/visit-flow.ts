import { SERVICE_LIMITS, type MyVisit, type VisitDto, type VisitMethod } from '@autoc/shared';

/* ---------- what the details page offers, from the viewer's latest visit ---------- */

export type VisitStage = 'none' | 'pending' | 'canReview' | 'reviewed' | 'rejected';

export type VisitOffer = {
  stage: VisitStage;
  /** A new visit is allowed (no pending/verified visit in the last 24 h — API rule VISIT_EXISTS). */
  canVisit: boolean;
};

export function visitOffer(myVisit: MyVisit | null, now: Date): VisitOffer {
  if (!myVisit) return { stage: 'none', canVisit: true };
  const ageMs = now.getTime() - new Date(myVisit.createdAt).getTime();
  const outsideWindow = ageMs > SERVICE_LIMITS.visitWindowHours * 3_600_000;
  if (myVisit.status === 'rejected') return { stage: 'rejected', canVisit: true };
  if (myVisit.status === 'pending') return { stage: 'pending', canVisit: outsideWindow };
  if (!myVisit.reviewed) return { stage: 'canReview', canVisit: false };
  return { stage: 'reviewed', canVisit: outsideWindow };
}

/* ---------- the "I visited" sheet ---------- */

export type VisitFlowState =
  | { step: 'closed' }
  | { step: 'choose' }
  | { step: VisitMethod; phase: 'idle' | 'working' | 'error'; error: unknown; code: string }
  | { step: 'done'; visit: VisitDto };

export type VisitFlowAction =
  | { type: 'open'; method?: VisitMethod; code?: string }
  | { type: 'choose'; method: VisitMethod }
  | { type: 'back' }
  | { type: 'start' }
  | { type: 'fail'; error: unknown }
  | { type: 'succeed'; visit: VisitDto }
  | { type: 'close' };

export const initialVisitFlow: VisitFlowState = { step: 'closed' };

const method = (m: VisitMethod, code = ''): VisitFlowState => ({ step: m, phase: 'idle', error: null, code });

export function visitFlowReducer(state: VisitFlowState, action: VisitFlowAction): VisitFlowState {
  switch (action.type) {
    case 'open':
      return action.method ? method(action.method, action.code) : { step: 'choose' };
    case 'choose':
      return state.step === 'choose' ? method(action.method) : state;
    case 'back':
      // Can't leave while a request is in flight.
      if (state.step === 'geo' || state.step === 'qr' || state.step === 'photo') {
        return state.phase === 'working' ? state : { step: 'choose' };
      }
      return state;
    case 'start':
      if (state.step === 'geo' || state.step === 'qr' || state.step === 'photo') return { ...state, phase: 'working', error: null };
      return state;
    case 'fail':
      if (state.step === 'geo' || state.step === 'qr' || state.step === 'photo') return { ...state, phase: 'error', error: action.error };
      return state;
    case 'succeed':
      return state.step === 'closed' ? state : { step: 'done', visit: action.visit };
    case 'close':
      if ((state.step === 'geo' || state.step === 'qr' || state.step === 'photo') && state.phase === 'working') return state;
      return { step: 'closed' };
    default:
      return state;
  }
}

export const isFlowOpen = (s: VisitFlowState) => s.step !== 'closed' && s.step !== 'done';
