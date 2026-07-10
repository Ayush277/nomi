import { DEFAULT_PROFILE, getProfile, saveProfile, type PersonalityId } from '../../lib/profile';

let personality: PersonalityId = 'friend';

const personas = document.getElementById('personas');
personas?.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('button[data-p]');
  if (!btn) return;
  personality = btn.dataset.p as PersonalityId;
  personas.querySelectorAll('.p').forEach((b) => b.classList.toggle('on', b === btn));
});

document.getElementById('go')?.addEventListener('click', async () => {
  const name = (document.getElementById('name') as HTMLInputElement)?.value.trim().slice(0, 24) ?? '';
  const existing = await getProfile().catch(() => DEFAULT_PROFILE);
  await saveProfile({ ...existing, name, personality, onboarded: true }).catch(() => {});
  window.close();
});
