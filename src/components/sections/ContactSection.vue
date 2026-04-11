<template>
  <section id="contact" class="bg-background py-20">
    <div ref="root" class="container mx-auto">
      <h2 class="section-title">{{ strings.contact.title }}</h2>
      <p class="mt-4 max-w-2xl text-sm text-muted">{{ strings.contact.subtitle }}</p>

      <div class="mt-10 grid gap-8 lg:grid-cols-2">
        <!-- Map -->
        <div class="overflow-hidden rounded-2xl shadow-soft">
          <iframe
            class="h-96 w-full"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            src="https://maps.google.com/maps?q=Kasr%20Al%20Ainy%20Hospital%20Cairo&t=&z=13&ie=UTF8&iwloc=&output=embed"
            :title="strings.contact.mapTitle"
          ></iframe>
        </div>

        <!-- Info + form -->
        <div class="space-y-6 rounded-2xl bg-surface p-8 shadow-soft" :dir="lang === 'ar' ? 'rtl' : 'ltr'">

          <!-- Contact details -->
          <div class="grid gap-3 text-sm text-muted">
            <p><strong class="text-text">{{ strings.contact.addressLabel }}:</strong> {{ strings.contact.details.address }}</p>
            <p>
              <strong class="text-text">{{ strings.contact.phoneLabel }}:</strong>
              <a class="text-secondary hover:underline" :href="phoneLink">{{ strings.contact.details.phone }}</a>
            </p>
            <p>
              <strong class="text-text">{{ strings.contact.emergencyLabel }}:</strong>
              <span class="ms-2 inline-flex rounded-full bg-red-600/10 px-3 py-1 text-xs font-semibold text-red-700">
                {{ strings.contact.details.emergencyNumber }}
              </span>
            </p>
            <p>
              <strong class="text-text">{{ strings.contact.whatsappLabel }}:</strong>
              <a class="text-green-600 hover:underline" :href="whatsAppLink" target="_blank" rel="noopener">{{ strings.contact.details.whatsapp }}</a>
            </p>
            <p>
              <strong class="text-text">{{ strings.contact.emailLabel }}:</strong>
              <a class="text-secondary hover:underline" :href="emailLink">{{ strings.contact.details.email }}</a>
            </p>
          </div>

          <!-- Hours -->
          <div>
            <p class="text-sm font-semibold text-text">{{ strings.contact.hoursLabel }}</p>
            <table class="mt-2 w-full text-sm text-muted">
              <tbody>
                <tr v-for="(row, idx) in strings.contact.details.hours" :key="idx" class="border-b border-gray-100 last:border-0">
                  <td class="py-1.5">{{ row.day }}</td>
                  <td class="py-1.5 text-end font-medium text-text">{{ row.time }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Form -->
          <form class="space-y-4" @submit.prevent="submit" novalidate>
            <h3 class="text-lg font-semibold text-text">{{ strings.contact.formTitle }}</h3>

            <!-- Name field -->
            <div>
              <input
                v-model="name"
                type="text"
                autocomplete="name"
                :placeholder="strings.contact.formName"
                :aria-label="strings.contact.formName"
                :class="[
                  'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/30',
                  errors.name ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white focus:border-primary'
                ]"
                @blur="validateField('name')"
              />
              <p v-if="errors.name" class="mt-1 text-xs text-red-600">{{ errors.name }}</p>
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
                  'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/30',
                  errors.phone ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white focus:border-primary'
                ]"
                @blur="validateField('phone')"
              />
              <p v-if="errors.phone" class="mt-1 text-xs text-red-600">{{ errors.phone }}</p>
            </div>

            <!-- Message field -->
            <div>
              <textarea
                v-model="message"
                :placeholder="strings.contact.formMessage"
                :aria-label="strings.contact.formMessage"
                :class="[
                  'h-28 w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/30',
                  errors.message ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white focus:border-primary'
                ]"
                @blur="validateField('message')"
              ></textarea>
              <p v-if="errors.message" class="mt-1 text-xs text-red-600">{{ errors.message }}</p>
            </div>

            <button
              type="submit"
              :disabled="loading"
              class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-soft transition-opacity disabled:opacity-60"
            >
              <svg v-if="loading" class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {{ strings.contact.formSubmit }}
            </button>
          </form>
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
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
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
import { onMounted, reactive, ref } from "vue";
import { useMotion } from "@vueuse/motion";

const props = defineProps<{ strings: any; lang: "ar" | "en" }>();

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

const isAr = props.lang === "ar";

const phoneRegex = /^(\+20|0020|0)?1[0125]\d{8}$|^\+?[\d\s\-()]{7,15}$/;

function validateField(field: "name" | "phone" | "message") {
  if (field === "name") {
    errors.name = name.value.trim().length < 2
      ? (isAr ? "الرجاء إدخال الاسم الكامل" : "Please enter your full name")
      : "";
  }
  if (field === "phone") {
    const cleaned = phone.value.replace(/\s/g, "");
    errors.phone = !phoneRegex.test(cleaned)
      ? (isAr ? "رقم الهاتف غير صحيح" : "Please enter a valid phone number")
      : "";
  }
  if (field === "message") {
    errors.message = message.value.trim().length < 10
      ? (isAr ? "الرجاء كتابة رسالة لا تقل عن 10 أحرف" : "Message must be at least 10 characters")
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

const submit = () => {
  if (!validateAll()) {
    showToast("error", isAr ? "يرجى تصحيح الأخطاء قبل الإرسال" : "Please fix the errors before submitting");
    return;
  }
  loading.value = true;
  const labels = props.strings.contact.whatsappMessage;
  const text = encodeURIComponent(
    `${labels.nameLabel}: ${name.value}\n${labels.phoneLabel}: ${phone.value}\n${labels.messageLabel}: ${message.value}`
  );
  setTimeout(() => {
    window.open(`${whatsAppLink}?text=${text}`, "_blank", "noopener");
    loading.value = false;
    name.value = "";
    phone.value = "";
    message.value = "";
    showToast("success", isAr ? "تم فتح واتساب. شكراً لتواصلك معنا!" : "WhatsApp opened. Thank you for reaching out!");
  }, 400);
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
