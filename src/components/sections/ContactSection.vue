<template>
  <section id="contact" class="bg-background py-20">
    <div ref="root" class="container mx-auto">
      <h2 class="section-title">{{ strings.contact.title }}</h2>
      <p class="mt-4 max-w-2xl text-sm text-muted">{{ strings.contact.subtitle }}</p>

      <div class="mt-10 grid gap-8 lg:grid-cols-2">
        <div class="overflow-hidden rounded-2xl shadow-soft">
          <iframe
            class="h-96 w-full"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            src="https://maps.google.com/maps?q=Kasr%20Al%20Ainy%20Hospital%20Cairo&t=&z=13&ie=UTF8&iwloc=&output=embed"
            :title="strings.contact.mapTitle"
          ></iframe>
        </div>
        <div class="space-y-6 rounded-2xl bg-surface p-8 shadow-soft rtl:text-right">
          <div class="grid gap-3 text-sm text-muted">
            <p><strong class="text-text">{{ strings.contact.addressLabel }}:</strong> {{ strings.contact.details.address }}</p>
            <p>
              <strong class="text-text">{{ strings.contact.phoneLabel }}:</strong>
              <a class="text-secondary" :href="phoneLink">{{ strings.contact.details.phone }}</a>
            </p>
            <p>
              <strong class="text-text">{{ strings.contact.emergencyLabel }}:</strong>
              <span class="ml-2 inline-flex rounded-full bg-red-600/10 px-3 py-1 text-xs font-semibold text-red-700">{{ strings.contact.details.emergencyNumber }}</span>
            </p>
            <p><strong class="text-text">{{ strings.contact.whatsappLabel }}:</strong> <a class="text-green-600" :href="whatsAppLink" target="_blank">{{ strings.contact.details.whatsapp }}</a></p>
            <p>
              <strong class="text-text">{{ strings.contact.emailLabel }}:</strong>
              <a class="text-secondary" :href="emailLink">{{ strings.contact.details.email }}</a>
            </p>
          </div>

          <div>
            <p class="text-sm font-semibold text-text">{{ strings.contact.hoursLabel }}</p>
            <table class="mt-2 w-full text-sm text-muted">
              <tbody>
                <tr v-for="(row, idx) in strings.contact.details.hours" :key="idx">
                  <td>{{ row.day }}</td>
                  <td class="text-right">{{ row.time }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="space-y-4" @submit.prevent="submit">
            <h3 class="text-lg font-semibold text-text">{{ strings.contact.formTitle }}</h3>
            <input v-model="name" class="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm" :placeholder="strings.contact.formName" required />
            <input v-model="phone" class="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm" :placeholder="strings.contact.formPhone" required />
            <textarea v-model="message" class="h-28 w-full rounded-lg border border-gray-200 px-4 py-3 text-sm" :placeholder="strings.contact.formMessage" required></textarea>
            <button type="submit" class="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-soft">
              {{ strings.contact.formSubmit }}
            </button>
          </form>
        </div>
      </div>
    </div>

    <a
      class="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-deep"
      :href="whatsAppLink"
      target="_blank"
      :aria-label="strings.contact.whatsappLabel"
    >
      {{ strings.contact.whatsappFab }}
    </a>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useMotion } from "@vueuse/motion";

const props = defineProps<{ strings: any; lang: "ar" | "en" }>();

const name = ref("");
const phone = ref("");
const message = ref("");
const root = ref<HTMLElement | null>(null);

const whatsAppNumber = props.strings.contact.details.whatsapp.replace(/\D/g, "");
const whatsAppLink = `https://wa.me/${whatsAppNumber}`;
const phoneLink = `tel:${props.strings.contact.details.phone.replace(/\s/g, "")}`;
const emailLink = `mailto:${props.strings.contact.details.email}`;

const submit = () => {
  const labels = props.strings.contact.whatsappMessage;
  const text = encodeURIComponent(`${labels.nameLabel}: ${name.value}\n${labels.phoneLabel}: ${phone.value}\n${labels.messageLabel}: ${message.value}`);
  window.open(`${whatsAppLink}?text=${text}`, "_blank");
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
