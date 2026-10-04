import { describe, expect, it } from 'vitest';
import { onboardingReducer, type OnboardingState } from './onboarding-state';

const initial: OnboardingState = {
  step: 'profile',
  profile: { name: '', nickname: '', city: null, bio: '' },
  avatar: { url: null },
  car: { brand: '', model: '', year: '', plate: '' },
  vehicleId: null,
  carSkipped: false,
  privacy: { privacyMode: 'community', receiveSos: true, consent: false },
};

const profile = { name: 'Aidana', nickname: 'aidana', city: 'Almaty' as const, bio: '' };
const car = { brand: 'Toyota', model: 'Camry', year: '2018', plate: '' };

describe('onboardingReducer', () => {
  it('walks profile → car → privacy and keeps every draft', () => {
    let state = onboardingReducer(initial, { type: 'profileSaved', profile, avatar: { url: 'https://x/a.webp' } });
    expect(state.step).toBe('car');
    state = onboardingReducer(state, { type: 'carSaved', car, vehicleId: 'v1' });
    expect(state).toMatchObject({ step: 'privacy', car, vehicleId: 'v1', profile, avatar: { url: 'https://x/a.webp' } });
  });

  it('back keeps unsaved input from the current step', () => {
    const atCar = onboardingReducer(initial, { type: 'profileSaved', profile, avatar: { url: null } });
    const draft = { ...car, model: 'Corolla' };
    const back = onboardingReducer(atCar, { type: 'back', draft: { car: draft } });
    expect(back.step).toBe('profile');
    expect(back.car).toEqual(draft);
    expect(back.profile).toEqual(profile);
  });

  it('back on the first step is a no-op', () => {
    expect(onboardingReducer(initial, { type: 'back' })).toBe(initial);
  });

  it('skipping the car moves on and remembers the skip, saving it later clears the flag', () => {
    const atCar = onboardingReducer(initial, { type: 'profileSaved', profile, avatar: { url: null } });
    const skipped = onboardingReducer(atCar, { type: 'carSkipped', car: initial.car });
    expect(skipped).toMatchObject({ step: 'privacy', carSkipped: true });
    const backAgain = onboardingReducer(skipped, { type: 'back' });
    expect(onboardingReducer(backAgain, { type: 'carSaved', car, vehicleId: 'v2' })).toMatchObject({ carSkipped: false, vehicleId: 'v2' });
  });

  it('privacy changes merge and survive going back and forth', () => {
    let state = onboardingReducer({ ...initial, step: 'privacy' }, { type: 'privacyChanged', privacy: { privacyMode: 'friends' } });
    state = onboardingReducer(state, { type: 'privacyChanged', privacy: { consent: true } });
    state = onboardingReducer(state, { type: 'back' });
    expect(state.step).toBe('car');
    expect(state.privacy).toEqual({ privacyMode: 'friends', receiveSos: true, consent: true });
  });
});
