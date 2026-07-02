/** Keep the /donate page unreachable when the donation feature is switched off. */
export default defineNuxtRouteMiddleware(() => {
  const donationsEnabled = useState<boolean>('donationsEnabled', () => true);
  if (!donationsEnabled.value) return navigateTo('/');
});
