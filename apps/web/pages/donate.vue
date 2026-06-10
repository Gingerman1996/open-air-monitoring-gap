<script setup lang="ts">
const { lang, setLang, t } = useLang();
const route = useRoute();

const country = computed(() => {
  const c = route.query.country;
  return typeof c === 'string' && c.trim() ? c.trim() : '';
});
const asNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const need = computed(() => asNum(route.query.need));
const cost = computed(() => asNum(route.query.cost));

const MONITOR_PRICE = 250; // avg low-cost sensor, mirrors the dashboard maths
const TIERS = [25, 250, 2500];
const amount = ref<number>(250);
const custom = ref('');
const donated = ref(false);

const chosen = computed(() => {
  const c = asNum(custom.value);
  return c ?? amount.value;
});
const monitorsFunded = computed(() => chosen.value / MONITOR_PRICE);
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString();
const fmtMonitors = (n: number) =>
  n >= 1 ? `${Math.floor(n).toLocaleString()} ${t('monitor(s)', 'เครื่อง')}` : `${Math.round(n * 100)}% ${t('of a monitor', 'ของหนึ่งเครื่อง')}`;

const pick = (v: number) => { amount.value = v; custom.value = ''; };
const donate = () => { donated.value = true; };

onMounted(() => {
  const saved = localStorage.getItem('demo-lang');
  if (saved === 'th' || saved === 'en') setLang(saved);
});

useHead({ title: 'Donate — Open Air Monitoring Gap' });
</script>

<template>
  <div class="donate-page">
    <header class="dn-hdr">
      <NuxtLink to="/" class="dn-back">← {{ t('Back to map', 'กลับไปที่แผนที่') }}</NuxtLink>
      <img class="dn-logo" src="/logo-colored.png" alt="Open Air Foundation" />
      <div class="dn-lang">
        <button :class="{ active: lang === 'en' }" @click="setLang('en')">EN</button>
        <button :class="{ active: lang === 'th' }" @click="setLang('th')">ไทย</button>
      </div>
    </header>

    <main class="dn-main">
      <div class="dn-card" v-if="!donated">
        <div class="dn-demo">{{ t('Sample page — no real payment is processed', 'หน้าตัวอย่าง — ไม่มีการชำระเงินจริง') }}</div>
        <h1 class="dn-title">
          {{ country
            ? t(`Close the monitoring gap in ${country}`, `ปิดช่องว่างการตรวจวัดใน${country}`)
            : t('Close the air monitoring gap', 'ปิดช่องว่างการตรวจวัดคุณภาพอากาศ') }}
        </h1>
        <p class="dn-sub">
          {{ t('Every low-cost sensor puts real air-quality data where today there is none — so the people breathing the most polluted air can finally see it.',
               'เซนเซอร์ราคาประหยัดทุกเครื่องนำข้อมูลคุณภาพอากาศจริงไปยังพื้นที่ที่วันนี้ยังไม่มีข้อมูล — เพื่อให้คนที่หายใจอากาศที่แย่ที่สุดได้มองเห็นมัน') }}
        </p>

        <div class="dn-facts" v-if="need || cost">
          <div class="dn-fact" v-if="need">
            <b>+{{ need.toLocaleString() }}</b>
            <span>{{ t('monitors needed to reach the good zone (Lv 1)', 'เครื่องที่ต้องเพิ่มเพื่อเข้าโซนที่ดี (Lv 1)') }}</span>
          </div>
          <div class="dn-fact" v-if="cost">
            <b>{{ fmtMoney(cost) }}</b>
            <span>{{ t('estimated total (low-cost sensors)', 'ประมาณการรวม (เซนเซอร์ราคาประหยัด)') }}</span>
          </div>
        </div>

        <div class="dn-tiers">
          <button
            v-for="v in TIERS" :key="v"
            :class="{ active: !custom && amount === v }"
            @click="pick(v)"
          >
            <b>{{ fmtMoney(v) }}</b>
            <span>{{ fmtMonitors(v / MONITOR_PRICE) }}</span>
          </button>
        </div>
        <label class="dn-custom">
          <span>{{ t('Or a custom amount (USD)', 'หรือกำหนดจำนวนเอง (USD)') }}</span>
          <input v-model="custom" type="number" min="1" :placeholder="t('e.g. 1000', 'เช่น 1000')" />
        </label>

        <div class="dn-impact">
          {{ t('Your donation funds', 'เงินบริจาคของคุณสนับสนุน') }} <b>{{ fmtMonitors(monitorsFunded) }}</b>{{ country ? ` ${t('in', 'ใน')} ${country}` : '' }}
          <span class="dn-price">({{ t('avg low-cost sensor', 'เซนเซอร์ราคาประหยัดเฉลี่ย') }} ≈ {{ fmtMoney(MONITOR_PRICE) }})</span>
        </div>

        <button class="dn-go" @click="donate">
          {{ t('Donate', 'บริจาค') }} {{ fmtMoney(chosen) }}
        </button>
      </div>

      <div class="dn-card dn-thanks" v-else>
        <div class="dn-check">✓</div>
        <h1 class="dn-title">{{ t('Thank you!', 'ขอบคุณครับ/ค่ะ!') }}</h1>
        <p class="dn-sub">
          {{ t(`Your sample donation of ${fmtMoney(chosen)} would fund ${fmtMonitors(monitorsFunded)}${country ? ' in ' + country : ''}.`,
               `เงินบริจาคตัวอย่าง ${fmtMoney(chosen)} ของคุณจะสนับสนุน ${fmtMonitors(monitorsFunded)}${country ? 'ใน' + country : ''}`) }}
        </p>
        <p class="dn-demo-note">{{ t('This is a demo — no payment was made.', 'นี่คือหน้าตัวอย่าง — ไม่มีการชำระเงินเกิดขึ้น') }}</p>
        <NuxtLink to="/" class="dn-go dn-go-link">{{ t('Back to the map', 'กลับไปที่แผนที่') }}</NuxtLink>
      </div>
    </main>
  </div>
</template>

<style scoped>
.donate-page { height: 100vh; overflow-y: auto; background: var(--paper); display: flex; flex-direction: column; }
.dn-hdr { display: flex; align-items: center; gap: 14px; padding: 0 18px; height: 64px; background: var(--card); border-bottom: 1px solid var(--line); flex: none; }
.dn-back { font-family: var(--mono); font-size: 12.5px; color: var(--muted); text-decoration: none; }
.dn-back:hover { color: var(--brand-deep); }
.dn-logo { height: 34px; margin-left: auto; }
.dn-lang { margin-left: auto; display: flex; gap: 4px; }
.dn-lang button { font-family: var(--mono); font-size: 12px; padding: 4px 9px; border: 1px solid var(--line); background: var(--card); border-radius: 6px; cursor: pointer; color: var(--muted); }
.dn-lang button.active { background: var(--brand-tint); color: var(--brand-deep); border-color: var(--brand-deep); }
.dn-main { flex: 1; display: flex; justify-content: center; padding: 40px 18px; }
.dn-card { width: 100%; max-width: 520px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); padding: 28px; height: fit-content; }
.dn-demo { display: inline-block; font-family: var(--mono); font-size: 11px; background: var(--brand-tint); color: var(--brand-deep); padding: 3px 9px; border-radius: 6px; margin-bottom: 14px; }
.dn-title { font-family: var(--display); font-size: 24px; margin: 0 0 8px; line-height: 1.25; }
.dn-sub { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 0 0 18px; }
.dn-facts { display: flex; gap: 10px; margin-bottom: 18px; }
.dn-fact { flex: 1; background: var(--paper-2); border: 1px solid var(--line-soft); border-radius: 10px; padding: 10px 12px; }
.dn-fact b { display: block; font-family: var(--display); font-size: 20px; color: var(--brand-deep); }
.dn-fact span { font-size: 11.5px; color: var(--muted); line-height: 1.4; display: block; margin-top: 2px; }
.dn-tiers { display: flex; gap: 8px; margin-bottom: 12px; }
.dn-tiers button { flex: 1; padding: 10px 6px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--card); cursor: pointer; font-family: var(--sans); }
.dn-tiers button b { display: block; font-family: var(--display); font-size: 16px; color: var(--ink); }
.dn-tiers button span { font-size: 10.5px; color: var(--muted); }
.dn-tiers button.active { border-color: var(--brand); background: var(--brand-tint); }
.dn-custom { display: block; margin-bottom: 16px; }
.dn-custom span { font-size: 12px; color: var(--muted); display: block; margin-bottom: 5px; }
.dn-custom input { width: 100%; padding: 9px 12px; border: 1.5px solid var(--line); border-radius: 10px; font-family: var(--mono); font-size: 14px; background: var(--card); color: var(--ink); }
.dn-custom input:focus { outline: none; border-color: var(--brand); }
.dn-impact { font-size: 13px; color: var(--ink-soft); background: var(--teal-tint); border-radius: 10px; padding: 10px 12px; margin-bottom: 18px; line-height: 1.5; }
.dn-impact b { color: var(--teal-deep); }
.dn-price { color: var(--muted); font-size: 11.5px; margin-left: 4px; }
.dn-go { display: block; width: 100%; padding: 13px; border: none; border-radius: 10px; background: var(--brand); color: #fff; font-family: var(--display); font-weight: 600; font-size: 16px; cursor: pointer; text-align: center; text-decoration: none; }
.dn-go:hover { background: var(--brand-deep); }
.dn-thanks { text-align: center; }
.dn-check { width: 56px; height: 56px; margin: 6px auto 14px; border-radius: 50%; background: var(--aqi-good); color: #fff; font-size: 30px; display: flex; align-items: center; justify-content: center; }
.dn-demo-note { font-family: var(--mono); font-size: 11.5px; color: var(--faint); margin: 0 0 18px; }
.dn-go-link { box-sizing: border-box; }
</style>
