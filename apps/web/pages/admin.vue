<script setup lang="ts">
/** Admin-only runtime toggle for the donation feature. The token is never stored —
 * it's sent per request as x-admin-token and checked against ADMIN_TOKEN on the API. */
const { donationsEnabled, refresh } = useSiteConfig();
const base = useRuntimeConfig().public.apiBase;

const token = ref('');
const busy = ref(false);
const msg = ref('');
const ok = ref(false);

onMounted(refresh);

async function setEnabled(enabled: boolean): Promise<void> {
  busy.value = true;
  msg.value = '';
  try {
    const res = await $fetch<{ donationsEnabled: boolean }>(`${base}/config/donations`, {
      method: 'POST',
      headers: { 'x-admin-token': token.value },
      body: { enabled },
    });
    donationsEnabled.value = res.donationsEnabled;
    ok.value = true;
    msg.value = `Donations are now ${res.donationsEnabled ? 'ENABLED' : 'DISABLED'}.`;
  } catch (e: unknown) {
    ok.value = false;
    const err = e as { data?: { message?: string }; message?: string };
    msg.value = err?.data?.message ?? err?.message ?? 'Request failed — check the token.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="admin">
    <h1>Admin · Donations</h1>
    <p class="status">
      Current status:
      <b :class="donationsEnabled ? 'on' : 'off'">{{ donationsEnabled ? 'ENABLED' : 'DISABLED' }}</b>
    </p>
    <label class="fld">
      Admin token
      <input v-model="token" type="password" placeholder="ADMIN_TOKEN" autocomplete="off" />
    </label>
    <div class="row">
      <button class="on" :disabled="busy || !token" @click="setEnabled(true)">Enable</button>
      <button class="off" :disabled="busy || !token" @click="setEnabled(false)">Disable</button>
    </div>
    <p v-if="msg" class="msg" :class="{ good: ok, bad: !ok }">{{ msg }}</p>
  </div>
</template>

<style scoped>
.admin { max-width: 420px; margin: 8vh auto; padding: 28px; font-family: system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 16px; }
.status { font-size: 14px; color: #444; }
.status .on { color: #159bb5; }
.status .off { color: #c0392b; }
.fld { display: block; margin: 20px 0 8px; font-size: 14px; color: #444; }
input { width: 100%; margin-top: 6px; padding: 9px 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px; }
.row { display: flex; gap: 12px; margin-top: 14px; }
button { flex: 1; padding: 11px; border: 0; border-radius: 8px; font-weight: 600; color: #fff; cursor: pointer; }
button.on { background: #159bb5; }
button.off { background: #c0392b; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
.msg { margin-top: 16px; font-size: 14px; }
.msg.good { color: #159bb5; }
.msg.bad { color: #c0392b; }
</style>
