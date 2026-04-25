<template>
  <section id="contact" class="bg-ivory-50" style="padding: 48px 0 96px;">
    <div ref="root" class="container mx-auto">

      <div class="contact-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:48px; align-items:start;">

        <!-- Stylized map -->
        <div class="relative aspect-square rounded-sm overflow-hidden bg-ink-100">
          <svg viewBox="0 0 400 400" class="w-full h-full" aria-hidden="true">
            <!-- Grid lines -->
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(15,59,61,0.06)" stroke-width="1"/>
              </pattern>
              <linearGradient id="mapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#eef6f4;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#dcedeb;stop-opacity:1" />
              </linearGradient>
            </defs>
            <rect width="400" height="400" fill="url(#mapGrad)"/>
            <rect width="400" height="400" fill="url(#grid)"/>

            <!-- Nile river -->
            <path d="M160 0 C170 80, 200 120, 190 200 C180 280, 210 340, 200 400" fill="none" stroke="rgba(29,106,102,0.2)" stroke-width="24" stroke-linecap="round"/>
            <path d="M160 0 C170 80, 200 120, 190 200 C180 280, 210 340, 200 400" fill="none" stroke="rgba(29,106,102,0.12)" stroke-width="40" stroke-linecap="round"/>

            <!-- Roads -->
            <line x1="0" y1="200" x2="400" y2="200" stroke="rgba(15,59,61,0.08)" stroke-width="3"/>
            <line x1="200" y1="0" x2="200" y2="400" stroke="rgba(15,59,61,0.08)" stroke-width="3"/>

            <!-- Hospital pin -->
            <circle cx="250" cy="220" r="28" fill="rgba(29,106,102,0.15)" stroke="#1d6a66" stroke-width="2"/>
            <circle cx="250" cy="220" r="6" fill="#1d6a66"/>
            <!-- Cross -->
            <rect x="247" y="210" width="6" height="20" rx="1" fill="#1d6a66" opacity="0.7"/>
            <rect x="240" y="217" width="20" height="6" rx="1" fill="#1d6a66" opacity="0.7"/>

            <!-- Label -->
            <text x="250" y="260" text-anchor="middle" font-size="10" fill="#1d6a66" font-family="monospace">DUMYAT PUBLIC HOSPITAL</text>
          </svg>
          <!-- Mono label -->
          <div class="absolute bottom-4 start-4 font-mono text-ink-300 text-[10px] tracking-wide">[ MAP &middot; stylized &middot; 1:1 ]</div>
        </div>

        <!-- Contact info panel -->
        <div class="space-y-0" :dir="lang === 'ar' ? 'rtl' : 'ltr'">
          <!-- Address -->
          <div class="contact-row flex items-start gap-6 py-5 border-b border-ink-200">
            <div class="font-mono text-[11px] uppercase text-ink-400 tracking-wider min-w-[90px] pt-0.5">{{ strings.contact.addressLabel }}</div>
            <div class="font-display-ar text-navy-900 text-[15px] leading-relaxed">{{ strings.contact.details.address }}</div>
          </div>

          <!-- Phone -->
          <div class="contact-row flex items-start gap-6 py-5 border-b border-ink-200">
            <div class="font-mono text-[11px] uppercase text-ink-400 tracking-wider min-w-[90px] pt-0.5">{{ strings.contact.phoneLabel }}</div>
            <a class="font-display-ar text-navy-900 text-[15px] hover:text-teal-700 transition-colors" :href="phoneLink">{{ strings.contact.details.phone }}</a>
          </div>

          <!-- Emergency -->
          <div class="contact-row flex items-start gap-6 py-5 border-b border-ink-200">
            <div class="font-mono text-[11px] uppercase text-ink-400 tracking-wider min-w-[90px] pt-0.5">{{ strings.contact.emergencyLabel }}</div>
            <div class="flex items-center gap-3">
              <span class="emergency-pill">
                <span class="dot"></span>
                {{ strings.contact.details.emergencyNumber }}
              </span>
            </div>
          </div>

          <!-- WhatsApp -->
          <div class="contact-row flex items-start gap-6 py-5 border-b border-ink-200">
            <div class="font-mono text-[11px] uppercase text-ink-400 tracking-wider min-w-[90px] pt-0.5">{{ strings.contact.whatsappLabel }}</div>
            <a class="font-display-ar text-navy-900 text-[15px] hover:text-teal-700 transition-colors" :href="whatsAppLink" target="_blank" rel="noopener">{{ strings.contact.details.whatsapp }}</a>
          </div>

          <!-- Email -->
          <div class="contact-row flex items-start gap-6 py-5 border-b border-ink-200">
            <div class="font-mono text-[11px] uppercase text-ink-400 tracking-wider min-w-[90px] pt-0.5">{{ strings.contact.emailLabel }}</div>
            <a class="font-display-ar text-navy-900 text-[15px] hover:text-teal-700 transition-colors" :href="emailLink">{{ strings.contact.details.email }}</a>
          </div>

          <!-- Hours -->
          <div class="py-5">
            <div class="font-mono text-[11px] uppercase text-ink-400 tracking-wider mb-4">{{ strings.contact.hoursLabel }}</div>
            <div class="space-y-2">
              <div v-for="(row, idx) in strings.contact.details.hours" :key="idx" class="flex items-center justify-between">
                <span class="text-[15px] text-ink-500">{{ row.day }}</span>
                <span class="font-mono text-sm text-navy-900">{{ row.time }}</span>
              </div>
            </div>
          </div>

          <!-- Form toggle -->
          <div class="pt-4">
            <button
              @click="showForm = !showForm"
              class="btn btn-teal w-full justify-center"
            >
              {{ showForm ? (isAr ? 'إغلاق النموذج' : 'Close Form') : strings.contact.formTitle }}
            </button>
          </div>

          <!-- Contact form (collapsible) -->
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="max-h-0 opacity-0"
            enter-to-class="max-h-[500px] opacity-100"
            leave-active-class="transition-all duration-200 ease-in"
            leave-from-class="max-h-[500px] opacity-100"
            leave-to-class="max-h-0 opacity-0"
          >
            <form v-if="showForm" class="space-y-4 pt-6 overflow-hidden" @submit.prevent="submit" novalidate>
              <!-- Name field -->
              <div>
                <input
                  v-model="name"
                  type="text"
                  autocomplete="name"
                  :placeholder="strings.contact.formName"
                  :aria-label="strings.contact.formName"
                  :class="[
                    'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-teal-700/30',
                    errors.name ? 'border-coral bg-coral/10' : 'border-ink-200 bg-white focus:border-teal-700'
                  ]"
                  @blur="validateField('name')"
                />
                <p v-if="errors.name" class="mt-1 text-xs text-coral">{{ errors.name }}</p>
              </div>

              <!-- Phone field -->
              <div>
                <input
                  v-model="phone"
                  type="tel"
                  autocomplete="tel"
                  :placeholder="strings.contact.formPhone"
                  :aria-label="strings.contact.formPhone"
                  :class="[
                    'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-teal-700/30',
                    errors.phone ? 'border-coral bg-coral/10' : 'border-ink-200 bg-white focus:border-teal-700'
                  ]"
                  @blur="validateField('phone')"
                />
                <p v-if="errors.phone" class="mt-1 text-xs text-coral">{{ errors.phone }}</p>
              </div>

              <!-- Message field -->
              <div>
                <textarea
                  v-model="message"
                  :placeholder="strings.contact.formMessage"
                  :aria-label="strings.contact.formMessage"
                  :class="[
                    'h-28 w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-teal-700/30',
                    errors.message ? 'border-coral bg-coral/10' : 'border-ink-200 bg-white focus:border-teal-700'
                  ]"
                  @blur="validateField('message')"
                ></textarea>
                <p v-if="errors.message" class="mt-1 text-xs text-coral">{{ errors.message }}</p>
              </div>

              <button
                type="submit"
                :disabled="loading"
                class="btn btn-primary w-full justify-center"
              >
                <svg v-if="loading" class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {{ strings.contact.formSubmit }}
              </button>
            </form>
          </Transition>
        </div>
      </div>
    </div>

    <!-- WhatsApp FAB -->
    <a
      class="fixed bottom-6 end-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-deep transition-transform hover:scale-110"
      :href="whatsAppLink"
      target="_blank"
      rel="noopener"
      :aria-label="strings.contact.whatsappLabel"
    >
      <svg viewBox="0 0 24 24" class="h-7 w-7" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.559 4.135 1.535 5.872L.057 23.285a.75.75 0 00.921.921l5.413-1.478A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.886 0-3.65-.496-5.178-1.362l-.372-.215-3.855 1.051 1.051-3.855-.215-.372A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
      </svg>
    </a>

    <!-- Toast notification -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="translate-y-4 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div
        v-if="toast.show"
        :class="[
          'fixed bottom-24 start-1/2 z-50 -translate-x-1/2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-deep',
          toast.type === 'success' ? 'bg-green-600' : 'bg-coral'
        ]"
        role="alert"
        aria-live="polite"
      >
        {{ toast.message }}
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useMotion } from "@vueuse/motion";

const props = defineProps<{ strings: any; lang: "ar" | "en" }>();

const isAr = computed(() => props.lang === "ar");
const showForm = ref(false);
const name = ref("");
const phone = ref("");
const message = ref("");
const loading = ref(false);
const root = ref<HTMLElement | null>(null);

const errors = reactive({ name: "", phone: "", message: "" });
const toast = reactive({ show: false, type: "success" as "success" | "error", message: "" });

const whatsAppNumber = props.strings.contact.details.whatsapp.replace(/\D/g, "");
const whatsAppLink = `https://wa.me/${whatsAppNumber}`;
const phoneLink = `tel:${props.strings.contact.details.phone.replace(/\s/g, "")}`;
const emailLink = `mailto:${props.strings.contact.details.email}`;

const phoneRegex = /^(\+20|0020|0)?1[0125]\d{8}$|^\+?[\d\s\-()]{7,15}$/;

function validateField(field: "name" | "phone" | "message") {
  if (field === "name") {
    errors.name = name.value.trim().length < 2
      ? (isAr.value ? "الرجاء إدخال الاسم الكامل" : "Please enter your full name")
      : "";
  }
  if (field === "phone") {
    const cleaned = phone.value.replace(/\s/g, "");
    errors.phone = !phoneRegex.test(cleaned)
      ? (isAr.value ? "رقم الهاتف غير صحيح" : "Please enter a valid phone number")
      : "";
  }
  if (field === "message") {
    errors.message = message.value.trim().length < 10
      ? (isAr.value ? "الرجاء كتابة رسالة لا تقل عن 10 أحرف" : "Message must be at least 10 characters")
      : "";
  }
}

function validateAll(): boolean {
  validateField("name");
  validateField("phone");
  validateField("message");
  return !errors.name && !errors.phone && !errors.message;
}

function showToast(type: "success" | "error", msg: string) {
  toast.type = type;
  toast.message = msg;
  toast.show = true;
  setTimeout(() => { toast.show = false; }, 4000);
}

const submit = async () => {
  if (!validateAll()) {
    showToast("error", isAr.value ? "يرجى تصحيح الأخطاء قبل الإرسال" : "Please fix the errors before submitting");
    return;
  }
  loading.value = true;
  try {
    const res = await fetch("https://formspree.io/f/xzdknnrw", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: name.value,
        phone: phone.value,
        message: message.value,
      }),
    });
    if (res.ok) {
      name.value = "";
      phone.value = "";
      message.value = "";
      showToast("success", isAr.value ? "تم إرسال رسالتك بنجاح!" : "Message sent successfully!");
    } else {
      showToast("error", isAr.value ? "حدث خطأ، حاول مرة أخرى" : "Something went wrong, please try again");
    }
  } catch {
    showToast("error", isAr.value ? "خطأ في الاتصال، تأكد من الإنترنت" : "Connection error, please check your internet");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (root.value) {
    useMotion(root, {
      initial: { opacity: 0, y: 40 },
      enter: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" } },
    });
  }
});
</script>

<style scoped>
@media (max-width: 900px) {
  .contact-grid {
    grid-template-columns: 1fr !important;
    gap: 32px !important;
  }
  .contact-row {
    gap: 16px !important;
  }
  .contact-row > div:first-child {
    min-width: 70px !important;
  }
}
</style>
