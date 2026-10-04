import type { PrivacyMode } from '@autoc/shared';
import type { AvatarValue } from '@/features/profile/avatar-picker';
import type { ProfileFormInput } from '@/features/profile/profile-form';
import type { VehicleFormInput } from '@/features/profile/vehicle-form';

export const ONBOARDING_STEPS = ['profile', 'car', 'privacy'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Drafts of every step live here so Back/Next never lose input. `vehicleId` is the vehicle created
 * in step 2, so going back and changing it updates that vehicle instead of adding another.
 */
export type OnboardingState = {
  step: OnboardingStep;
  profile: ProfileFormInput;
  avatar: AvatarValue;
  car: VehicleFormInput;
  vehicleId: string | null;
  carSkipped: boolean;
  privacy: { privacyMode: PrivacyMode; receiveSos: boolean; consent: boolean };
};

export type OnboardingAction =
  | { type: 'profileSaved'; profile: ProfileFormInput; avatar: AvatarValue }
  | { type: 'carSaved'; car: VehicleFormInput; vehicleId: string }
  | { type: 'carSkipped'; car: VehicleFormInput }
  | { type: 'back'; draft?: Partial<Pick<OnboardingState, 'car' | 'profile'>> }
  | { type: 'privacyChanged'; privacy: Partial<OnboardingState['privacy']> };

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'profileSaved':
      return { ...state, profile: action.profile, avatar: action.avatar, step: 'car' };
    case 'carSaved':
      return { ...state, car: action.car, vehicleId: action.vehicleId, carSkipped: false, step: 'privacy' };
    case 'carSkipped':
      return { ...state, car: action.car, carSkipped: true, step: 'privacy' };
    case 'back': {
      const index = stepIndex(state.step);
      if (index === 0) return state;
      return { ...state, ...action.draft, step: ONBOARDING_STEPS[index - 1] ?? 'profile' };
    }
    case 'privacyChanged':
      return { ...state, privacy: { ...state.privacy, ...action.privacy } };
    default:
      return state;
  }
}
